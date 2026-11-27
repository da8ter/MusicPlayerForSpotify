<?php

declare(strict_types=1);

/**
 * Sonos-Raum als Wiedergabeziel. Spotify gibt für Sonos keine Gerätekennung heraus (gemessen 27.11.2026),
 * also lässt sich die Wiedergabe über die Web API nicht dorthin schicken. Stattdessen stellt das Modul
 * Playlist, Album oder Titel in die Warteschlange des Lautsprechers; der spielt sie über seinen eigenen
 * Spotify-Dienst (Spotify muss in der Sonos-App eingerichtet sein). Spotify weiß von dieser Wiedergabe
 * nichts: Titel, Position, Lautstärke und Modus liest das Modul vom Lautsprecher (Timer SonosPoll) und
 * schickt sie an die Kacheln (Nachricht „sonos“).
 */
trait MusicPlayerSpotifySonosTargetTrait
{
    // Kennung des Spotify-Dienstes bei Sonos: 2311 in Europa, 3079 in den USA
    private const SONOS_SERVICES = [2311, 3079];
    private const SONOS_POLL_PLAYING = 3000;
    private const SONOS_POLL_IDLE = 15000;
    private const SONOS_MODES = ['NORMAL' => [false, 0], 'REPEAT_ALL' => [false, 1], 'REPEAT_ONE' => [false, 2],
        'SHUFFLE_NOREPEAT' => [true, 0], 'SHUFFLE' => [true, 1], 'SHUFFLE_REPEAT_ONE' => [true, 2]];
    private const SONOS_ITEMS = [
        'playlist' => ['x-rincon-cpcontainer:1006206c', '1006206c', 'object.container.playlistContainer'],
        'album'    => ['x-rincon-cpcontainer:1004206c', '00040000', 'object.container.album.musicAlbum'],
        'track'    => ['', '00032020', 'object.item.audioItem.musicTrack'],
    ];

    private function RegisterSonosTarget(): void
    {
        // Attribut statt Puffer: Der Raum spielt über einen Neustart oder ein Modul-Update hinweg weiter
        $this->RegisterAttributeString('SonosTarget', '');
        $this->RegisterTimer('SonosPoll', 0, 'SPM_PollSonos($_IPS[\'TARGET\']);');
    }

    /** @return array{id: string, name: string, ip: string, zones: list<string>}|null der gewählte Raum */
    private function SonosTarget(): ?array
    {
        $id = $this->ReadAttributeString('SonosTarget');
        if ($id === '') {
            return null;
        }
        foreach ($this->SonosRooms(false) as $room) {
            if ($room['id'] === $id) {
                return $room;
            }
        }
        return null;
    }

    /** Startdaten für die Kachel: die Räume für die Geräteauswahl und der Zustand, wenn ein Raum das Ziel ist. */
    private function SonosTileConfig(): array
    {
        $rooms = array_map(static fn (array $r): array => ['id' => $r['id'], 'name' => $r['name']], $this->SonosRooms(false));
        $state = json_decode($this->GetBuffer('SonosState'), true);
        return ['rooms' => $rooms, 'state' => $this->SonosTarget() !== null && is_array($state) ? $state : null];
    }

    // ── Aufrufe der Kachel (RequestAction „Sonos“, JSON {c: …}) ──

