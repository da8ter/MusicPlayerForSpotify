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
 * Das Modul hält die Anmeldung (OAuth mit PKCE), spiegelt den Zustand in Variablen und führt
 * Befehle aus Skripten direkt über die Web API aus; dafür muss keine Kachel offen sein.
 */
class MusicPlayerForSpotify extends IPSModuleStrict
{
    use MusicPlayerSpotifyAuthTrait;
    use MusicPlayerSpotifyApiTrait;
    use MusicPlayerSpotifyVariablesTrait;

    private const MODULE_GUID = '{E52C1561-E92E-4C39-9EDE-988A9285B8A1}';
    private const STATUS_NO_CLIENT = 201;
    private const STATUS_SIGNED_OUT = 202;
    private const PLAYBACK_COMMANDS = [0 => 'previous', 1 => 'pause', 2 => 'play', 3 => 'pause', 4 => 'next'];
    private const REFRESH_MIN_INTERVAL = 20;

    // Texte der Kachel, übersetzt über locale.json
    private const TILE_TEXTS = [
        'Sign in with Spotify', 'Not signed in to Spotify', 'Enter the Client ID in the instance first',
        'Sign-in window blocked: allow pop-ups for this page', 'Sign-in expired. Please sign in again.',
        'Spotify Premium is required for playback', 'Spotify could not be loaded',
        'Home', 'New', 'Library', 'Search', 'Favorites', 'Playlists', 'Albums', 'Artists', 'Liked Songs', 'Recently played',
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
        'Playback needs a secure connection (https). Open the visualization via the Connect address.',
    ];

    public function Create(): void
    {
        parent::Create();

        $this->RegisterPropertyString('ClientID', '');
        $this->RegisterPropertyString('RedirectBase', '');
        $this->RegisterPropertyString('PlayerName', 'Symcon');
        $this->RegisterPropertyInteger('PollInterval', 10);
        $this->RegisterPropertyString('Favorites', '[]');

        $this->RegisterAttributeString('RefreshSecret', '');
        $this->RegisterAttributeString('AccessSecret', '');
        $this->RegisterAttributeInteger('AccessExpiry', 0);
        $this->RegisterAttributeString('UserID', '');
        $this->RegisterAttributeString('UserName', '');
        $this->RegisterAttributeString('Product', '');
        $this->RegisterAttributeString('TileHash', '');

        $this->RegisterTimer('RefreshToken', 0, 'SPM_RefreshAccessToken($_IPS[\'TARGET\']);');
        $this->RegisterTimer('Poll', 0, 'SPM_UpdateState($_IPS[\'TARGET\']);');
        $this->RegisterTimer('PollOnce', 0, 'SPM_PollOnce($_IPS[\'TARGET\']);');
        // Favoriten aus der Kachel: die Property von außen übernehmen, denn ApplyChanges der
        // eigenen Instanz aus einer Modulfunktion heraus lehnt Symcon ab (re-entranter Aufruf).
        $this->RegisterTimer('ApplyFavorites', 0, 'IPS_SetProperty($_IPS[\'TARGET\'], \'Favorites\', SPM_TakePendingFavorites($_IPS[\'TARGET\'])); IPS_ApplyChanges($_IPS[\'TARGET\']);');
        $this->RegisterHook(self::HOOK);
        $this->SetVisualizationType(defined('INSTANCE_VISUALIZATION_TYPE_HTML_FULLSCREEN') ? INSTANCE_VISUALIZATION_TYPE_HTML_FULLSCREEN : 1);
    }

    public function ApplyChanges(): void
    {
        parent::ApplyChanges();

        if (IPS_GetKernelRunlevel() !== KR_READY) {
            $this->RegisterMessage(0, IPS_KERNELSTARTED);
            return;
        }

        $this->RegisterHook(self::HOOK);
        $this->RegisterVariables();
        $this->ApplySignedIn();

        // Kacheln nur neu laden, wenn sich etwas für sie geändert hat; geänderte Favoriten gehen als
        // Nachricht hinaus (ein Favorit aus der Kachel soll nicht alle Geräte neu laden).
        $tileHash = hash('sha256', json_encode([trim($this->ReadPropertyString('ClientID')), $this->ReadPropertyString('PlayerName'), $this->SignedIn()]));
        $previous = $this->ReadAttributeString('TileHash');
        $favorites = $this->Favorites();
        $favoritesHash = hash('sha256', json_encode($favorites));
        $this->WriteAttributeString('TileHash', $tileHash . '|' . $favoritesHash);
        if ($previous === '' || !str_starts_with($previous, $tileHash . '|')) {
            $this->PushToTiles(['type' => 'reload']);
        } elseif ($previous !== $tileHash . '|' . $favoritesHash) {
            $this->PushToTiles(['type' => 'favorites', 'favorites' => $favorites]);
        }
    }

