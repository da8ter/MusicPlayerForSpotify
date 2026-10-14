<?php

declare(strict_types=1);

require_once __DIR__ . '/../libs/SecretStore.php';
require_once __DIR__ . '/../libs/SpotifyLink.php';
require_once __DIR__ . '/../libs/AuthTrait.php';
require_once __DIR__ . '/../libs/ApiTrait.php';
require_once __DIR__ . '/../libs/VariablesTrait.php';

/**
 * Musikplayer für Spotify als Kachel: das Web Playback SDK spielt im Browser (im Visu-Hauptfenster,
 * damit die Musik einen Kategoriewechsel übersteht), die Web API steuert jedes Spotify-Connect-Gerät.
 * Das Modul hält die Anmeldung (über den OAuth-Dienst von Symcon), spiegelt den Zustand in Variablen und führt
 * Befehle aus Skripten direkt über die Web API aus; dafür muss keine Kachel offen sein.
 */
class MusicPlayerForSpotify extends IPSModuleStrict
{
    use MusicPlayerSpotifyAuthTrait;
    use MusicPlayerSpotifyApiTrait;
    use MusicPlayerSpotifyVariablesTrait;

    private const STATUS_NO_CONNECT = 201;
    private const STATUS_SIGNED_OUT = 202;
    private const STATUS_KEY_ERROR = 203;
    private const PLAYBACK_COMMANDS = [0 => 'previous', 1 => 'pause', 2 => 'play', 3 => 'pause', 4 => 'next'];
    private const REFRESH_MIN_INTERVAL = 20;

    // Texte der Kachel, übersetzt über locale.json
    private const TILE_TEXTS = [
        'Sign in with Spotify', 'Not signed in to Spotify', 'Signing in needs an active Symcon Connect',
        'Sign-in window blocked: allow pop-ups for this page', 'Sign-in expired. Please sign in again.',
        'Spotify Premium is required for playback', 'Spotify could not be loaded',
        'Home', 'New', 'Discover', 'Popular playlists', 'Browse all', 'Library', 'Search', 'Favorites', 'Playlists', 'Albums', 'Artists', 'Liked Songs', 'Recently played',
        'New releases', 'Top artists', 'Top songs', 'Your playlists', 'Saved albums', 'Artists you follow', 'New from your artists', 'Recently saved', 'Search Spotify', 'Songs', 'No results', 'Loading…', 'The queue is empty',
        'Playback failed', 'No device available: open the tile in a browser or start Spotify on a device', 'Devices', 'This tile',
        'Nothing playing', 'Back', 'Play album', 'Play playlist', 'Play', 'Pause', 'Next', 'Close', 'More', 'Cancel',
        'Add to queue', 'Add to playlist…', 'Add to playlist', 'Add to library', 'Remove from library', 'Added to the queue',
        'New playlist', 'Create', 'Playlist created', 'Added to', 'Added to library', 'Removed from library',
        'Could not change the playlist', 'Could not change the library', 'Like', 'Remove like', 'Could not save',
        'Add to tile favorites', 'Added to tile favorites', 'Up Next', 'Shuffle', 'Repeat', 'Album', 'Playlist', 'Song', 'Artist',
        'Rename playlist', 'Delete playlist', 'Remove from playlist', 'Removed from playlist', 'Playlist renamed', 'Playlist deleted',
        'Follow artist', 'Unfollow artist', 'Now following', 'Unfollowed', 'Could not switch the device', 'Playing on', 'Open in Spotify',
        'Spotify does not share this content with this app',
        'Name this device', 'Save', 'The new name applies after reloading the visualization', 'Leave empty for the automatic name',
        'Playback needs a secure connection (https). Open the visualization via the Connect address.',
    ];