    private function HandleSonos(string $Json): void
    {
        $in = json_decode($Json, true);
        if (!is_array($in)) {
            throw new InvalidArgumentException('Invalid Sonos request');
        }
        $command = (string) ($in['c'] ?? '');
        if ($command === 'select') {
            $room = $this->SonosRoomById((string) ($in['room'] ?? ''));
            if ($room === null) {
                throw new InvalidArgumentException('Unknown Sonos room');
            }
            $this->WriteAttributeString('SonosTarget', $room['id']);
            $this->SetBuffer('SonosState', '');
            $play = is_array($in['play'] ?? null) ? $in['play'] : null;
            if ($play !== null) {
                $this->SonosStart($room, (string) ($play['type'] ?? ''), (string) ($play['id'] ?? ''), 0, [], (int) ($play['position'] ?? 0), (string) ($play['track'] ?? ''));
            }
            $this->PollSonos();
            return;
        }
        $room = $this->SonosTarget();
        if ($room === null) {
            return;
        }
        switch ($command) {
            case 'play':
                $list = is_array($in['list'] ?? null) ? $in['list'] : [];
                $this->SonosStart($room, (string) ($in['type'] ?? ''), (string) ($in['id'] ?? ''), max(0, (int) ($in['index'] ?? 0)), $list, 0, '');
                break;
            case 'queue':
                $this->SonosEnqueue($room['ip'], 'track', [$this->SonosId((string) ($in['id'] ?? ''))]);
                break;
            case 'mode':
                $this->SonosMode($room['ip'], isset($in['shuffle']) ? (bool) $in['shuffle'] : null, isset($in['repeat']) ? (int) $in['repeat'] : null);
                break;
            case 'release':
                $this->SonosRelease(true);
                return;
            case 'list':
                // Ansicht „Als Nächstes“: die Titel nach dem laufenden; Namen und Cover schlägt die Kachel bei Spotify nach
                $this->PushToTiles(['type' => 'sonosQueue', 'ids' => $this->SonosQueueAfter($room['ip'])]);
                return;
            default:
                throw new InvalidArgumentException('Invalid Sonos request');
        }
        $this->PollSonos();
    }

    private function SonosRoomById(string $Id): ?array
    {
        foreach ([false, true] as $refresh) {
            foreach ($this->SonosRooms($refresh) as $room) {
                if ($room['id'] === $Id) {
                    return $room;
                }
            }
        }
        return null;
    }

    private function SonosId(string $Id): string
    {
        if (!preg_match('/^[A-Za-z0-9]{22}$/', $Id)) {
            throw new InvalidArgumentException('Invalid Spotify id');
        }
        return $Id;
    }

    /** Ziel aufgeben: der Raum spielt nicht mehr für diese Instanz; $Pause hält ihn dabei an. */
    private function SonosRelease(bool $Pause): void
    {
        $room = $this->SonosTarget();
        $this->WriteAttributeString('SonosTarget', '');
        $this->SetBuffer('SonosState', '');
        $this->SetTimerInterval('SonosPoll', 0);
        if ($room !== null && $Pause) {
            try {
                $this->SonosSoap($room['ip'], 'AVTransport', 'Pause', ['InstanceID' => 0]);
            } catch (\Throwable $e) {
                $this->SendDebug('Sonos', $e->getMessage(), 0);
            }
        }
        $this->PushToTiles(['type' => 'sonos', 'active' => false]);
    }

    // ── Inhalte starten ──

    /**
     * Ersetzt die Warteschlange des Raums und spielt: Playlist oder Album ab Titel $Index (oder ab dem Titel
     * $TrackId an der Stelle $PositionMs, wenn eine laufende Wiedergabe herüberwandert), ein Künstler mit
     * seinen Top-Titeln, ein Titel allein oder mit der Liste, aus der er stammt.
     * @param list<mixed> $List Titel-URIs (spotify:track:…)
     */
    private function SonosStart(array $Room, string $Type, string $Id, int $Index, array $List, int $PositionMs, string $TrackId): void
    {
        $ip = $Room['ip'];
        $this->SonosId($Id);
        $tracks = [];
        if ($Type === 'artist') {
            $top = $this->Api('GET', '/v1/artists/' . $Id . '/top-tracks', ['market' => 'from_token'])['tracks'] ?? [];
            $tracks = array_values(array_filter(array_map(static fn ($t): string => is_array($t) ? (string) ($t['id'] ?? '') : '', is_array($top) ? $top : [])));
        } elseif ($Type === 'track') {
            foreach (array_slice($List, 0, 100) as $uri) {
                if (is_string($uri) && preg_match('/^spotify:track:([A-Za-z0-9]{22})$/', $uri, $m)) {
                    $tracks[] = $m[1];
                }
            }
            $at = array_search($Id, $tracks, true);
            if ($at === false) {
                $tracks = [$Id];
            } else {
                $Index = (int) $at;
            }
        } elseif (!in_array($Type, ['playlist', 'album'], true)) {
            throw new InvalidArgumentException('Invalid type');
        }
        if ($Type === 'artist' && $tracks === []) {
            throw new RuntimeException('No tracks');
        }
        $this->SonosSoap($ip, 'AVTransport', 'RemoveAllTracksFromQueue', ['InstanceID' => 0]);
        if ($tracks !== []) {
            $this->SonosEnqueue($ip, 'track', $tracks);
        } else {
            $this->SonosEnqueue($ip, $Type, [$Id]);
            if ($TrackId !== '' && preg_match('/^[A-Za-z0-9]{22}$/', $TrackId)) {
                $Index = $this->SonosQueueIndex($ip, $TrackId);
            }
        }
        $this->SonosSoap($ip, 'AVTransport', 'SetAVTransportURI', ['InstanceID' => 0, 'CurrentURI' => 'x-rincon-queue:' . $Room['id'] . '#0', 'CurrentURIMetaData' => '']);
        if ($Index > 0) {
            $this->SonosSoap($ip, 'AVTransport', 'Seek', ['InstanceID' => 0, 'Unit' => 'TRACK_NR', 'Target' => $Index + 1]);
        }
        $this->SonosSoap($ip, 'AVTransport', 'Play', ['InstanceID' => 0, 'Speed' => 1]);
        if ($PositionMs >= 3000) {
            $this->SonosRun($ip, 'seek', ['value' => $PositionMs]);
        }
        $this->SetBuffer('SonosContext', in_array($Type, ['playlist', 'album', 'artist'], true) ? 'spotify:' . $Type . ':' . $Id : '');
    }

