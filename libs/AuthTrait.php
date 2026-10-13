<?php

declare(strict_types=1);

/**
 * Anmeldung bei Spotify über den OAuth-Dienst von Symcon (oauth.ipmagic.de, Kennung "spotify", dieselbe
 * Spotify-App wie Symcons eigenes Spotify-Modul), Token-Verwaltung und Geheimnisspeicher.
 * Der Dienst hält das Client Secret und legt die Berechtigungen fest; Spotify leitet über ihn an die
 * Connect-Adresse zurück, Symcon ruft dann ProcessOAuthData der registrierten Instanz auf.
 */
trait MusicPlayerSpotifyAuthTrait
{
    private const OAUTH_ID = 'spotify';
    private const OAUTH_URL = 'https://oauth.ipmagic.de/';
    private const CONNECT_GUID = '{9486D575-BE8C-4ED8-B5B5-20930E26DE6F}';
    private const AUTH_TTL = 600;

    /** Connect-Adresse der Installation; ohne sie kommt der Rückruf von Spotify nicht an. */
    private function ConnectURL(): string
    {
        if (!function_exists('CC_GetConnectURL') || !function_exists('IPS_GetInstanceListByModuleID')) {
            return '';
        }
        $connect = IPS_GetInstanceListByModuleID(self::CONNECT_GUID)[0] ?? 0;
        $url = $connect > 0 ? CC_GetConnectURL($connect) : '';
        return is_string($url) ? $url : '';
    }

    /**
     * Anmeldeadresse beim Symcon-Dienst. Erst hier übernimmt diese Instanz die Kennung "spotify"
     * (der Rückruf geht an genau eine Instanz) und merkt sich die Anfrage für 10 Minuten.
     */
    public function GetAuthURL(): string
    {
        if ($this->ConnectURL() === '' || !$this->RegisterOAuth(self::OAUTH_ID)) {
            return '';
        }
        $this->SetBuffer('Auth', (string) time());
        return self::OAUTH_URL . 'authorize/' . self::OAUTH_ID . '?username=' . urlencode(IPS_GetLicensee());
    }

    /** Rückruf über Connect (?code=…): Code beim Symcon-Dienst gegen Token tauschen. Liefert eine Meldung für die Rückrufseite. */
    public function CompleteAuth(string $Code): string
    {
        // Nur nach einer Anmeldung aus dieser Instanz; ohne Code selbst zu loggen
        $requested = (int) $this->GetBuffer('Auth');
        if ($requested === 0 || time() - $requested >= self::AUTH_TTL || !preg_match('/^[A-Za-z0-9._~-]{1,2048}$/', $Code)) {
            $reason = $requested === 0 ? 'no sign-in started' : (time() - $requested >= self::AUTH_TTL ? 'sign-in older than 10 min' : 'code malformed');
            $this->LogMessage($this->Translate('Sign-in rejected: unknown or expired request') . ' (' . $reason . ')', KL_WARNING);
            return $this->Translate('Sign-in rejected: unknown or expired request');
        }
        $this->SetBuffer('Auth', '');
        try {
            $this->StoreTokens($this->TokenRequest(['code' => $Code]));
            $me = $this->Api('GET', '/v1/me');
            $this->WriteAttributeString('UserID', (string) ($me['id'] ?? ''));
            $this->WriteAttributeString('UserName', mb_substr((string) ($me['display_name'] ?? ''), 0, 100));
            $this->WriteAttributeString('Product', (string) ($me['product'] ?? ''));
        } catch (\Throwable $e) {
            // Ohne Profil keine halbe Anmeldung (Tokens gespeichert, aber Status, Timer und UserID fehlen)
            $this->ClearTokens();
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
            // Gespeichert, aber nicht zu entschlüsseln (Schlüsseldatei fehlt oder ist beschädigt, z. B. nach
            // Wiederherstellung auf einem anderen Rechner): sichtbar abmelden statt still ohne Token weiterzulaufen
            if ($this->SignedIn()) {
                $this->LogMessage($this->Translate('Key store not usable') . ': ' . $this->Translate('please sign in again'), KL_ERROR);
                $this->Logout();
            }
            return false;
        }
        try {
            $data = $this->TokenRequest(['refresh_token' => $refresh]);
            $this->StoreTokens($data);
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Token refresh failed') . ': ' . $e->getMessage(), KL_WARNING);
            // Spotify hat die Anmeldung widerrufen oder sie ist abgelaufen (Refresh-Token gelten 6 Monate):
            // neu anmelden statt endlos zu versuchen
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
        $this->WriteAttributeString('TokenSource', self::OAUTH_ID);
    }

    private function ClearTokens(): void
    {
        $this->WriteAttributeString('RefreshSecret', '');
        $this->WriteAttributeString('AccessSecret', '');
        $this->WriteAttributeInteger('AccessExpiry', 0);
        $this->WriteAttributeString('UserID', '');
        $this->WriteAttributeString('UserName', '');
        $this->WriteAttributeString('Product', '');
        $this->WriteAttributeString('TokenSource', '');
    }

    private function ScheduleRefresh(): void
    {
        $seconds = $this->ReadAttributeInteger('AccessExpiry') - time() - 120;
        $this->SetTimerInterval('RefreshToken', $this->SignedIn() ? max(30, $seconds) * 1000 : 0);
    }

    /** Code-Tausch und Erneuerung beim Symcon-Dienst (Antwort wie Spotifys Token-Endpunkt). @return array<string, mixed> */
    private function TokenRequest(array $Post): array
    {
        $response = $this->Http('POST', self::OAUTH_URL . 'access_token/' . self::OAUTH_ID, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($Post, '', '&', PHP_QUERY_RFC3986));
        $data = json_decode($response['body'], true);
        if ($response['status'] !== 200 || !is_array($data)) {
            $error = is_array($data) ? (string) ($data['error'] ?? '') . ' ' . (string) ($data['error_description'] ?? '') : '';
            throw new RuntimeException('HTTP ' . $response['status'] . ' ' . trim($error));
        }
        return $data;
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
     * HTTP-Aufruf (Symcon-Dienst und Web API); in Tests überschreibbar.
     * @return array{status: int, body: string, retryAfter?: int}
     */
    protected function Http(string $Method, string $Url, array $Headers, ?string $Body): array
    {
        $ch = curl_init($Url);
        $retryAfter = 0;
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CUSTOMREQUEST  => $Method,
            CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json'], $Headers),
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$retryAfter): int {
                if (stripos($line, 'Retry-After:') === 0) {
                    $retryAfter = max(0, (int) trim(substr($line, 12)));
                }
                return strlen($line);
            },
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
            throw new RuntimeException('Not reachable: ' . curl_error($ch));
        }
        return ['status' => $status, 'body' => strlen($body) > 1048576 ? '' : $body, 'retryAfter' => $retryAfter];
    }
}