    public function Create(): void
    {
        parent::Create();

        $this->RegisterPropertyString('PlayerName', 'Symcon');
        $this->RegisterPropertyInteger('PollInterval', 30);
        $this->RegisterPropertyString('Favorites', '[]');

        $this->RegisterAttributeString('RefreshSecret', '');
        $this->RegisterAttributeString('AccessSecret', '');
        $this->RegisterAttributeInteger('AccessExpiry', 0);
        $this->RegisterAttributeString('UserID', '');
        $this->RegisterAttributeString('UserName', '');
        $this->RegisterAttributeString('Product', '');
        $this->RegisterAttributeString('TokenSource', '');
        $this->RegisterAttributeString('TileHash', '');
        $this->RegisterAttributeInteger('RateLimitUntil', 0);
        $this->RegisterAttributeInteger('RateLimitStep', 0);

        $this->RegisterTimer('RefreshToken', 0, 'SPM_RefreshAccessToken($_IPS[\'TARGET\']);');
        $this->RegisterTimer('Poll', 0, 'SPM_PollState($_IPS[\'TARGET\']);');
        $this->RegisterTimer('PollOnce', 0, 'SPM_PollOnce($_IPS[\'TARGET\']);');
        // Favoriten aus der Kachel: die Property von außen übernehmen, denn ApplyChanges der
        // eigenen Instanz aus einer Modulfunktion heraus lehnt Symcon ab (re-entranter Aufruf).
        $this->RegisterTimer('ApplyFavorites', 0, 'IPS_SetProperty($_IPS[\'TARGET\'], \'Favorites\', SPM_TakePendingFavorites($_IPS[\'TARGET\'])); IPS_ApplyChanges($_IPS[\'TARGET\']);');
        $this->SetVisualizationType(defined('INSTANCE_VISUALIZATION_TYPE_HTML_FULLSCREEN') ? INSTANCE_VISUALIZATION_TYPE_HTML_FULLSCREEN : 1);
    }

    public function ApplyChanges(): void
    {
        parent::ApplyChanges();

        if (IPS_GetKernelRunlevel() !== KR_READY) {
            $this->RegisterMessage(0, IPS_KERNELSTARTED);
            return;
        }

        $this->RegisterVariables();
        $this->MigrateOwnApp();
        $this->ApplySignedIn();

        // Kacheln nur neu laden, wenn sich etwas für sie geändert hat; geänderte Favoriten gehen als
        // Nachricht hinaus (ein Favorit aus der Kachel soll nicht alle Geräte neu laden).
        [$tileHash, $favoritesHash] = $this->TileHashes();
        $previous = $this->ReadAttributeString('TileHash');
        $favorites = $this->Favorites();
        $this->WriteAttributeString('TileHash', $tileHash . '|' . $favoritesHash);
        if ($previous === '' || !str_starts_with($previous, $tileHash . '|')) {
            $this->PushToTiles(['type' => 'reload']);
        } elseif ($previous !== $tileHash . '|' . $favoritesHash) {
            $this->PushToTiles(['type' => 'favorites', 'favorites' => $favorites]);
        }
    }

    /**
     * Bis Oktober 2026 meldete sich das Modul über eine eigene Spotify-App des Nutzers an (Client ID, Hook
     * /hook/spotifyplayer). Deren Token lassen sich beim Symcon-Dienst nicht erneuern: verwerfen und den Hook abmelden.
     */
    private function MigrateOwnApp(): void
    {
        if ($this->SignedIn() && $this->ReadAttributeString('TokenSource') !== self::OAUTH_ID) {
            $this->ClearTokens();
            $this->ClearState();
        }
        try {
            $this->UnregisterHook('spotifyplayer');
        } catch (\Throwable $e) {
            // war nicht registriert
        }
    }

    /** Status und Timer nach Anmeldung, Abmeldung oder Übernehmen */
    private function ApplySignedIn(): void
    {
        if ($this->SignedIn()) {
            $this->SetStatus(IS_ACTIVE);
        } elseif ($this->ConnectURL() === '') {
            $this->SetStatus(self::STATUS_NO_CONNECT);
        } else {
            $this->SetStatus(self::STATUS_SIGNED_OUT);
        }
        $this->ScheduleRefresh();
        $this->SchedulePoll();
    }

    public function MessageSink(int $TimeStamp, int $SenderID, int $Message, array $Data): void
    {
        if ($Message === IPS_KERNELSTARTED) {
            $this->ApplyChanges();
        }
    }

