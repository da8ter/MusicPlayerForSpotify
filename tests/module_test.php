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

    public function hook(): void
    {
        $this->ProcessHookData();
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
check(in_array('spotifyplayer', $module->hooks, true), 'Hook: /hook/spotifyplayer in Create registriert');
$runlevel = KR_READY;
$module->MessageSink(0, 0, IPS_KERNELSTARTED, []);
check(isset($module->variables['Playback']) && $module->status === 201, 'Module Strict: nach IPS_KERNELSTARTED Variablen angelegt; ohne Client-ID Status 201');
check(!preg_match('/IPS_ApplyChanges\s*\(\s*\$this->InstanceID/', (string) file_get_contents(__DIR__ . '/../SpotifyPlayer/module.php')), 'Kein re-entrantes IPS_ApplyChanges im Modul');

// ── Anmeldung (PKCE) ──
$connect = [40000]; // Connect-Control-Instanz der Attrappe
IPS_SetProperty(12345, 'ClientID', 'client123');
IPS_SetProperty(12345, 'Favorites', json_encode([['Name' => 'Mix', 'URL' => 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'], ['Name' => 'kaputt', 'URL' => 'x'], ['Name' => '', 'URL' => 'spotify:track:4uLU6hMCjMI75M1A2tKUQC']]));
IPS_ApplyChanges(12345);
check($module->status === 202 && count($module->updates) === 2 && end($module->updates) === ['type' => 'reload'], 'Status 202 ohne Anmeldung; geänderte Client-ID lädt die Kacheln neu');
check($module->GetRedirectURI() === 'https://example.ipmagic.de/hook/spotifyplayer', 'Redirect-URI aus der Connect-Adresse');
$url = $module->GetAuthURL();
parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
$pending = json_decode($module->buffers['Auth'], true);
$verifier = $pending[$q['state']]['verifier'];
check(str_starts_with($url, 'https://accounts.spotify.com/authorize?') && $q['client_id'] === 'client123' && $q['code_challenge_method'] === 'S256'
    && $q['redirect_uri'] === 'https://example.ipmagic.de/hook/spotifyplayer' && str_contains($q['scope'], 'streaming'), 'Anmeldeadresse: Client-ID, Redirect-URI, Scopes');
check(preg_match('/^12345\.[a-f0-9]{32}$/', $q['state']) === 1 && $q['code_challenge'] === rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='), 'PKCE: Zustand trägt die Instanz, Challenge = SHA-256 des Prüfwerts');
check($module->CompleteAuth('code', '12345.' . str_repeat('a', 32)) !== '' && $module->http === [], 'Rückruf: unbekannter Zustand wird ohne Netzaufruf abgelehnt');
$module->responses = [$json(['access_token' => 'ACCESS1xxxxxxxxxxxxxxxxxxxx', 'refresh_token' => 'REFRESH1xxxxxxxxxxxxxxxxxxx', 'expires_in' => 3600]), $json(['id' => 'stephan', 'display_name' => 'Stephan', 'product' => 'premium'])];
check($module->CompleteAuth('thecode', $q['state']) === '', 'Rückruf: Code gegen Token getauscht');
parse_str((string) $module->http[0]['body'], $post);
check($module->http[0]['method'] === 'POST' && str_starts_with($module->http[0]['url'], 'https://accounts.spotify.com/api/token') && $post['code'] === 'thecode' && $post['code_verifier'] === $verifier && !isset($post['client_secret']), 'Token-Tausch mit Prüfwert, ohne Client Secret');
check($module->http[1]['url'] === 'https://api.spotify.com/v1/me' && in_array('Authorization: Bearer ACCESS1xxxxxxxxxxxxxxxxxxxx', $module->http[1]['headers'], true), 'Nach der Anmeldung Profil geholt');
check($module->status === IS_ACTIVE && $module->attributes['UserID'] === 'stephan' && $module->attributes['Product'] === 'premium', 'Angemeldet: Status aktiv, Profil gespeichert');
check(!str_contains(json_encode($module->attributes), 'REFRESH1xxxxxxxxxxxxxxxxxxx') && !str_contains(json_encode($module->attributes), 'ACCESS1xxxxxxxxxxxxxxxxxxxx'), 'Token liegen nur verschlüsselt in Attributen');
check(end($module->updates) === ['type' => 'auth', 'signedIn' => true], 'Anmeldung: Kacheln bekommen das Signal auth');
check($module->CompleteAuth('thecode', $q['state']) !== '', 'Rückruf: derselbe Zustand gilt nur einmal');
check($module->timers['RefreshToken'] > 0 && $module->timers['Poll'] === 10000, 'Timer: Token-Erneuerung und Abfrage laufen');

// ── Hook ──
$_GET = ['error' => 'access_denied'];
ob_start();
$module->hook();
$out = ob_get_clean();
check(str_contains($out, 'access_denied') && !str_contains($out, 'window.close'), 'Hook: Fehler von Spotify wird angezeigt');
$_GET = ['code' => 'x', 'state' => '12345.' . str_repeat('b', 32)];
ob_start();
$module->hook();
$out = ob_get_clean();
check(str_contains($out, 'unknown or expired'), 'Hook: unbekannter Zustand abgelehnt');
$_GET = ['code' => 'x<script>', 'state' => '<b>'];
ob_start();
$module->hook();
$out = ob_get_clean();
check(!str_contains($out, '<script>') && !str_contains($out, '<b>'), 'Hook: Eingaben landen nicht roh in der Seite');

// ── Token-Erneuerung ──
$module->http = [];
$module->responses = [$json(['access_token' => 'ACCESS2xxxxxxxxxxxxxxxxxxxx', 'expires_in' => 3600])];
check($module->RefreshAccessToken() && end($module->updates)['type'] === 'token' && end($module->updates)['accessToken'] === 'ACCESS2xxxxxxxxxxxxxxxxxxxx', 'Erneuerung: neues Token geht per Push an die Kacheln');
parse_str((string) $module->http[0]['body'], $post);
check($post['grant_type'] === 'refresh_token' && $post['refresh_token'] === 'REFRESH1xxxxxxxxxxxxxxxxxxx', 'Erneuerung mit dem gespeicherten Refresh-Token');
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
check($config['mode'] === 'player' && $config['accessToken'] === 'ACCESS3xxxxxxxxxxxxxxxxxxxx' && $config['userId'] === 'stephan' && $config['premium'] === true && count($config['favorites']) === 2, 'Kachel: angemeldet mit Token, Profil und Favoriten');
// ── Übernehmen: nur bei Änderungen am Anmeldestand neu laden, geänderte Favoriten als Nachricht ──
IPS_ApplyChanges(12345);
check(end($module->updates) === ['type' => 'reload'], 'Übernehmen nach der Anmeldung lädt neu (Anmeldestand ist Teil der Kachel)');
$before = count($module->updates);
IPS_ApplyChanges(12345);
check(count($module->updates) === $before, 'Unverändertes Übernehmen schickt nichts');
IPS_SetProperty(12345, 'Favorites', json_encode([['Name' => 'Neu', 'URL' => 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy']]));
IPS_ApplyChanges(12345);
check(end($module->updates)['type'] === 'favorites' && end($module->updates)['favorites'][0]['type'] === 'album', 'Geänderte Favoriten gehen als Nachricht an die Kacheln');
$module->RequestAction('AddFavorite', json_encode(['type' => 'track', 'id' => '4uLU6hMCjMI75M1A2tKUQC', 'name' => 'T']));
check($module->timers['ApplyFavorites'] === 200 && count(json_decode($module->TakePendingFavorites(), true)) === 2, 'Favorit aus der Kachel: vorgemerkt und beim Übernehmen angehängt');
check(throws(fn () => $module->RequestAction('AddFavorite', json_encode(['type' => 'show', 'id' => '4uLU6hMCjMI75M1A2tKUQC'])), InvalidArgumentException::class), 'Favorit aus der Kachel: fremder Typ abgelehnt');

// ── Abmelden ──
$module->Logout();
check($module->status === 202 && end($module->updates) === ['type' => 'auth', 'signedIn' => false] && $module->timers['Poll'] === 0, 'Abmelden: Status, Signal und Timer');
IPS_ApplyChanges(12345);
check(end($module->updates) === ['type' => 'reload'], 'Übernehmen nach Abmeldung lädt neu');
$config = json_decode((static function (string $html): string { preg_match('#window\.SPM_CONFIG = (.*?);</script>#s', $html, $m); return $m[1]; })($module->GetVisualizationTile()), true);
check($config['mode'] === 'login' && $config['accessToken'] === '' && str_starts_with($config['authUrl'], 'https://accounts.spotify.com/authorize?'), 'Kachel ohne Anmeldung: kein Token, aber Anmeldeadresse');

echo PHP_EOL . 'All tests passed' . PHP_EOL;