    /**
     * Hängt eine Playlist, ein Album oder Titel an die Warteschlange an (Titel zu je 16 in einem Aufruf).
     * @param list<string> $Ids
     */
    private function SonosEnqueue(string $Ip, string $Type, array $Ids): void
    {
        [$prefix, $key, $class] = self::SONOS_ITEMS[$Type];
        $known = (int) $this->GetBuffer('SonosService');
        $services = $known > 0 ? [$known] : self::SONOS_SERVICES;
        foreach ($services as $n => $service) {
            $meta = static fn (string $enc): string => '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" '
                . 'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="' . $key . $enc . '" parentID="-1" restricted="true">'
                . '<dc:title></dc:title><upnp:class>' . $class . '</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON' . $service . '_X_#Svc' . $service . '-0-Token</desc></item></DIDL-Lite>';
            try {
                foreach (array_chunk($Ids, 16) as $chunk) {
                    $encoded = array_map(static fn (string $id): string => 'spotify%3a' . $Type . '%3a' . $id, $chunk);
                    if (count($encoded) === 1) {
                        $this->SonosSoap($Ip, 'AVTransport', 'AddURIToQueue', ['InstanceID' => 0, 'EnqueuedURI' => $prefix . $encoded[0], 'EnqueuedURIMetaData' => $meta($encoded[0]),
                            'DesiredFirstTrackNumberEnqueued' => 0, 'EnqueueAsNext' => 0]);
                    } else {
                        $this->SonosSoap($Ip, 'AVTransport', 'AddMultipleURIsToQueue', ['InstanceID' => 0, 'UpdateID' => 0, 'NumberOfURIs' => count($encoded),
                            'EnqueuedURIs' => implode(' ', array_map(static fn (string $e): string => $prefix . $e, $encoded)), 'EnqueuedURIsMetaData' => implode(' ', array_map($meta, $encoded)),
                            'ContainerURI' => '', 'ContainerMetaData' => '', 'DesiredFirstTrackNumberEnqueued' => 0, 'EnqueueAsNext' => 0]);
                    }
                }
                $this->SetBuffer('SonosService', (string) $service);
                return;
            } catch (RuntimeException $e) {
                // Falsche Dienstkennung für diese Region: die nächste versuchen
                if ($n === count($services) - 1 || !str_contains($e->getMessage(), 'Sonos error')) {
                    throw $e;
                }
            }
        }
    }

    /** Stelle eines Titels in der Warteschlange (0 = erster oder nicht gefunden). */
    private function SonosQueueIndex(string $Ip, string $TrackId): int
    {
        try {
            $result = $this->SonosTag($this->SonosSoap($Ip, 'ContentDirectory', 'Browse', ['ObjectID' => 'Q:0', 'BrowseFlag' => 'BrowseDirectChildren', 'Filter' => 'res',
                'StartingIndex' => 0, 'RequestedCount' => 300, 'SortCriteria' => '']), 'Result');
        } catch (\Throwable $e) {
            return 0;
        }
        preg_match_all('/<res[^>]*>([^<]*)<\/res>/', $result, $m);
        foreach ($m[1] as $i => $uri) {
            if (stripos($uri, 'track%3a' . $TrackId) !== false) {
                return (int) $i;
            }
        }
        return 0;
    }