    public function Destroy(): void
    {
        parent::Destroy();
    }

    public function GetConfigurationForm(): string
    {
        $form = json_decode((string) file_get_contents(__DIR__ . '/form.json'), true);
        foreach ($form['actions'] as &$action) {
            if (($action['name'] ?? '') === 'ConnectInfo') {
                $action['caption'] = $this->ConnectURL() !== '' ? '' : $this->Translate('Signing in needs an active Symcon Connect');
                $action['visible'] = $action['caption'] !== '';
            }
            if (($action['name'] ?? '') === 'LoginInfo') {
                // Die Abo-Art (product) liefert Spotify nicht jeder App (Dev Mode seit Februar 2026)
                $product = $this->ReadAttributeString('Product');
                $action['caption'] = $this->SignedIn()
                    ? sprintf($this->Translate('Signed in to Spotify as %s'), $this->ReadAttributeString('UserName') . ($product !== '' ? ' (' . $product . ')' : ''))
                    : $this->Translate('Not signed in to Spotify');
            }
        }
        unset($action);
        return json_encode($form);
    }

    public function GetVisualizationTile(): string
    {
        $signedIn = $this->SignedIn();
        $texts = [];
        foreach (self::TILE_TEXTS as $text) {
            $texts[$text] = $this->Translate($text);
        }
        $config = [
            'mode'        => $signedIn ? 'player' : ($this->ConnectURL() === '' ? 'setup' : 'login'),
            'instance'    => $this->InstanceID,
            // Sichtbar für jeden mit Zugang zur Visualisierung: dieselben Personen bedienen den Player.
            'accessToken' => $signedIn ? $this->AccessToken(true) : '',
            'expiresAt'   => $signedIn ? $this->ReadAttributeInteger('AccessExpiry') : 0,
            'playerName'  => mb_substr(trim($this->ReadPropertyString('PlayerName')) ?: 'Symcon', 0, 60),
            'userId'      => $this->ReadAttributeString('UserID'),
            'favorites'   => $this->Favorites(),
            'texts'       => $texts,
        ];
        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
        return strtr((string) file_get_contents(__DIR__ . '/module.html'), [
            '/*STYLE*/'      => file_get_contents(__DIR__ . '/assets/player.css') . "\n" . file_get_contents(__DIR__ . '/assets/layout.css'),
            '/*CONFIG*/null' => json_encode($config, $flags),
            '/*WEBAPI*/'     => (string) file_get_contents(__DIR__ . '/assets/webapi.js'),
            '/*CORE*/'       => (string) file_get_contents(__DIR__ . '/assets/core.js'),
            '/*ICONS*/'      => (string) file_get_contents(__DIR__ . '/assets/icons.js'),
            '/*NAV*/'        => (string) file_get_contents(__DIR__ . '/assets/nav.js'),
            '/*ACTIONS*/'    => (string) file_get_contents(__DIR__ . '/assets/actions.js'),
            '/*UI*/'         => (string) file_get_contents(__DIR__ . '/assets/ui.js'),
            '/*DETAILS*/'    => (string) file_get_contents(__DIR__ . '/assets/details.js'),
            '/*VIEWS*/'      => (string) file_get_contents(__DIR__ . '/assets/views.js'),
            '/*PLAYER*/'     => (string) file_get_contents(__DIR__ . '/assets/player.js'),
            '/*SCROLL*/'     => (string) file_get_contents(__DIR__ . '/assets/scroll.js'),
        ]);
    }

    /** Rückruf von Spotify über den Symcon-Dienst und Connect (?code=…), nur bei der Instanz, die die Anmeldung gestartet hat */
    protected function ProcessOAuthData(): void
    {
        $error = (string) ($_GET['error'] ?? '');
        $message = $error !== ''
            ? $this->Translate('Sign-in failed') . ': ' . mb_substr($error, 0, 100)
            : $this->CompleteAuth((string) ($_GET['code'] ?? ''));
        $ok = $message === '';
        $text = $ok ? $this->Translate('Signed in to Spotify. You can close this window.') : $message;
        if (!headers_sent()) {
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store');
        }
        echo '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Symcon</title>'
            . '<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1c1c1e;color:#fff;text-align:center;padding:24px}</style></head>'
            . '<body><p>' . htmlspecialchars($text, ENT_QUOTES) . '</p>'
            . ($ok ? '<script>setTimeout(function(){window.close();},1500);</script>' : '') . '</body></html>';
    }

