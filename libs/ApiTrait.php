<?php

declare(strict_types=1);

/**
 * Spotify Web API aus PHP: Wiedergabe auf jedem Connect-Gerät steuern und den Zustand in die
 * Variablen spiegeln. Anders als bei Apple Music braucht das keine offene Kachel.
 */
trait MusicPlayerSpotifyApiTrait
{
    // Eine Gerätewahl gilt nur für den Wechsel, danach zählt wieder das aktive Gerät
    private const WANTED_DEVICE_TTL = 60;

    private const API_URL = 'https://api.spotify.com';
    private const REPEAT_TO_SPOTIFY = [0 => 'off', 1 => 'context', 2 => 'track'];
    private const REPEAT_FROM_SPOTIFY = ['off' => 0, 'context' => 1, 'track' => 2];
    // Spotify zählt Abrufe je App in einem gleitenden 30-s-Fenster; nach HTTP 429 mindestens so lange still,
    // ohne Retry-After bei jedem weiteren 429 doppelt so lange, höchstens eine Stunde
    private const RATE_LIMIT_MIN = 30;
    private const RATE_LIMIT_MAX_STEP = 3600;
    // Abfrage der Variablen: im Leerlauf (keine Wiedergabe) höchstens so oft
    private const POLL_IDLE = 60;
    // So lange gilt eine Meldung der Kachel als frisch (sie meldet bei Änderungen und alle 30 s)
    private const TILE_REPORT_FRESH = 35;

    /**
     * Aufruf der Web API mit Access-Token; bei 401 einmal erneuern und wiederholen, nach 429 bis
     * Retry-After (mindestens 30 s, ohne Angabe wachsend) gar nicht; die Sperre übersteht einen Neustart. Liefert das JSON als Array ([] bei leerer Antwort) oder wirft bei Fehlern.
     * @return array<string, mixed>
     */
    private function Api(string $Method, string $Path, array $Query = [], ?array $Body = null): array
    {
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $wait = $this->ReadAttributeInteger('RateLimitUntil') - time();
            if ($wait > 0) {
                throw new RuntimeException('HTTP 429 (' . sprintf($this->Translate('paused for %d s'), $wait) . ')');
            }
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
            if ($response['status'] === 429) {
                $retryAfter = (int) ($response['retryAfter'] ?? 0);
                $step = $this->ReadAttributeInteger('RateLimitStep');
                $wait = $retryAfter > 0 ? max(self::RATE_LIMIT_MIN, $retryAfter) : min(self::RATE_LIMIT_MAX_STEP, max(self::RATE_LIMIT_MIN, $step * 2));
                $this->WriteAttributeInteger('RateLimitStep', $retryAfter > 0 ? 0 : $wait);
                $this->WriteAttributeInteger('RateLimitUntil', time() + $wait);
                $this->LogMessage(sprintf($this->Translate('Spotify rate limit reached: requests paused for %d s'), $wait), KL_WARNING);
                throw new RuntimeException('HTTP 429 (' . sprintf($this->Translate('paused for %d s'), $wait) . ')');
            }
            if ($this->ReadAttributeInteger('RateLimitStep') !== 0) {
                $this->WriteAttributeInteger('RateLimitStep', 0);
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

    /**
     * Timer Poll: Variablen abgleichen, außer eine Kachel hat den Zustand gerade gemeldet.
     * Abstand: während der Wiedergabe wie eingestellt, sonst höchstens alle 60 s; nach 429 erst danach.
     */
    public function PollState(): void
    {
        if (time() - (int) $this->GetBuffer('TileReport') >= self::TILE_REPORT_FRESH) {
            $this->UpdateState();
        }
        $this->SchedulePoll();
    }

    private function SchedulePoll(): void
    {
        $interval = max(0, $this->ReadPropertyInteger('PollInterval'));
        if (!$this->SignedIn() || $interval === 0) {
            $this->SetTimerInterval('Poll', 0);
            return;
        }
        $seconds = $this->GetValue('Playback') === 2 ? $interval : max($interval, self::POLL_IDLE);
        $wait = $this->ReadAttributeInteger('RateLimitUntil') - time();
        $this->SetTimerInterval('Poll', max($seconds, $wait) * 1000);
    }

    /** Aus Skripten und nach Befehlen: Zustand des aktiven Geräts sofort in die Variablen. */
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
        // Ohne device_id nimmt Spotify das aktive Gerät; die Geräteliste kostet einen Abruf und kommt nur,
        // wenn keins aktiv ist (404 NO_ACTIVE_DEVICE). Ein gerade gewähltes Gerät geht vor.
        $device = $Command === 'transfer' ? (string) ($Args['device'] ?? '') : $this->WantedDevice();
        try {
            try {
                $this->RunCommand($Command, $Args, $device);
            } catch (RuntimeException $e) {
                if ($device !== '' || !str_starts_with($e->getMessage(), 'HTTP 404')) {
                    throw $e;
                }
                $device = $this->TargetDevice();
                if ($device === '') {
                    $this->LogMessage($this->Translate('No Spotify device available: open the tile or start Spotify on a device'), KL_WARNING);
                    return false;
                }
                $this->RunCommand($Command, $Args, $device);
            }
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (' . $Command . '): ' . $e->getMessage(), KL_WARNING);
            return false;
        }
        // Variablen gleich nachziehen, der Poll käme erst später
        $this->SetTimerInterval('PollOnce', 1500);
        return true;
    }

    /** @param array<string, mixed> $Args */
    private function RunCommand(string $Command, array $Args, string $Device): void
    {
        $q = $Device !== '' ? ['device_id' => $Device] : [];
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
            case 'transfer':
                if ($Device === '') {
                    throw new RuntimeException('HTTP 404');
                }
                $this->Api('PUT', '/v1/me/player', [], ['device_ids' => [$Device], 'play' => true]);
                break;
            default: throw new InvalidArgumentException('Invalid command ' . $Command);
        }
    }

    /** Gerade gewähltes Gerät (Geräteauswahl, TransferPlayback); gilt nur für den Wechsel, höchstens 60 s. */
    private function WantedDevice(): string
    {
        [$wanted, $since] = array_pad(explode('|', $this->GetBuffer('WantedDevice'), 2), 2, '0');
        return time() - (int) $since <= self::WANTED_DEVICE_TTL ? $wanted : '';
    }

    /** Wenn keins aktiv ist: das SDK-Gerät der zuletzt gemeldeten Kachel, sonst das erste bekannte. */
    private function TargetDevice(): string
    {
        $devices = $this->Api('GET', '/v1/me/player/devices')['devices'] ?? [];
        $devices = is_array($devices) ? array_filter($devices, static fn ($d): bool => is_array($d) && is_string($d['id'] ?? null) && ($d['is_restricted'] ?? false) !== true) : [];
        // array_values: array_filter behält die Schlüssel, sonst fehlt $ids[0], wenn das erste Gerät herausfällt
        $devices = array_values($devices);
        $ids = array_map(static fn (array $d): string => $d['id'], $devices);
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