    /** @return list<string> Kennungen der nächsten bis zu 50 Titel in der Warteschlange des Raums */
    private function SonosQueueAfter(string $Ip): array
    {
        $current = max(0, (int) $this->SonosTag($this->SonosSoap($Ip, 'AVTransport', 'GetPositionInfo', ['InstanceID' => 0]), 'Track'));
        $result = $this->SonosTag($this->SonosSoap($Ip, 'ContentDirectory', 'Browse', ['ObjectID' => 'Q:0', 'BrowseFlag' => 'BrowseDirectChildren', 'Filter' => 'res',
            'StartingIndex' => $current, 'RequestedCount' => 50, 'SortCriteria' => '']), 'Result');
        preg_match_all('/<res[^>]*>x-sonos-spotify:spotify%3atrack%3a([A-Za-z0-9]{22})[^<]*<\/res>/i', $result, $m);
        return array_slice($m[1], 0, 50);
    }

    /** Zufall und Wiederholen: Sonos kennt dafür einen gemeinsamen Modus; null lässt den Teil, wie er ist. */
    private function SonosMode(string $Ip, ?bool $Shuffle, ?int $Repeat): void
    {
        $current = self::SONOS_MODES[$this->SonosTag($this->SonosSoap($Ip, 'AVTransport', 'GetTransportSettings', ['InstanceID' => 0]), 'PlayMode')] ?? [false, 0];
        $wanted = [$Shuffle ?? $current[0], max(0, min(2, $Repeat ?? $current[1]))];
        $mode = array_search($wanted, self::SONOS_MODES, true);
        $this->SonosSoap($Ip, 'AVTransport', 'SetPlayMode', ['InstanceID' => 0, 'NewPlayMode' => $mode === false ? 'NORMAL' : $mode]);
    }

    // ── Zustand ──

    /** Timer SonosPoll und nach jedem Befehl: Zustand des Raums lesen, Variablen und Kacheln nachziehen. */
    public function PollSonos(): void
    {
        $room = $this->SonosTarget();
        if ($room === null) {
            $this->SetTimerInterval('SonosPoll', 0);
            return;
        }
        try {
            $state = $this->ReadSonosState($room);
        } catch (\Throwable $e) {
            $this->SendDebug('Sonos', $e->getMessage(), 0);
            $this->SetTimerInterval('SonosPoll', self::SONOS_POLL_IDLE);
            return;
        }
        // Der Raum spielt etwas anderes (Radio, Spotify Connect aus der App …): Er ist nicht mehr unser Ziel
        if ($state['foreign']) {
            $this->SonosRelease(false);
            $this->SetTimerInterval('PollOnce', 500);
            return;
        }
        // Laut Kachel spielt inzwischen ein Spotify-Gerät, und der Raum schweigt: Er ist nicht mehr das Ziel
        if (!$state['playing'] && $this->GetBuffer('TileActive') !== '' && time() - (int) $this->GetBuffer('TileActive') < 35) {
            $this->SonosRelease(false);
            return;
        }
        unset($state['foreign']);
        $this->SetTimerInterval('SonosPoll', $state['playing'] ? self::SONOS_POLL_PLAYING : self::SONOS_POLL_IDLE);
        $this->SetIfChanged('Playback', $state['playing'] ? 2 : ($state['trackId'] !== '' ? 3 : 1));
        $this->SetIfChanged('Title', $state['title']);
        $this->SetIfChanged('Artist', $state['artist']);
        $this->SetIfChanged('Album', $state['album']);
        $this->SetIfChanged('Cover', $this->SonosCover($state['trackId']));
        $this->SetIfChanged('Volume', $state['volume']);
        $this->SetIfChanged('Shuffle', $state['shuffle']);
        $this->SetIfChanged('Repeat', $state['repeat']);
        $this->SetIfChanged('Device', $room['name']);
        $this->DockState();
        // An die Kacheln nur, wenn sich etwas geändert hat oder die Position anders ist, als sie weiterzählen würden
        $last = json_decode($this->GetBuffer('SonosState'), true);
        $expected = is_array($last) ? (int) $last['position'] + ($last['playing'] ? (time() - (int) $last['at']) * 1000 : 0) : -1;
        $same = is_array($last) && array_diff_key($last, ['position' => 0, 'at' => 0]) == array_diff_key($state, ['position' => 0, 'at' => 0]) && abs($expected - $state['position']) < 4000;
        if (!$same) {
            $this->SetBuffer('SonosState', (string) json_encode($state, JSON_UNESCAPED_UNICODE));
            $this->PushToTiles($state);
        }
    }

