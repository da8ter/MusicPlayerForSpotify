<?php

declare(strict_types=1);

/**
 * Spotify Web API aus PHP: Wiedergabe auf jedem Connect-Gerät steuern und den Zustand in die
 * Variablen spiegeln. Anders als bei Apple Music braucht das keine offene Kachel.
 */
trait MusicPlayerSpotifyApiTrait
{
    private const API_URL = 'https://api.spotify.com';
    private const REPEAT_TO_SPOTIFY = [0 => 'off', 1 => 'context', 2 => 'track'];
    private const REPEAT_FROM_SPOTIFY = ['off' => 0, 'context' => 1, 'track' => 2];

    /**
     * Aufruf der Web API mit Access-Token; bei 401 einmal erneuern und wiederholen.
     * Liefert das JSON als Array ([] bei leerer Antwort) oder wirft bei Fehlern.
     * @return array<string, mixed>
     */
    private function Api(string $Method, string $Path, array $Query = [], ?array $Body = null): array
    {
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $token = $this->AccessToken(true);
            if ($token === '') {
                throw new RuntimeException('Not signed in');
            }
            $url = self::API_URL . $Path . ($Query !== [] ? '?' . http_build_query($Query, '', '&', PHP_QUERY_RFC3986) : '');
            $headers = ['Authorization: Bearer ' . $token];
            if ($Body !== null) {
                $headers[] = 'Content-Type: application/json';
            }
            $response = $this->Http($Method, $url, $headers, $Body === null ? null : json_encode($Body));
            if ($response['status'] === 401 && $attempt === 0) {
                $this->WriteAttributeInteger('AccessExpiry', 0);
                continue;
            }
            if ($response['status'] >= 200 && $response['status'] < 300) {
                $data = $response['body'] === '' ? [] : json_decode($response['body'], true);
                return is_array($data) ? $data : [];
            }
            $error = json_decode($response['body'], true);
            $reason = is_array($error) ? (string) ($error['error']['reason'] ?? $error['error']['message'] ?? $error['error_description'] ?? '') : '';
            throw new RuntimeException('HTTP ' . $response['status'] . ($reason !== '' ? ' ' . $reason : ''));
        }
        throw new RuntimeException('Not signed in');
    }

    /**
     * Rohzugriff auf die Web API für Skripte: SPM_Request($id, 'GET', '/v1/me/playlists', '{"limit":5}').
     * Liefert die Antwort als JSON ('{}' bei leerer Antwort) oder '' mit Logmeldung bei Fehlern.
     */
    public function Request(string $Method, string $Path, string $Query = '', string $Body = ''): string
    {
        $method = strtoupper(trim($Method));
        if (!in_array($method, ['GET', 'PUT', 'POST', 'DELETE'], true) || !preg_match('#^/v1/[A-Za-z0-9/._~%-]+$#', $Path)) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (request): invalid method or path', KL_WARNING);
            return '';
        }
        $query = $Query === '' ? [] : json_decode($Query, true);
        $body = $Body === '' ? null : json_decode($Body, true);
        if (!is_array($query) || ($Body !== '' && !is_array($body))) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (request): query and body must be JSON objects', KL_WARNING);
            return '';
        }
        try {
            return json_encode($this->Api($method, $Path, $query, $body), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (' . $method . ' ' . $Path . '): ' . $e->getMessage(), KL_WARNING);
            return '';
        }
    }

    /** Formular-Knopf „Verbindung prüfen“: eine Zeile je Endpunkt mit Ergebnis (für Fehlersuche und Support). */
    public function TestConnection(): string
    {
        if (!$this->SignedIn()) {
            return $this->Translate('Not signed in to Spotify');
        }
        $checks = [
            'Profil (/v1/me)'                        => ['/v1/me', []],
            'Geräte (/v1/me/player/devices)'          => ['/v1/me/player/devices', []],
            'Zuletzt gespielt (recently-played)'      => ['/v1/me/player/recently-played', ['limit' => 1]],
            'Top-Künstler (me/top/artists)'           => ['/v1/me/top/artists', ['limit' => 1]],
            'Mediathek (me/library/contains)'         => ['/v1/me/library/contains', ['uris' => 'spotify:track:4uLU6hMCjMI75M1A2tKUQC']],
            'Playlists (me/playlists)'                => ['/v1/me/playlists', ['limit' => 1]],
            'Suche (/v1/search)'                      => ['/v1/search', ['q' => 'a', 'type' => 'track', 'limit' => 1]],
        ];
        $lines = [];
        foreach ($checks as $label => [$path, $query]) {
            try {
                $data = $this->Api('GET', $path, $query);
                $count = count($data['items'] ?? $data['devices'] ?? $data['tracks']['items'] ?? $data);
                $lines[] = $label . ': OK' . (isset($data['id']) ? ' (' . (string) ($data['product'] ?? '') . ')' : ' (' . $count . ')');
            } catch (\Throwable $e) {
                $lines[] = $label . ': ' . $e->getMessage();
            }
        }
        return implode("\n", $lines);
    }

    /** Vom Timer Poll und aus Skripten: Zustand des aktiven Geräts in die Variablen. */
    public function UpdateState(): bool
    {
        if (!$this->SignedIn()) {
            return false;
        }
        try {
            $state = $this->Api('GET', '/v1/me/player', ['additional_types' => 'track,episode']);
        } catch (\Throwable $e) {
            $this->SendDebug('UpdateState', $e->getMessage(), 0);
            return false;
        }
        $this->ApplyPlayerState($state);
        return true;
    }

    /** @param array<string, mixed> $State Antwort von /v1/me/player oder [] (kein aktives Gerät) */
    private function ApplyPlayerState(array $State): void
    {
        $item = is_array($State['item'] ?? null) ? $State['item'] : [];
        $device = is_array($State['device'] ?? null) ? $State['device'] : [];
        $playing = ($State['is_playing'] ?? false) === true;
        $artists = array_map(static fn ($a): string => (string) ($a['name'] ?? ''), is_array($item['artists'] ?? null) ? $item['artists'] : []);
        $images = is_array($item['album']['images'] ?? null) ? $item['album']['images'] : (is_array($item['images'] ?? null) ? $item['images'] : []);
        $cover = (string) ($images[0]['url'] ?? '');
        $this->SetIfChanged('Playback', $playing ? 2 : ($item !== [] ? 3 : 1));
        $this->SetIfChanged('Title', mb_substr((string) ($item['name'] ?? ''), 0, 300));
        $this->SetIfChanged('Artist', mb_substr(implode(', ', array_filter($artists)), 0, 300));
        $this->SetIfChanged('Album', mb_substr((string) ($item['album']['name'] ?? $item['show']['name'] ?? ''), 0, 300));
        $this->SetIfChanged('Cover', str_starts_with($cover, 'https://') ? mb_substr($cover, 0, 1000) : '');
        if (is_numeric($device['volume_percent'] ?? null)) {
            $this->SetIfChanged('Volume', max(0, min(100, (int) $device['volume_percent'])));
        }
        $this->SetIfChanged('Shuffle', ($State['shuffle_state'] ?? false) === true);
        $this->SetIfChanged('Repeat', self::REPEAT_FROM_SPOTIFY[(string) ($State['repeat_state'] ?? 'off')] ?? 0);
        $this->SetIfChanged('Device', mb_substr((string) ($device['name'] ?? ''), 0, 60));
        if (is_string($device['id'] ?? null) && $device['id'] !== '') {
            $this->SetBuffer('ActiveDevice', $device['id']);
        }
    }

    /**
     * Befehl an das aktive Gerät; ohne aktives Gerät an die Kachel (SDK-Gerät) oder das zuerst
     * gelistete. Liefert false (mit Logmeldung), wenn kein Gerät erreichbar ist.
     */
    private function SendCommand(string $Command, array $Args = []): bool
    {
        if (!$this->SignedIn()) {
            $this->LogMessage($this->Translate('Not signed in to Spotify'), KL_WARNING);
            return false;
        }
        try {
            $device = $this->TargetDevice();
            if ($device === '') {
                $this->LogMessage($this->Translate('No Spotify device available: open the tile or start Spotify on a device'), KL_WARNING);
                return false;
            }
            $q = ['device_id' => $device];
            switch ($Command) {
                case 'play': $this->Api('PUT', '/v1/me/player/play', $q); break;
                case 'pause': $this->Api('PUT', '/v1/me/player/pause', $q); break;
                case 'next': $this->Api('POST', '/v1/me/player/next', $q); break;
                case 'previous': $this->Api('POST', '/v1/me/player/previous', $q); break;
                case 'volume': $this->Api('PUT', '/v1/me/player/volume', $q + ['volume_percent' => max(0, min(100, (int) ($Args['value'] ?? 0)))]); break;
                case 'shuffle': $this->Api('PUT', '/v1/me/player/shuffle', $q + ['state' => ($Args['value'] ?? false) ? 'true' : 'false']); break;
                case 'repeat': $this->Api('PUT', '/v1/me/player/repeat', $q + ['state' => self::REPEAT_TO_SPOTIFY[(int) ($Args['value'] ?? 0)] ?? 'off']); break;
                case 'playItem':
                    $uri = SpotifyLink::Uri((string) $Args['type'], (string) $Args['id']);
                    $this->Api('PUT', '/v1/me/player/play', $q, $Args['type'] === 'track' ? ['uris' => [$uri]] : ['context_uri' => $uri]);
                    break;
                case 'transfer': $this->Api('PUT', '/v1/me/player', [], ['device_ids' => [$device], 'play' => true]); break;
                default: throw new InvalidArgumentException('Invalid command ' . $Command);
            }
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (' . $Command . '): ' . $e->getMessage(), KL_WARNING);
            return false;
        }
        // Variablen gleich nachziehen, der Poll käme erst später
        $this->SetTimerInterval('PollOnce', 1500);
        return true;
    }

    /** Aktives Gerät, sonst das SDK-Gerät der zuletzt gemeldeten Kachel, sonst das erste bekannte. */
    private function TargetDevice(): string
    {
        $wanted = $this->GetBuffer('WantedDevice');
        $devices = $this->Api('GET', '/v1/me/player/devices')['devices'] ?? [];
        $devices = is_array($devices) ? array_filter($devices, static fn ($d): bool => is_array($d) && is_string($d['id'] ?? null) && ($d['is_restricted'] ?? false) !== true) : [];
        $ids = array_map(static fn (array $d): string => $d['id'], $devices);
        if ($wanted !== '' && in_array($wanted, $ids, true)) {
            return $wanted;
        }
        foreach ($devices as $d) {
            if (($d['is_active'] ?? false) === true) {
                return $d['id'];
            }
        }
        $tile = $this->GetBuffer('TileDevice');
        if ($tile !== '' && in_array($tile, $ids, true)) {
            return $tile;
        }
        return $ids[0] ?? '';
    }
}