    /** Status und Timer nach Anmeldung, Abmeldung oder Übernehmen */
    private function ApplySignedIn(): void
    {
        if (trim($this->ReadPropertyString('ClientID')) === '') {
            $this->SetStatus(self::STATUS_NO_CLIENT);
        } elseif (!$this->SignedIn()) {
            $this->SetStatus(self::STATUS_SIGNED_OUT);
        } else {
            $this->SetStatus(IS_ACTIVE);
        }
        $this->ScheduleRefresh();
        $this->SetTimerInterval('Poll', $this->SignedIn() ? max(0, $this->ReadPropertyInteger('PollInterval')) * 1000 : 0);
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
        $redirect = $this->GetRedirectURI();
        foreach ($form['actions'] as &$action) {
            if (($action['name'] ?? '') === 'RedirectInfo') {
                $action['caption'] = $redirect !== ''
                    ? sprintf($this->Translate('Redirect URI for the Spotify app: %s'), $redirect)
                    : $this->Translate('No Connect address found: enter the public base address (https) above');
            }
            if (($action['name'] ?? '') === 'LoginInfo') {
                $action['caption'] = $this->SignedIn()
                    ? sprintf($this->Translate('Signed in to Spotify as %s (%s)'), $this->ReadAttributeString('UserName'), $this->ReadAttributeString('Product'))
                    : $this->Translate('Not signed in to Spotify');
            }
        }
        unset($action);
        return json_encode($form);
    }

    public function GetVisualizationTile(): string
    {
        $clientId = trim($this->ReadPropertyString('ClientID'));
        $signedIn = $clientId !== '' && $this->SignedIn();
        $texts = [];
        foreach (self::TILE_TEXTS as $text) {
            $texts[$text] = $this->Translate($text);
        }
        $config = [
            'mode'        => $clientId === '' ? 'setup' : ($signedIn ? 'player' : 'login'),
            // Sichtbar für jeden mit Zugang zur Visualisierung: dieselben Personen bedienen den Player.
            'accessToken' => $signedIn ? $this->AccessToken(true) : '',
            'expiresAt'   => $signedIn ? $this->ReadAttributeInteger('AccessExpiry') : 0,
            'premium'     => $this->ReadAttributeString('Product') === 'premium',
            'playerName'  => mb_substr(trim($this->ReadPropertyString('PlayerName')) ?: 'Symcon', 0, 60),
            'userId'      => $this->ReadAttributeString('UserID'),
            'favorites'   => $this->Favorites(),
            'texts'       => $texts,
        ];
        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
        return strtr((string) file_get_contents(__DIR__ . '/module.html'), [
            '/*STYLE*/'      => file_get_contents(__DIR__ . '/assets/player.css') . "\n" . file_get_contents(__DIR__ . '/assets/layout.css'),
            '/*CONFIG*/null' => json_encode($config, $flags),
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

    /** Rückruf von Spotify nach der Anmeldung (/hook/spotifyplayer?code=…&state=<Instanz>.<Zufall>) */
    protected function ProcessHookData(): void
    {
        $code = (string) ($_GET['code'] ?? '');
        $state = (string) ($_GET['state'] ?? '');
        $error = (string) ($_GET['error'] ?? '');
        if ($error !== '') {
            $message = $this->Translate('Sign-in failed') . ': ' . mb_substr($error, 0, 100);
        } else {
            $target = (int) strtok($state, '.');
            if ($target === $this->InstanceID) {
                $message = $this->CompleteAuth($code, $state);
            } elseif ($target > 0 && IPS_InstanceExists($target) && IPS_GetInstance($target)['ModuleInfo']['ModuleID'] === self::MODULE_GUID) {
                $message = SPM_CompleteAuth($target, $code, $state);
            } else {
                $message = $this->Translate('Sign-in rejected: unknown or expired request');
            }
        }
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
                // Anmeldeadresse erst beim Klick erzeugen; nur die anfragende Kachel (playerId) öffnet sie
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
                $this->SetBuffer('WantedDevice', $device);
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
                $this->SetBuffer('WantedDevice', $device['id']);
                return $this->SendCommand('transfer');
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

    /** Zustand aus der Kachel (SDK-Gerät oder abgefragtes Connect-Gerät) in die Variablen. */
    private function HandleState(string $Json): void
    {
        $state = json_decode($Json, true);
        if (!is_array($state)) {
            throw new InvalidArgumentException('Invalid state');
        }
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
        if (preg_match('/^[A-Za-z0-9_-]{1,80}$/', $deviceId)) {
            $this->SetBuffer(($state['local'] ?? false) === true ? 'TileDevice' : 'ActiveDevice', $deviceId);
        }
    }

    /** Nach dem Abmelden bleibt nichts von Spotify zurück (Developer Terms V.9): Variablen und Gerätepuffer leeren. */
    private function ClearState(): void
    {
        foreach (['Title', 'Artist', 'Album', 'Cover', 'Device'] as $ident) {
            $this->SetIfChanged($ident, '');
        }
        $this->SetIfChanged('Playback', 1);
        foreach (['TileDevice', 'ActiveDevice', 'WantedDevice', 'PendingFavorites'] as $buffer) {
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
