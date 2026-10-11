<?php

declare(strict_types=1);

/**
 * Anmeldung bei Spotify (OAuth 2.0 mit PKCE, ohne Client Secret), Token-Verwaltung und Geheimnisspeicher.
 * Der Rückruf kommt über den Hook /hook/spotifyplayer; die Redirect-URI muss in Spotifys
 * Developer-Dashboard genau so eingetragen sein (siehe Formular).
 */
trait MusicPlayerSpotifyAuthTrait
{
    private const AUTH_URL = 'https://accounts.spotify.com/authorize';
    private const TOKEN_URL = 'https://accounts.spotify.com/api/token';
    private const HOOK = 'spotifyplayer';
    private const CONNECT_GUID = '{9486D575-BE8C-4ED8-B5B5-20930E26DE6F}';
    // Nur, was die Kachel braucht (Developer Terms V.3): keine E-Mail-Adresse
    private const SCOPES = 'streaming user-read-private user-read-playback-state user-modify-playback-state '
        . 'user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative '
        . 'playlist-modify-public playlist-modify-private user-read-recently-played user-top-read user-follow-read user-follow-modify';
    private const AUTH_TTL = 600;
    private const AUTH_MAX = 10;

    /** Öffentliche Adresse des Rückrufs: eigene Basis oder die Connect-Adresse (https ist Pflicht bei Spotify). */
    public function GetRedirectURI(): string
    {
        $base = trim($this->ReadPropertyString('RedirectBase'));
        if ($base === '' && function_exists('CC_GetConnectURL') && function_exists('IPS_GetInstanceListByModuleID')) {
            $connect = IPS_GetInstanceListByModuleID(self::CONNECT_GUID)[0] ?? 0;
            $url = $connect > 0 ? CC_GetConnectURL($connect) : '';
            $base = is_string($url) ? $url : '';
        }
        return $base === '' ? '' : rtrim($base, '/') . '/hook/' . self::HOOK;
    }

