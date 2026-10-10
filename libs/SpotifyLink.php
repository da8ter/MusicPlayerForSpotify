<?php

declare(strict_types=1);

/**
 * Zerlegt open.spotify.com-Links und spotify:-URIs in Typ, ID und URI für die Web API.
 * Nur open.spotify.com ist erlaubt; IDs sind 22 Zeichen Base62.
 */
final class SpotifyLink
{
    private const TYPES = ['track' => 'track', 'album' => 'album', 'playlist' => 'playlist', 'artist' => 'artist'];

    /** @return array{type: string, id: string, uri: string}|null */
    public static function Parse(string $Url): ?array
    {
        $url = trim($Url);
        if (preg_match('/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/', $url, $m)) {
            return self::Make($m[1], $m[2]);
        }
        $parts = parse_url($url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || strtolower($parts['host'] ?? '') !== 'open.spotify.com'
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
            return null;
        }
        $segments = array_values(array_filter(explode('/', $parts['path'] ?? ''), static fn (string $s): bool => $s !== ''));
        // Sprachpräfix wie /intl-de/ überspringen
        if ($segments !== [] && preg_match('/^intl-[a-z]{2,3}$/i', $segments[0])) {
            array_shift($segments);
        }
        if (count($segments) !== 2) {
            return null;
        }
        $type = self::TYPES[strtolower($segments[0])] ?? null;
        if ($type === null || !self::ValidId($segments[1])) {
            return null;
        }
        return self::Make($type, $segments[1]);
    }

    public static function ValidId(string $Id): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9]{22}$/', $Id);
    }

    public static function Uri(string $Type, string $Id): string
    {
        return 'spotify:' . $Type . ':' . $Id;
    }

    /** @return array{type: string, id: string, uri: string} */
    private static function Make(string $Type, string $Id): array
    {
        return ['type' => $Type, 'id' => $Id, 'uri' => self::Uri($Type, $Id)];
    }
}
