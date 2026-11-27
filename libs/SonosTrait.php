<?php

declare(strict_types=1);

/**
 * Sonos direkt im Heimnetz (UPnP, Port 1400), nur als Umweg für die Steuerung: Spielt Spotify auf einem
 * Sonos-Lautsprecher, meldet die Web API ihn als eingeschränkt und lehnt Play, Pause, Weiter, Zurück,
 * Springen und Lautstärke mit 403 ab. Der Lautsprecher selbst nimmt sie an (gemessen 27.11.2026).
 * Gefunden werden die Räume über DNS-SD oder die eingetragene Adresse eines Lautsprechers; der Raum gehört
 * zum Gerät, wenn sein Name dem Gerätenamen bei Spotify gleicht. Inhalte startet weiter nur Spotify.
 */
trait MusicPlayerSpotifySonosTrait
{
    private const SONOS_SERVICE = '_sonos._tcp';
    private const SONOS_PATHS = [
        'AVTransport'       => '/MediaRenderer/AVTransport/Control',
        'RenderingControl'  => '/MediaRenderer/RenderingControl/Control',
        'ZoneGroupTopology' => '/ZoneGroupTopology/Control',
    ];
    private const SONOS_COMMANDS = ['play', 'pause', 'next', 'previous', 'seek', 'volume'];
    private const SONOS_ROOMS_TTL = 3600;
    private const SONOS_ROUTE_TTL = 600;

    private function RegisterSonos(): void
    {
        $this->RegisterPropertyString('SonosHost', '');
    }

    /** Ist die Antwort der Web API die Absage für ein eingeschränktes Gerät? */
    private function IsRestricted(\Throwable $Error): bool
    {
        return str_starts_with($Error->getMessage(), 'HTTP 403') && stripos($Error->getMessage(), 'restrict') !== false;
    }

    /**
     * Befehl direkt an den Sonos-Raum, der wie das aktive Spotify-Gerät heißt. Liefert false, wenn es keinen
     * solchen Raum gibt oder der Befehl nicht zu denen gehört, die ein Lautsprecher selbst ausführt.
     * @param array<string, mixed> $Args
     */
    private function SonosCommand(string $Command, array $Args): bool
    {
        if (!in_array($Command, self::SONOS_COMMANDS, true)) {
            return false;
        }
        $device = (string) $this->GetValue('Device');
        $ip = $this->SonosRoomIp($device, false);
        if ($ip === '') {
            return false;
        }
        try {
            $this->SonosRun($ip, $Command, $Args);
        } catch (\Throwable $e) {
            // Neue Adresse oder umgruppiert: einmal neu suchen
            $ip = $this->SonosRoomIp($device, true);
            if ($ip === '') {
                throw $e;
            }
            $this->SonosRun($ip, $Command, $Args);
        }
        $this->SetBuffer('SonosRoute', $device . '|' . time());
        $this->SendDebug('Sonos', $Command . ' -> ' . $device, 0);
        return true;
    }

    /** Hat der letzte Befehl an dieses Gerät den Umweg gebraucht? Dann gleich dorthin, ohne Spotify erst zu fragen. */
    private function SonosRouted(): bool
    {
        [$device, $since] = array_pad(explode('|', $this->GetBuffer('SonosRoute'), 2), 2, '0');
        return $device !== '' && $device === (string) $this->GetValue('Device') && time() - (int) $since <= self::SONOS_ROUTE_TTL;
    }