    public function RequestAction(string $Ident, mixed $Value): void
    {
        switch ($Ident) {
            case 'Playback':
                $command = self::PLAYBACK_COMMANDS[(int) $Value] ?? null;
                if ($command !== null) {
                    $this->SendCommand($command);
                }
                return;
            case 'Volume':
                $this->SetVolume((int) $Value);
                return;
            case 'Shuffle':
                $this->SetShuffle((bool) $Value);
                return;
            case 'Repeat':
                $this->SetRepeat((int) $Value);
                return;
            case 'Favorite':
                $this->PlayFavorite((int) $Value);
                return;
            // Ab hier: Aufrufe der Kachel. RequestAction ist öffentlich, jede Eingabe wird geprüft.
            case 'Login':
                // Anmeldung erst beim Klick starten (übernimmt die OAuth-Kennung); nur die anfragende Kachel (playerId) öffnet sie
                $playerId = (string) $Value;
                if (!preg_match('/^[a-f0-9]{24}$/', $playerId)) {
                    throw new InvalidArgumentException('Invalid player');
                }
                $this->PushToTiles(['type' => 'login', 'playerId' => $playerId, 'url' => $this->GetAuthURL()]);
                return;
            case 'Logout':
                $this->Logout();
                return;
            case 'RefreshToken':
                // Höchstens alle 20 s, egal wie viele Kacheln fragen
                if (time() - (int) $this->GetBuffer('LastRefresh') >= self::REFRESH_MIN_INTERVAL) {
                    $this->SetBuffer('LastRefresh', (string) time());
                    $this->RefreshAccessToken();
                }
                return;
            case 'State':
                $this->HandleState((string) $Value);
                return;
            case 'Device':
                $device = (string) $Value;
                if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $device)) {
                    throw new InvalidArgumentException('Invalid device');
                }
                $this->SetBuffer('WantedDevice', $device . '|' . time());
                return;
            case 'Player':
            case 'Ghosts':
                $this->HandlePlayers($Ident, (string) $Value);
                return;
            case 'AddFavorite':
                $this->QueueFavorite((string) $Value);
                return;
            case 'Debug':
                // Fehler der Kachel ins Debug-Fenster der Instanz (nur sichtbar, wenn Debug läuft)
                $this->SendDebug('Tile', mb_substr((string) $Value, 0, 1000), 0);
                return;
        }
        throw new InvalidArgumentException('Invalid ident ' . $Ident);
    }

    public function Play(): bool
    {
        return $this->SendCommand('play');
    }

    public function Pause(): bool
    {
        return $this->SendCommand('pause');
    }

    public function Next(): bool
    {
        return $this->SendCommand('next');
    }

    public function Previous(): bool
    {
        return $this->SendCommand('previous');
    }

    public function SetVolume(int $Volume): bool
    {
        return $this->SendCommand('volume', ['value' => max(0, min(100, $Volume))]);
    }

    public function SetShuffle(bool $Shuffle): bool
    {
        return $this->SendCommand('shuffle', ['value' => $Shuffle]);
    }

    /** 0 = aus, 1 = alle, 2 = Titel */
    public function SetRepeat(int $Repeat): bool
    {
        return $this->SendCommand('repeat', ['value' => max(0, min(2, $Repeat))]);
    }

    public function PlayFavorite(int $Index): bool
    {
        foreach ($this->Favorites() as $favorite) {
            if ($favorite['index'] === $Index) {
                $sent = $this->SendCommand('playItem', ['type' => $favorite['type'], 'id' => $favorite['id']]);
                if ($sent && @IPS_GetObjectIDByIdent('Favorite', $this->InstanceID) !== false) {
                    $this->SetValue('Favorite', $Index);
                }
                return $sent;
            }
        }
        $this->LogMessage(sprintf($this->Translate('Favorite %d does not exist'), $Index), KL_WARNING);
        return false;
    }

    public function PlayURL(string $URL): bool
    {
        $link = SpotifyLink::Parse($URL);
        if ($link === null) {
            $this->LogMessage($this->Translate('Not a valid open.spotify.com link'), KL_WARNING);
            return false;
        }
        return $this->SendCommand('playItem', ['type' => $link['type'], 'id' => $link['id']]);
    }

    /** Wiedergabe auf ein Spotify-Connect-Gerät holen (Name wie in der Spotify-App, Groß-/Kleinschreibung egal). */
    public function TransferPlayback(string $DeviceName): bool
    {
        if (!$this->SignedIn()) {
            return false;
        }
        try {
            $devices = $this->Api('GET', '/v1/me/player/devices')['devices'] ?? [];
        } catch (\Throwable $e) {
            $this->LogMessage($this->Translate('Spotify command failed') . ' (devices): ' . $e->getMessage(), KL_WARNING);
            return false;
        }
        foreach (is_array($devices) ? $devices : [] as $device) {
            if (is_array($device) && is_string($device['id'] ?? null) && mb_strtolower((string) ($device['name'] ?? '')) === mb_strtolower(trim($DeviceName))) {
                $this->SetBuffer('WantedDevice', $device['id'] . '|' . time());
                return $this->SendCommand('transfer', ['device' => $device['id']]);
            }
        }
        $this->LogMessage(sprintf($this->Translate('Spotify device "%s" not found'), $DeviceName), KL_WARNING);
        return false;
    }

    /** Einmaliger Abgleich kurz nach einem Befehl (Timer PollOnce) */
    public function PollOnce(): void
    {
        $this->SetTimerInterval('PollOnce', 0);
        $this->UpdateState();
        $this->SchedulePoll();
    }

    /** Vom Timer ApplyFavorites aufgerufen: Favoritenliste samt neuer Einträge aus der Kachel. */
    public function TakePendingFavorites(): string
    {
        $this->SetTimerInterval('ApplyFavorites', 0);
        $rows = json_decode($this->ReadPropertyString('Favorites'), true);
        $rows = is_array($rows) ? $rows : [];
        $known = [];
        foreach ($rows as $row) {
            $link = is_array($row) ? SpotifyLink::Parse((string) ($row['URL'] ?? '')) : null;
            if ($link !== null) {
                $known[$link['uri']] = true;
            }
        }
        foreach (json_decode($this->GetBuffer('PendingFavorites'), true) ?: [] as $favorite) {
            $link = SpotifyLink::Parse($favorite['URL']);
            if ($link !== null && !isset($known[$link['uri']])) {
                $known[$link['uri']] = true;
                $rows[] = $favorite;
            }
        }
        $this->SetBuffer('PendingFavorites', '');
        return json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Favorit aus der Kachel vormerken; der Timer ApplyFavorites übernimmt ihn in die Property. */
    private function QueueFavorite(string $Json): void
    {
        $data = json_decode($Json, true);
        $type = is_array($data) ? ($data['type'] ?? '') : '';
        $id = is_array($data) ? (string) ($data['id'] ?? '') : '';
        if (!in_array($type, ['playlist', 'album', 'track', 'artist'], true) || !SpotifyLink::ValidId($id)) {
            throw new InvalidArgumentException('Invalid favorite');
        }
        $name = trim((string) ($data['name'] ?? ''));
        $pending = json_decode($this->GetBuffer('PendingFavorites'), true) ?: [];
        $pending[] = ['Name' => mb_substr($name !== '' ? $name : $id, 0, 100), 'URL' => 'https://open.spotify.com/' . $type . '/' . $id];
        $this->SetBuffer('PendingFavorites', json_encode(array_slice($pending, -20), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->SetTimerInterval('ApplyFavorites', 200);
    }

    /**
     * Was die Kacheln beim Laden fest einbauen (Connect, Gerätename, angemeldet) und die Favoriten, je als Hash.
     * @return array{0: string, 1: string}
     */
    private function TileHashes(): array
    {
        return [
            hash('sha256', json_encode([$this->ConnectURL() !== '', $this->ReadPropertyString('PlayerName'), $this->SignedIn()])),
            hash('sha256', json_encode($this->Favorites())),
        ];
    }

    /** An- und Abmelden laden die Kacheln selbst neu (Push auth): den Stand merken, sonst lädt das nächste ApplyChanges sie noch einmal. */
    private function RememberTileHash(): void
    {
        $this->WriteAttributeString('TileHash', implode('|', $this->TileHashes()));
    }

    /** Zustand aus der Kachel (SDK-Gerät oder abgefragtes Connect-Gerät) in die Variablen. */
    private function HandleState(string $Json): void
    {
        $state = json_decode($Json, true);
        if (!is_array($state)) {
            throw new InvalidArgumentException('Invalid state');
        }
        // Frischer Zustand aus einer Kachel: der Timer Poll fragt dann selbst nicht ab
        $this->SetBuffer('TileReport', (string) time());
        $text = static fn (mixed $v, int $max): string => is_string($v) ? mb_substr($v, 0, $max) : '';
        $playing = ($state['playing'] ?? false) === true;
        $hasItem = $text($state['title'] ?? '', 300) !== '';
        $this->SetIfChanged('Playback', $playing ? 2 : ($hasItem ? 3 : 1));
        $this->SetIfChanged('Title', $text($state['title'] ?? '', 300));
        $this->SetIfChanged('Artist', $text($state['artist'] ?? '', 300));
        $this->SetIfChanged('Album', $text($state['album'] ?? '', 300));
        $cover = $text($state['cover'] ?? '', 1000);
        $this->SetIfChanged('Cover', str_starts_with($cover, 'https://') ? $cover : '');
        if (is_numeric($state['volume'] ?? null)) {
            $this->SetIfChanged('Volume', max(0, min(100, (int) round((float) $state['volume']))));
        }
        $this->SetIfChanged('Shuffle', ($state['shuffle'] ?? false) === true);
        $this->SetIfChanged('Repeat', max(0, min(2, (int) ($state['repeat'] ?? 0))));
        $this->SetIfChanged('Device', $text($state['device'] ?? '', 60));
        $deviceId = $text($state['deviceId'] ?? '', 80);
        // Das SDK-Gerät der Kachel: Rückfall für Befehle, wenn kein Gerät aktiv ist
        if (($state['local'] ?? false) === true && preg_match('/^[A-Za-z0-9_-]{1,80}$/', $deviceId)) {
            $this->SetBuffer('TileDevice', $deviceId);
        }
    }

    /** Nach dem Abmelden bleibt nichts von Spotify zurück (Developer Terms V.9): Variablen und Gerätepuffer leeren. */
    private function ClearState(): void
    {
        foreach (['Title', 'Artist', 'Album', 'Cover', 'Device'] as $ident) {
            $this->SetIfChanged($ident, '');
        }
        $this->SetIfChanged('Playback', 1);
        foreach (['TileDevice', 'WantedDevice', 'PendingFavorites', 'Players'] as $buffer) {
            $this->SetBuffer($buffer, '');
        }
    }

    /** @return list<array{index: int, name: string, type: string, id: string, uri: string}> */
    private function Favorites(): array
    {
        $rows = json_decode($this->ReadPropertyString('Favorites'), true);
        $favorites = [];
        foreach (is_array($rows) ? $rows : [] as $index => $row) {
            $link = is_array($row) ? SpotifyLink::Parse((string) ($row['URL'] ?? '')) : null;
            $name = is_array($row) ? trim((string) ($row['Name'] ?? '')) : '';
            if ($link !== null) {
                $favorites[] = ['index' => (int) $index, 'name' => $name !== '' ? mb_substr($name, 0, 100) : $link['id']] + $link;
            }
        }
        return $favorites;
    }

    private function SetIfChanged(string $Ident, mixed $Value): void
    {
        if ($this->GetValue($Ident) !== $Value) {
            $this->SetValue($Ident, $Value);
        }
    }

    private function PushToTiles(array $Message): void
    {
        $this->UpdateVisualizationValue(json_encode($Message));
    }
}