    /** Anmeldeadresse mit frischem PKCE-Paar; der Zustand merkt sich Instanz und Prüfwert für 10 Minuten. */
    public function GetAuthURL(): string
    {
        $clientId = trim($this->ReadPropertyString('ClientID'));
        $redirect = $this->GetRedirectURI();
        if ($clientId === '' || $redirect === '') {
            return '';
        }
        $verifier = rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $state = $this->InstanceID . '.' . bin2hex(random_bytes(16));
        $pending = $this->PendingAuth();
        $pending[$state] = ['verifier' => $verifier, 'time' => time()];
        $this->SetBuffer('Auth', json_encode(array_slice($pending, -self::AUTH_MAX, null, true)));
        return self::AUTH_URL . '?' . http_build_query([
            'client_id'             => $clientId,
            'response_type'         => 'code',
            'redirect_uri'          => $redirect,
            'scope'                 => self::SCOPES,
            'code_challenge_method' => 'S256',
            'code_challenge'        => $challenge,
            'state'                 => $state,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /** Rückruf von Spotify: Code gegen Token tauschen. Liefert eine Meldung für die Rückrufseite. */
    public function CompleteAuth(string $Code, string $State): string
    {
        $pending = $this->PendingAuth();
        if (!preg_match('/^\d+\.[a-f0-9]{32}$/', $State) || !isset($pending[$State]) || !preg_match('/^[A-Za-z0-9._~-]{1,2048}$/', $Code)) {
            // Ohne Code und Zustand selbst zu loggen: nur der Grund
            $reason = !preg_match('/^\d+\.[a-f0-9]{32}$/', $State) ? 'state malformed' : (!isset($pending[$State]) ? 'state unknown or older than 10 min (' . count($pending) . ' pending)' : 'code malformed');
            $this->LogMessage($this->Translate('Sign-in rejected: unknown or expired request') . ' (' . $reason . ')', KL_WARNING);
            return $this->Translate('Sign-in rejected: unknown or expired request');
        }
        $verifier = $pending[$State]['verifier'];
        unset($pending[$State]);
        $this->SetBuffer('Auth', json_encode($pending));
        try {
            $data = $this->TokenRequest([
                'grant_type'    => 'authorization_code',
                'code'          => $Code,
                'redirect_uri'  => $this->GetRedirectURI(),
                'client_id'     => trim($this->ReadPropertyString('ClientID')),
                'code_verifier' => $verifier,
            ]);
            $this->StoreTokens($data);
            $me = $this->Api('GET', '/v1/me');
            $this->WriteAttributeString('UserID', (string) ($me['id'] ?? ''));
            $this->WriteAttributeString('UserName', mb_substr((string) ($me['display_name'] ?? ''), 0, 100));
            $this->WriteAttributeString('Product', (string) ($me['product'] ?? ''));
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Sign-in failed') . ': ' . $e->getMessage(), KL_WARNING);
            return $this->Translate('Sign-in failed') . ': ' . $e->getMessage();
        }
        $this->ApplySignedIn();
        $this->PushToTiles(['type' => 'auth', 'signedIn' => true]);
        return '';
    }

    /** Access-Token erneuern (Timer und auf Anforderung der Kachel). */
    public function RefreshAccessToken(): bool
    {
        $refresh = $this->Secret('RefreshSecret', 'Refresh');
        if ($refresh === '') {
            $this->SetTimerInterval('RefreshToken', 0);
            return false;
        }
        try {
            $data = $this->TokenRequest(['grant_type' => 'refresh_token', 'refresh_token' => $refresh, 'client_id' => trim($this->ReadPropertyString('ClientID'))]);
            $this->StoreTokens($data);
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Token refresh failed') . ': ' . $e->getMessage(), KL_WARNING);
            // Spotify hat die Anmeldung widerrufen: neu anmelden statt endlos zu versuchen
            if (str_contains($e->getMessage(), 'invalid_grant')) {
                $this->ClearTokens();
                $this->ClearState();
                $this->SetStatus(self::STATUS_SIGNED_OUT);
                $this->PushToTiles(['type' => 'auth', 'signedIn' => false]);
            } else {
                $this->SetTimerInterval('RefreshToken', 60 * 1000);
            }
            return false;
        }
        $this->ScheduleRefresh();
        $this->PushToTiles(['type' => 'token', 'accessToken' => $this->AccessToken(false), 'expiresAt' => $this->ReadAttributeInteger('AccessExpiry')]);
        return true;
    }

    public function Logout(): void
    {
        if (!$this->SignedIn()) {
            return;
        }
        $this->ClearTokens();
        $this->ClearState();
        $this->SetTimerInterval('RefreshToken', 0);
        $this->SetTimerInterval('Poll', 0);
        $this->SetStatus(self::STATUS_SIGNED_OUT);
        $this->PushToTiles(['type' => 'auth', 'signedIn' => false]);
    }

    private function SignedIn(): bool
    {
        return $this->ReadAttributeString('RefreshSecret') !== '';
    }

    /** Gültiges Access-Token; erneuert bei Bedarf (nicht in der Kachel-Antwort, siehe GetVisualizationTile). */
    private function AccessToken(bool $AllowRefresh): string
    {
        if ($this->ReadAttributeInteger('AccessExpiry') - time() < 30 && $AllowRefresh && $this->SignedIn()) {
            $this->RefreshAccessToken();
        }
        return $this->ReadAttributeInteger('AccessExpiry') > time() ? $this->Secret('AccessSecret', 'Access') : '';
    }

    /** @param array<string, mixed> $Data Antwort des Token-Endpunkts */
    private function StoreTokens(array $Data): void
    {
        $access = (string) ($Data['access_token'] ?? '');
        if ($access === '' || !preg_match('#^[A-Za-z0-9._~+/=-]{20,4096}$#', $access)) {
            throw new RuntimeException('Token response without access token');
        }
        $this->WriteAttributeString('AccessSecret', $this->Secrets()->Encrypt($access, $this->SecretContext('Access')));
        $this->WriteAttributeInteger('AccessExpiry', time() + max(60, (int) ($Data['expires_in'] ?? 3600)) - 60);
        if (is_string($Data['refresh_token'] ?? null) && $Data['refresh_token'] !== '') {
            $this->WriteAttributeString('RefreshSecret', $this->Secrets()->Encrypt($Data['refresh_token'], $this->SecretContext('Refresh')));
        }
    }

    private function ClearTokens(): void
    {
        $this->WriteAttributeString('RefreshSecret', '');
        $this->WriteAttributeString('AccessSecret', '');
        $this->WriteAttributeInteger('AccessExpiry', 0);
        $this->WriteAttributeString('UserID', '');
        $this->WriteAttributeString('UserName', '');
        $this->WriteAttributeString('Product', '');
    }

    private function ScheduleRefresh(): void
    {
        $seconds = $this->ReadAttributeInteger('AccessExpiry') - time() - 120;
        $this->SetTimerInterval('RefreshToken', $this->SignedIn() ? max(30, $seconds) * 1000 : 0);
    }

    /** @return array<string, mixed> */
    private function TokenRequest(array $Post): array
    {
        $response = $this->Http('POST', self::TOKEN_URL, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($Post, '', '&', PHP_QUERY_RFC3986));
        $data = json_decode($response['body'], true);
        if ($response['status'] !== 200 || !is_array($data)) {
            $error = is_array($data) ? (string) ($data['error'] ?? '') . ' ' . (string) ($data['error_description'] ?? '') : '';
            throw new RuntimeException('HTTP ' . $response['status'] . ' ' . trim($error));
        }
        return $data;
    }

    /** @return array<string, array{verifier: string, time: int}> */
    private function PendingAuth(): array
    {
        $pending = json_decode($this->GetBuffer('Auth'), true);
        $pending = is_array($pending) ? $pending : [];
        return array_filter($pending, static fn ($entry): bool => is_array($entry) && isset($entry['verifier'], $entry['time']) && time() - (int) $entry['time'] < self::AUTH_TTL);
    }

    private function Secret(string $Attribute, string $Field): string
    {
        $stored = $this->ReadAttributeString($Attribute);
        return $stored === '' ? '' : ($this->Secrets()->Decrypt($stored, $this->SecretContext($Field)) ?? '');
    }

    private function Secrets(): SpotifySecretStore
    {
        return new SpotifySecretStore(IPS_GetKernelDir() . 'SpotifyPlayer.key');
    }

    private function SecretContext(string $Field): string
    {
        return $this->InstanceID . '|' . $Field;
    }

    /**
     * HTTP-Aufruf (Token-Endpunkt und Web API); in Tests überschreibbar.
     * @return array{status: int, body: string}
     */
    protected function Http(string $Method, string $Url, array $Headers, ?string $Body): array
    {
        $ch = curl_init($Url);
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CUSTOMREQUEST  => $Method,
            CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json'], $Headers),
        ];
        if ($Body !== null) {
            $options[CURLOPT_POSTFIELDS] = $Body;
        } elseif ($Method !== 'GET') {
            // PUT/POST ohne Rumpf: Spotify antwortet sonst mit HTTP 411 (Length Required)
            $options[CURLOPT_HTTPHEADER][] = 'Content-Length: 0';
        }
        curl_setopt_array($ch, $options);
        if (defined('CURLOPT_PROTOCOLS_STR')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'https');
        }
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (!is_string($body)) {
            throw new RuntimeException('Spotify not reachable: ' . curl_error($ch));
        }
        return ['status' => $status, 'body' => strlen($body) > 1048576 ? '' : $body];
    }
}