    /** @param array<string, mixed> $Args */
    private function SonosRun(string $Ip, string $Command, array $Args): void
    {
        switch ($Command) {
            case 'play': $this->SonosSoap($Ip, 'AVTransport', 'Play', ['InstanceID' => 0, 'Speed' => 1]); break;
            case 'pause': $this->SonosSoap($Ip, 'AVTransport', 'Pause', ['InstanceID' => 0]); break;
            case 'next': $this->SonosSoap($Ip, 'AVTransport', 'Next', ['InstanceID' => 0]); break;
            case 'previous': $this->SonosSoap($Ip, 'AVTransport', 'Previous', ['InstanceID' => 0]); break;
            case 'seek':
                $seconds = max(0, (int) round(((float) ($Args['value'] ?? 0)) / 1000));
                $this->SonosSoap($Ip, 'AVTransport', 'Seek', ['InstanceID' => 0, 'Unit' => 'REL_TIME', 'Target' => sprintf('%d:%02d:%02d', intdiv($seconds, 3600), intdiv($seconds % 3600, 60), $seconds % 60)]);
                break;
            case 'volume':
                $this->SonosSoap($Ip, 'RenderingControl', 'SetVolume', ['InstanceID' => 0, 'Channel' => 'Master', 'DesiredVolume' => max(0, min(100, (int) ($Args['value'] ?? 0)))]);
                break;
        }
    }

    /** Adresse des Gruppenführers, zu dessen Gruppe ein Raum mit diesem Namen gehört; '' = kein solcher Raum. */
    private function SonosRoomIp(string $Name, bool $Refresh): string
    {
        $name = mb_strtolower(trim($Name));
        if ($name === '') {
            return '';
        }
        foreach ($this->SonosRooms($Refresh) as $room) {
            if (in_array($name, $room['zones'], true)) {
                return $room['ip'];
            }
        }
        return '';
    }

    /**
     * Bekannte Räume, eine Stunde gemerkt (ein Abruf je Suche, nur wenn ein Befehl den Umweg braucht).
     * @return list<array{ip: string, zones: list<string>}>
     */
    private function SonosRooms(bool $Refresh): array
    {
        $cache = json_decode($this->GetBuffer('SonosRooms'), true);
        if (!$Refresh && is_array($cache) && time() - (int) ($cache['at'] ?? 0) <= self::SONOS_ROOMS_TTL && is_array($cache['rooms'] ?? null)) {
            return $cache['rooms'];
        }
        // Nach einer ergebnislosen Suche nicht bei jedem Tastendruck neu suchen
        if ($Refresh && is_array($cache) && time() - (int) ($cache['at'] ?? 0) < 30) {
            return is_array($cache['rooms'] ?? null) ? $cache['rooms'] : [];
        }
        $rooms = [];
        foreach ($this->SonosSeeds() as $ip) {
            try {
                $rooms = $this->SonosTopology($ip);
            } catch (\Throwable $e) {
                $this->SendDebug('Sonos', $e->getMessage(), 0);
            }
            if ($rooms !== []) {
                break;
            }
        }
        $this->SetBuffer('SonosRooms', (string) json_encode(['at' => time(), 'rooms' => $rooms], JSON_UNESCAPED_UNICODE));
        return $rooms;
    }

    /** @return list<string> Adressen von Sonos-Lautsprechern: die eingetragene, sonst über DNS-SD */
    private function SonosSeeds(): array
    {
        $host = trim($this->ReadPropertyString('SonosHost'));
        if ($host !== '') {
            return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? [$host] : [];
        }
        $control = function_exists('ZC_QueryServiceType') ? (IPS_GetInstanceListByModuleID('{780B2D48-916C-4D59-AD35-5A429B2355A5}')[0] ?? 0) : 0;
        if ($control === 0) {
            return [];
        }
        $seeds = [];
        // @: Ohne Antwort liefert DNS-SD false mit Warnung; dann gibt es schlicht keinen Lautsprecher
        foreach (@ZC_QueryServiceType($control, self::SONOS_SERVICE, '') ?: [] as $service) {
            foreach (@ZC_QueryService($control, (string) $service['Name'], self::SONOS_SERVICE, (string) ($service['Domain'] ?? 'local.')) ?: [] as $detail) {
                $ip = $detail['IPv4'][0] ?? '';
                if (is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                    $seeds[] = $ip;
                }
            }
        }
        return array_slice(array_values(array_unique($seeds)), 0, 8);
    }

