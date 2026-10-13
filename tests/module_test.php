<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

// Modul mit aufgezeichneten HTTP-Aufrufen statt echtem Netz
final class TestModule extends MusicPlayerForSpotify
{
    public array $http = [];
    public array $responses = [];

    protected function Http(string $Method, string $Url, array $Headers, ?string $Body): array
    {
        $this->http[] = ['method' => $Method, 'url' => $Url, 'headers' => $Headers, 'body' => $Body];
        return array_shift($this->responses) ?? ['status' => 200, 'body' => '{}'];
    }

    public function oauth(): void
    {
        $this->ProcessOAuthData();
    }
}
$json = static fn (array $data): array => ['status' => 200, 'body' => json_encode($data)];

// ── Links ──
$track = SpotifyLink::Parse('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc');
check($track === ['type' => 'track', 'id' => '4uLU6hMCjMI75M1A2tKUQC', 'uri' => 'spotify:track:4uLU6hMCjMI75M1A2tKUQC'], 'Link: Titel mit ?si=');
check(SpotifyLink::Parse('https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy')['type'] === 'album', 'Link: Album mit Sprachpräfix');
check(SpotifyLink::Parse('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')['type'] === 'playlist', 'Link: Playlist');
check(SpotifyLink::Parse('spotify:artist:0OdUWJ0sBjDrqHygGUXeCF')['uri'] === 'spotify:artist:0OdUWJ0sBjDrqHygGUXeCF', 'Link: spotify:-URI');
foreach (['http://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://example.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://user@open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://open.spotify.com/track/kurz', 'https://open.spotify.com/show/4uLU6hMCjMI75M1A2tKUQC', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC<script>', 'javascript:alert(1)'] as $bad) {
    check(SpotifyLink::Parse($bad) === null, 'Link: abgelehnt ' . $bad);
}

// ── Geheimnisspeicher ──
$store = new SpotifySecretStore(IPS_GetKernelDir() . 'secret.key');
$secret = $store->Encrypt('geheim', '1|Refresh');
check($store->Decrypt($secret, '1|Refresh') === 'geheim', 'Secrets: Rundlauf');
check($store->Decrypt($secret, '1|Access') === null && $store->Decrypt($secret, '2|Refresh') === null, 'Secrets: anderes Feld oder andere Instanz entschlüsselt nicht');
check(!str_contains($secret, 'geheim') && (fileperms(IPS_GetKernelDir() . 'secret.key') & 0777) === 0600, 'Secrets: Klartext nicht sichtbar, Schlüsseldatei 0600');
file_put_contents(IPS_GetKernelDir() . 'kaputt.key', 'zu kurz');
check((new SpotifySecretStore(IPS_GetKernelDir() . 'kaputt.key'))->Decrypt($secret, '1|Refresh') === null, 'Secrets: beschädigte Schlüsseldatei liefert null statt Absturz');

// ── Module Strict ──
$runlevel = KR_INIT;
$module = new TestModule(12345);
$module->Create();
$module->ApplyChanges();
check(($module->messages[0] ?? []) === [IPS_KERNELSTARTED] && $module->variables === [], 'Module Strict: wartet vor KR_READY auf IPS_KERNELSTARTED');
check($module->hooks === [] && $module->oauth === [], 'Kein Hook; die OAuth-Kennung wird erst bei der Anmeldung übernommen');
$runlevel = KR_READY;
$module->MessageSink(0, 0, IPS_KERNELSTARTED, []);
check(isset($module->variables['Playback']) && $module->status === 201, 'Module Strict: nach IPS_KERNELSTARTED Variablen angelegt; ohne Connect Status 201');
check($module->GetAuthURL() === '' && $module->oauth === [], 'Ohne Connect keine Anmeldung');
check(!preg_match('/IPS_ApplyChanges\s*\(\s*\$this->InstanceID/', (string) file_get_contents(__DIR__ . '/../SpotifyPlayer/module.php')), 'Kein re-entrantes IPS_ApplyChanges im Modul');

// ── Anmeldung (Symcon-OAuth-Dienst) ──
$connect = [40000]; // Connect-Control-Instanz der Attrappe
IPS_SetProperty(12345, 'Favorites', json_encode([['Name' => 'Mix', 'URL' => 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'], ['Name' => 'kaputt', 'URL' => 'x'], ['Name' => '', 'URL' => 'spotify:track:4uLU6hMCjMI75M1A2tKUQC']]));
IPS_ApplyChanges(12345);
check($module->status === 202 && count($module->updates) === 2 && end($module->updates) === ['type' => 'reload'], 'Status 202 ohne Anmeldung; Connect verfügbar lädt die Kacheln neu');
check($module->CompleteAuth('code') !== '' && $module->http === [], 'Rückruf ohne gestartete Anmeldung wird ohne Netzaufruf abgelehnt');
$url = $module->GetAuthURL();
check($url === 'https://oauth.ipmagic.de/authorize/spotify?username=nutzer%2Btest%40example.com' && $module->oauth === ['spotify'], 'Anmeldeadresse beim Symcon-Dienst mit Lizenznehmer; OAuth-Kennung übernommen');
check($module->CompleteAuth('bad code<') !== '' && $module->http === [], 'Rückruf: ungültiger Code ohne Netzaufruf abgelehnt');
$module->responses = [$json(['token_type' => 'Bearer', 'access_token' => 'ACCESS1xxxxxxxxxxxxxxxxxxxx', 'refresh_token' => 'REFRESH1xxxxxxxxxxxxxxxxxxx', 'expires_in' => 3600]), $json(['id' => 'stephan', 'display_name' => 'Stephan', 'product' => 'premium'])];
check($module->CompleteAuth('thecode') === '', 'Rückruf: Code gegen Token getauscht');
parse_str((string) $module->http[0]['body'], $post);
check($module->http[0]['method'] === 'POST' && $module->http[0]['url'] === 'https://oauth.ipmagic.de/access_token/spotify' && $post === ['code' => 'thecode'], 'Token-Tausch beim Symcon-Dienst, nur mit dem Code');
check($module->http[1]['url'] === 'https://api.spotify.com/v1/me' && in_array('Authorization: Bearer ACCESS1xxxxxxxxxxxxxxxxxxxx', $module->http[1]['headers'], true), 'Nach der Anmeldung Profil geholt');
check($module->status === IS_ACTIVE && $module->attributes['UserID'] === 'stephan' && $module->attributes['Product'] === 'premium' && $module->attributes['TokenSource'] === 'spotify', 'Angemeldet: Status aktiv, Profil und Herkunft gespeichert');
check(!str_contains(json_encode($module->attributes), 'REFRESH1xxxxxxxxxxxxxxxxxxx') && !str_contains(json_encode($module->attributes), 'ACCESS1xxxxxxxxxxxxxxxxxxxx'), 'Token liegen nur verschlüsselt in Attributen');
check(end($module->updates) === ['type' => 'auth', 'signedIn' => true], 'Anmeldung: Kacheln bekommen das Signal auth');
check($module->CompleteAuth('thecode') !== '', 'Rückruf: eine gestartete Anmeldung gilt nur einmal');
check($module->timers['RefreshToken'] > 0 && $module->timers['Poll'] === 60000, 'Timer: Token-Erneuerung läuft, Abfrage ohne Wiedergabe alle 60 s');

// ── Rückrufseite ──
$_GET = ['error' => 'access_denied'];
ob_start();
$module->oauth();
$out = ob_get_clean();
check(str_contains($out, 'access_denied') && !str_contains($out, 'window.close'), 'Rückrufseite: Fehler von Spotify wird angezeigt');
$_GET = ['code' => 'x'];
ob_start();
$module->oauth();
$out = ob_get_clean();
check(str_contains($out, 'unknown or expired'), 'Rückrufseite: Code ohne gestartete Anmeldung abgelehnt');
$_GET = ['error' => '<script>x'];
ob_start();
$module->oauth();
$out = ob_get_clean();
check(!str_contains($out, '<script>x'), 'Rückrufseite: Eingaben landen nicht roh in der Seite');

// ── Token-Erneuerung ──
$module->http = [];
$module->responses = [$json(['access_token' => 'ACCESS2xxxxxxxxxxxxxxxxxxxx', 'expires_in' => 3600])];
check($module->RefreshAccessToken() && end($module->updates)['type'] === 'token' && end($module->updates)['accessToken'] === 'ACCESS2xxxxxxxxxxxxxxxxxxxx', 'Erneuerung: neues Token geht per Push an die Kacheln');
parse_str((string) $module->http[0]['body'], $post);
check($post === ['refresh_token' => 'REFRESH1xxxxxxxxxxxxxxxxxxx'] && $module->http[0]['url'] === 'https://oauth.ipmagic.de/access_token/spotify', 'Erneuerung beim Symcon-Dienst mit dem gespeicherten Refresh-Token');
$module->http = [];
$module->responses = [['status' => 401, 'body' => '{"error":{"status":401}}'], $json(['access_token' => 'ACCESS3xxxxxxxxxxxxxxxxxxxx', 'expires_in' => 3600]), $json(['devices' => [['id' => 'dev1', 'name' => 'Küche', 'is_active' => true]]]), ['status' => 204, 'body' => '']];
check($module->Play() && count($module->http) === 4 && $module->http[3]['method'] === 'PUT' && str_contains($module->http[3]['url'], '/v1/me/player/play?device_id=dev1'), 'Web API: bei 401 Token erneuern und wiederholen; Befehl geht an das aktive Gerät');
check($module->timers['PollOnce'] === 1500, 'Befehl: Variablen werden kurz danach nachgezogen');

// ── Befehle und Geräte ──
$module->http = [];
$module->responses = [$json(['devices' => []])];
check(!$module->Next() && str_contains(end($module->logs), 'No Spotify device'), 'Ohne Gerät: false mit Logmeldung');
$module->http = [];
$module->responses = [$json(['devices' => [['id' => 'dev1', 'name' => 'Küche', 'is_active' => false], ['id' => 'tile1', 'name' => 'Symcon', 'is_active' => false]]]), ['status' => 204, 'body' => '']];
$module->RequestAction('State', json_encode(['playing' => true, 'title' => 'Song', 'deviceId' => 'tile1', 'local' => true, 'volume' => 250, 'repeat' => 9, 'cover' => 'http://x']));
check($module->values['Volume'] === 100 && $module->values['Repeat'] === 2 && $module->values['Cover'] === '' && $module->values['Playback'] === 2, 'Zustand aus der Kachel: Werte begrenzt, nur https-Cover');
check($module->PlayFavorite(0) && json_decode((string) end($module->http)['body'], true) === ['context_uri' => 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'] && str_contains(end($module->http)['url'], 'device_id=tile1'), 'Favorit: Playlist als Kontext auf dem Kachel-Gerät, wenn kein Gerät aktiv ist');
$module->responses = [$json(['devices' => [['id' => 'dev1', 'name' => 'Küche', 'is_active' => true]]]), ['status' => 204, 'body' => '']];
check($module->PlayURL('spotify:track:4uLU6hMCjMI75M1A2tKUQC') && json_decode((string) end($module->http)['body'], true) === ['uris' => ['spotify:track:4uLU6hMCjMI75M1A2tKUQC']], 'PlayURL: Titel als uris');
check(!$module->PlayURL('https://example.com/x') && !$module->PlayFavorite(1), 'Ungültiger Link und fehlender Favorit: false');
$module->responses = [$json(['devices' => [['id' => 'dev1', 'name' => 'Küche', 'is_active' => false]]]), $json(['devices' => [['id' => 'dev1', 'name' => 'Küche', 'is_active' => false]]]), ['status' => 204, 'body' => '']];
check($module->TransferPlayback('küche') && json_decode((string) end($module->http)['body'], true) === ['device_ids' => ['dev1'], 'play' => true], 'TransferPlayback: Gerät nach Namen (Groß-/Kleinschreibung egal)');
check(throws(fn () => $module->RequestAction('Device', 'x y'), InvalidArgumentException::class) && throws(fn () => $module->RequestAction('Nope', 1), InvalidArgumentException::class), 'RequestAction: ungültige Geräte-ID und unbekannter Ident abgelehnt');
$module->responses = [$json(['is_playing' => false, 'item' => ['name' => 'Titel', 'artists' => [['name' => 'A'], ['name' => 'B']], 'album' => ['name' => 'Alb', 'images' => [['url' => 'https://i.scdn.co/x']]]], 'device' => ['id' => 'dev1', 'name' => 'Küche', 'volume_percent' => 40], 'shuffle_state' => true, 'repeat_state' => 'context'])];
check($module->UpdateState() && $module->values['Artist'] === 'A, B' && $module->values['Volume'] === 40 && $module->values['Repeat'] === 1 && $module->values['Playback'] === 3 && $module->values['Device'] === 'Küche', 'UpdateState: Zustand des aktiven Geräts in den Variablen');

// ── Abfragen sparsam: Kachel meldet, Leerlauf seltener, HTTP 429 ──
IPS_SetProperty(12345, 'PollInterval', 15);
IPS_ApplyChanges(12345);
$module->http = [];
$module->RequestAction('State', json_encode(['playing' => true, 'title' => 'Song']));
$module->PollState();
check($module->http === [] && $module->timers['Poll'] === 15000, 'Poll: frische Kachel-Meldung ersetzt die Abfrage; während der Wiedergabe der eingestellte Abstand');
$module->buffers['TileReport'] = (string) (time() - 40);
$module->responses = [$json(['is_playing' => false, 'item' => ['name' => 'T', 'artists' => [], 'album' => ['name' => 'A', 'images' => []]], 'device' => ['id' => 'dev1', 'name' => 'Küche']])];
$module->PollState();
check(count($module->http) === 1 && $module->values['Playback'] === 3 && $module->timers['Poll'] === 60000, 'Poll: ohne Kachel abgefragt; in der Pause höchstens alle 60 s');
$module->http = [];
$module->responses = [['status' => 429, 'body' => '', 'retryAfter' => 120]];
check(!$module->UpdateState() && str_contains(end($module->logs), '120'), 'HTTP 429: Retry-After übernommen und geloggt');
$module->PollState();
check(count($module->http) === 1 && $module->timers['Poll'] >= 119000, 'HTTP 429: keine weiteren Abrufe, Timer wartet Retry-After ab');
check(!$module->Play() && count($module->http) === 1, 'HTTP 429: auch Befehle warten, ohne Spotify anzufragen');
check($module->attributes['RateLimitUntil'] - time() >= 119, 'HTTP 429: Sperre im Attribut (übersteht einen Neustart)');
$module->attributes['RateLimitUntil'] = 0;
$module->responses = [['status' => 429, 'body' => '']];
$module->UpdateState();
$first = $module->attributes['RateLimitUntil'] - time();
$module->attributes['RateLimitUntil'] = 0;
$module->responses = [['status' => 429, 'body' => '']];
$module->UpdateState();
$second = $module->attributes['RateLimitUntil'] - time();
check($first >= 29 && $first <= 30 && $second >= 59 && $second <= 60, 'HTTP 429 ohne Retry-After: 30 s, beim nächsten 429 doppelt so lange');
$module->attributes['RateLimitUntil'] = 0;
$module->responses = [$json(['is_playing' => false])];
$module->UpdateState();
check($module->attributes['RateLimitStep'] === 0, 'Nach einer erfolgreichen Antwort beginnt die Pause wieder bei 30 s');
$module->http = [];

// ── Variablen ──
$profiles = array_filter($module->variables, fn (array $v): bool => !is_array($v['presentation']) || !isset($v['presentation']['PRESENTATION']));
check($profiles === [] && !preg_match("/'~[A-Z]/", (string) file_get_contents(__DIR__ . '/../SpotifyPlayer/module.php')), 'Variablen: keine Profile, nur Darstellungen');
check(array_keys($module->actions) === ['Playback', 'Volume', 'Shuffle', 'Repeat', 'Favorite'], 'Variablen: Aktionen nur an schaltbaren Variablen');
check(array_column(json_decode($module->variables['Favorite']['presentation']['OPTIONS'], true), 'Value') === [0, 2], 'Favoriten: ungültiger Link übersprungen, Indizes bleiben stabil');

// ── Kachel ──
$html = $module->GetVisualizationTile();
check(!preg_match('#/\*(CONFIG|CORE|ICONS|NAV|ACTIONS|UI|DETAILS|VIEWS|PLAYER|SCROLL|STYLE)\*/#', $html) && str_contains($html, 'bindScrollContainment'), 'Kachel: alle Platzhalter ersetzt, Scroll-Eindämmung dabei');
check(substr_count($html, '</script>') === substr_count($html, '<script'), 'Kachel: Skriptblöcke bleiben geschlossen');
preg_match('#window\.SPM_CONFIG = (.*?);</script>#s', $html, $m);
$config = json_decode($m[1], true);
check($config['instance'] === 12345 && $config['mode'] === 'player' && $config['accessToken'] === 'ACCESS3xxxxxxxxxxxxxxxxxxxx' && $config['userId'] === 'stephan' && $config['premium'] === true && count($config['favorites']) === 2, 'Kachel: angemeldet mit Token, Profil und Favoriten');
// ── Übernehmen: nur bei Änderungen am Anmeldestand neu laden, geänderte Favoriten als Nachricht ──
// Die Anmeldung hat die Kacheln schon per auth-Push neu geladen und sich den Stand gemerkt
$before = count($module->updates);
IPS_ApplyChanges(12345);
check(count($module->updates) === $before, 'Übernehmen nach der Anmeldung lädt nicht noch einmal neu');
IPS_SetProperty(12345, 'PlayerName', 'Wohnzimmer');
IPS_ApplyChanges(12345);
check(end($module->updates) === ['type' => 'reload'], 'Geänderter Gerätename lädt die Kacheln neu');
$before = count($module->updates);
IPS_ApplyChanges(12345);
check(count($module->updates) === $before, 'Unverändertes Übernehmen schickt nichts');
IPS_SetProperty(12345, 'Favorites', json_encode([['Name' => 'Neu', 'URL' => 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy']]));
IPS_ApplyChanges(12345);
check(end($module->updates)['type'] === 'favorites' && end($module->updates)['favorites'][0]['type'] === 'album', 'Geänderte Favoriten gehen als Nachricht an die Kacheln');
$module->RequestAction('AddFavorite', json_encode(['type' => 'track', 'id' => '4uLU6hMCjMI75M1A2tKUQC', 'name' => 'T']));
check($module->timers['ApplyFavorites'] === 200 && count(json_decode($module->TakePendingFavorites(), true)) === 2, 'Favorit aus der Kachel: vorgemerkt und beim Übernehmen angehängt');
check(throws(fn () => $module->RequestAction('AddFavorite', json_encode(['type' => 'show', 'id' => '4uLU6hMCjMI75M1A2tKUQC'])), InvalidArgumentException::class), 'Favorit aus der Kachel: fremder Typ abgelehnt');

$module->responses = [$json(['id' => 'stephan', 'product' => 'premium']), ['status' => 403, 'body' => '{"error":{"status":403,"message":"Forbidden"}}']];
$report = $module->TestConnection();
check(str_contains($report, 'Profil (/v1/me): OK (premium)') && str_contains($report, 'HTTP 403 Forbidden'), 'Verbindung prüfen: eine Zeile je Endpunkt mit Ergebnis');

$module->responses = [$json(['items' => [['id' => 'x']]])];
check(json_decode($module->Request('get', '/v1/me/playlists', '{"limit":1}'), true)['items'][0]['id'] === 'x' && str_contains(end($module->http)['url'], 'limit=1'), 'Request: Rohzugriff für Skripte');
check($module->Request('GET', 'https://evil', '') === '' && $module->Request('PATCH', '/v1/me', '') === '', 'Request: fremde Adressen und Methoden abgelehnt');

// ── Abmelden ──
$module->Logout();
check($module->status === 202 && end($module->updates) === ['type' => 'auth', 'signedIn' => false] && $module->timers['Poll'] === 0, 'Abmelden: Status, Signal und Timer');
check($module->values['Title'] === '' && $module->values['Device'] === '' && $module->values['Playback'] === 1 && $module->buffers['TileDevice'] === '', 'Abmelden: Spotify-Daten aus Variablen und Puffern gelöscht');
$before = count($module->updates);
IPS_ApplyChanges(12345);
check(count($module->updates) === $before, 'Übernehmen nach Abmeldung lädt nicht noch einmal neu (auth-Push hat das erledigt)');
$config = json_decode((static function (string $html): string { preg_match('#window\.SPM_CONFIG = (.*?);</script>#s', $html, $m); return $m[1]; })($module->GetVisualizationTile()), true);
check($config['mode'] === 'login' && $config['accessToken'] === '' && !isset($config['authUrl']), 'Kachel ohne Anmeldung: kein Token, keine Anmeldeadresse im Seitenaufbau');
$module->RequestAction('Login', str_repeat('ab', 12));
check(end($module->updates)['type'] === 'login' && end($module->updates)['playerId'] === str_repeat('ab', 12) && str_starts_with(end($module->updates)['url'], 'https://oauth.ipmagic.de/authorize/spotify?'), 'Anmeldung aus der Kachel: Adresse per Push nur für die anfragende Kachel');

// ── Umstieg von der eigenen Spotify-App ──
$old = new TestModule(23456);
$old->Create();
$old->hooks = ['spotifyplayer'];
$old->attributes['RefreshSecret'] = 'alt';
$old->ApplyChanges();
check($old->attributes['RefreshSecret'] === '' && $old->status === 202 && $old->hooks === [], 'Umstieg: Token der eigenen App verworfen, alter Hook abgemeldet');
check(throws(fn () => $module->RequestAction('Login', 'x'), InvalidArgumentException::class), 'Anmeldung aus der Kachel: ungültige Kennung abgelehnt');

echo PHP_EOL . 'All tests passed' . PHP_EOL;