    /** @return array<string, mixed> Nachricht „sonos“ für die Kacheln, dazu „foreign“ (spielt etwas, das nicht von hier kommt) */
    private function ReadSonosState(array $Room): array
    {
        $ip = $Room['ip'];
        $ms = static function (string $time): int {
            $parts = array_map('intval', explode(':', $time));
            return count($parts) === 3 ? ($parts[0] * 3600 + $parts[1] * 60 + $parts[2]) * 1000 : 0;
        };
        $transport = $this->SonosTag($this->SonosSoap($ip, 'AVTransport', 'GetTransportInfo', ['InstanceID' => 0]), 'CurrentTransportState');
        $position = $this->SonosSoap($ip, 'AVTransport', 'GetPositionInfo', ['InstanceID' => 0]);
        $uri = $this->SonosTag($position, 'TrackURI');
        $meta = $this->SonosTag($position, 'TrackMetaData');
        $mode = self::SONOS_MODES[$this->SonosTag($this->SonosSoap($ip, 'AVTransport', 'GetTransportSettings', ['InstanceID' => 0]), 'PlayMode')] ?? [false, 0];
        $volume = (int) $this->SonosTag($this->SonosSoap($ip, 'RenderingControl', 'GetVolume', ['InstanceID' => 0, 'Channel' => 'Master']), 'CurrentVolume');
        $ours = preg_match('/^x-sonos-spotify:spotify%3atrack%3a([A-Za-z0-9]{22})/i', $uri, $m) === 1;
        $playing = in_array($transport, ['PLAYING', 'TRANSITIONING'], true);
        return [
            'type'     => 'sonos',
            'active'   => true,
            'room'     => ['id' => $Room['id'], 'name' => $Room['name']],
            'playing'  => $playing && $ours,
            'position' => $ms($this->SonosTag($position, 'RelTime')),
            'duration' => $ms($this->SonosTag($position, 'TrackDuration')),
            'trackId'  => $ours ? $m[1] : '',
            'title'    => $ours ? mb_substr($this->SonosTag($meta, 'dc:title'), 0, 300) : '',
            'artist'   => $ours ? mb_substr($this->SonosTag($meta, 'dc:creator'), 0, 300) : '',
            'album'    => $ours ? mb_substr($this->SonosTag($meta, 'upnp:album'), 0, 300) : '',
            'volume'   => max(0, min(100, $volume)),
            'shuffle'  => $mode[0],
            'repeat'   => $mode[1],
            'context'  => $this->GetBuffer('SonosContext'),
            'at'       => time(),
            'foreign'  => $playing && !$ours && $uri !== '',
        ];
    }

    /** Cover des Titels für die Variable: einmal je Titel bei Spotify nachgeschlagen. */
    private function SonosCover(string $TrackId): string
    {
        if ($TrackId === '') {
            return '';
        }
        [$id, $url] = array_pad(explode('|', $this->GetBuffer('SonosCover'), 2), 2, '');
        if ($id === $TrackId) {
            return $url;
        }
        $url = '';
        try {
            $cover = (string) ($this->Api('GET', '/v1/tracks/' . $TrackId)['album']['images'][0]['url'] ?? '');
            $url = str_starts_with($cover, 'https://') ? mb_substr($cover, 0, 1000) : '';
        } catch (\Throwable $e) {
            $this->SendDebug('Sonos', $e->getMessage(), 0);
        }
        $this->SetBuffer('SonosCover', $TrackId . '|' . $url);
        return $url;
    }
}