    /**
     * Gruppenübersicht eines Lautsprechers: je Gruppe die Adresse des Führers und die Namen ihrer Räume.
     * @return list<array{ip: string, zones: list<string>}>
     */
    private function SonosTopology(string $Ip): array
    {
        $xml = $this->SonosTag($this->SonosSoap($Ip, 'ZoneGroupTopology', 'GetZoneGroupState'), 'ZoneGroupState');
        $doc = $xml === '' ? false : @simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET);
        $rooms = [];
        foreach ($doc === false ? [] : ($doc->xpath('//ZoneGroup') ?: []) as $group) {
            $coordinator = (string) $group['Coordinator'];
            $zones = [];
            $ip = '';
            foreach ($group->ZoneGroupMember as $member) {
                if ((string) $member['Invisible'] !== '1' && (string) $member['ZoneName'] !== '') {
                    $zones[] = mb_strtolower(trim((string) $member['ZoneName']));
                }
                if ((string) $member['UUID'] === $coordinator) {
                    $ip = (string) parse_url((string) $member['Location'], PHP_URL_HOST);
                }
            }
            if ($zones !== [] && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) && count($rooms) < 32) {
                $rooms[] = ['ip' => $ip, 'zones' => array_values(array_unique($zones))];
            }
        }
        return $rooms;
    }

    /** @param array<string, mixed> $Args */
    private function SonosSoap(string $Ip, string $Service, string $Action, array $Args = []): string
    {
        // Nur private Adressen: der Umweg führt ins Heimnetz, nie ins Internet
        if (!filter_var($Ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) || filter_var($Ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE) || !isset(self::SONOS_PATHS[$Service])) {
            throw new InvalidArgumentException('Invalid Sonos address');
        }
        $body = '';
        foreach ($Args as $name => $value) {
            $body .= '<' . $name . '>' . htmlspecialchars((string) $value, ENT_XML1 | ENT_QUOTES) . '</' . $name . '>';
        }
        $namespace = 'urn:schemas-upnp-org:service:' . $Service . ':1';
        $envelope = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
            . '<s:Body><u:' . $Action . ' xmlns:u="' . $namespace . '">' . $body . '</u:' . $Action . '></s:Body></s:Envelope>';
        $response = $this->SonosHttp('http://' . $Ip . ':1400' . self::SONOS_PATHS[$Service],
            ['Content-Type: text/xml; charset="utf-8"', 'SOAPACTION: "' . $namespace . '#' . $Action . '"'], $envelope);
        if ($response['status'] !== 200) {
            $code = preg_match('/<errorCode>(\d+)<\/errorCode>/', $response['body'], $m) ? 'error ' . $m[1] : 'HTTP ' . $response['status'];
            throw new RuntimeException('Sonos ' . $code . ' (' . $Action . ')');
        }
        return $response['body'];
    }

    private function SonosTag(string $Xml, string $Tag): string
    {
        return preg_match('/<' . preg_quote($Tag, '/') . '(?:\s[^>]*)?>(.*?)<\/' . preg_quote($Tag, '/') . '>/s', $Xml, $m)
            ? html_entity_decode($m[1], ENT_QUOTES | ENT_XML1, 'UTF-8') : '';
    }

    /**
     * POST an einen Lautsprecher im Heimnetz (http, kurze Fristen); in Tests überschreibbar.
     * @return array{status: int, body: string}
     */
    protected function SonosHttp(string $Url, array $Headers, string $Body): array
    {
        $ch = curl_init($Url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_HTTPHEADER     => $Headers,
            CURLOPT_POSTFIELDS     => $Body,
        ]);
        if (defined('CURLOPT_PROTOCOLS_STR')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'http');
        }
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (!is_string($body)) {
            throw new RuntimeException('Sonos not reachable: ' . curl_error($ch));
        }
        return ['status' => $status, 'body' => strlen($body) > 262144 ? '' : $body];
    }
}
