# Musikplayer für Spotify (Symcon)

Symcon-Kachel (HTML-SDK), die Spotify über das Web Playback SDK abspielt und Spotify-Connect-Geräte über die Web API steuert. Repo `da8ter/MusicPlayerForSpotify` (privat auf GitHub, Zweig `main`). Entstanden am 10.10.2026 als Schwester des Apple-Moduls (`../MusicPlayerForAppleMusic`): Kachel-Aufbau, Navigation, Listen, Player und Prüfstand sind von dort übernommen. Auf der SymBox ohne Git per MCP `module_write` installiert, Abgleich über `module_list`-SHA. Bedienung: `SpotifyPlayer/README.md`.

Betriebsdaten dieses Rechners (Testinstanz, Client-ID) stehen in `CLAUDE.local.md` (nicht eingecheckt).

## Aufbau

- **`SpotifyPlayer/`**: einziges Modul „Music Player For Spotify“, Klasse `MusicPlayerForSpotify`, Anzeigename über locale.json „Musikplayer für Spotify“, Präfix `SPM`, `IPSModuleStrict`.
- **Kachel:** `module.html` ist ein Gerüst; `GetVisualizationTile` setzt `assets/player.css` + `layout.css`, die Skripte und die Startdaten (`SPM_CONFIG`) per `strtr` ein. Aufbau wie die Musik-Apps: Start, Neu, Mediathek, Suchen; unter 720 px Reiter unten mit Mini-Player, darüber Seitenleiste (`html.wide`); sehr kleine Kacheln nur Cover und Steuerung (`html.compact`). `AMP.start()` steht als letztes Skript. Die JS-Namen `AMP*` sind vom Apple-Modul geerbt und bewusst gleich geblieben (gemeinsamer Code).
  - `core.js`: SDK-Player laden (im Browser im Visu-Hauptfenster, sonst in der Kachel; iOS ohne SDK), Web API mit Token-Nachforderung bei 401, Zustand (SDK oder abgefragtes Connect-Gerät, Abfrage alle 5 s bei sichtbarer Kachel), Befehle, Meldung an Symcon.
  - `icons.js`: Font Awesome Light aus `/icons.js` der Visu, Spotify-Logo aus den Brands (`fab`).
  - `nav.js`, `scroll.js`, `player.css`, `layout.css`: wie im Apple-Modul.
  - `ui.js`: Navigation, Listen, Kacheln, Suche (`/v1/search`), Seitenwechsel; `window.AMPUI`.
  - `views.js`: Start (recently-played, top artists/tracks, new-releases), Neu, Mediathek-Kategorien mit `next`-Seiten.
  - `details.js`: Künstler (top-tracks, albums), Album/Playlist mit Trackliste (`apiAll` folgt `next`), Album des laufenden Titels.
  - `actions.js`: Warteschlange, Playlists (anlegen, befüllen, umbenennen, Titel entfernen, löschen), Mediathek/Folgen, Kachel-Favoriten.
  - `player.js`: Mini-Player, „Läuft gerade“, Warteschlange (`/v1/me/player/queue`, nur lesend), Geräteauswahl (Connect), Gefällt mir.
- **libs/**: `AuthTrait.php` (PKCE, Hook-Rückruf, Token-Erneuerung, `Http()` für Tests überschreibbar), `ApiTrait.php` (Web API aus PHP: Befehle an Geräte, `UpdateState`), `SecretStore.php` (sodium, Schlüsseldatei `SpotifyPlayer.key`), `SpotifyLink.php`, `VariablesTrait.php`.
- **Anmeldung:** OAuth 2.0 mit PKCE, ohne Client Secret. Hook `/hook/spotifyplayer` (nativ per `RegisterHook`, in `Create` und `ApplyChanges`); der `state` trägt die Instanz-ID, sodass bei mehreren Instanzen die richtige den Code tauscht (`SPM_CompleteAuth`). Redirect-URI = Connect-Adresse (`CC_GetConnectURL`) oder Property `RedirectBase`.
- **Token:** Refresh- und Access-Token verschlüsselt in Attributen; Timer `RefreshToken` erneuert 2 min vor Ablauf; die Kachel bekommt neue Token per Push `token` und fordert sie bei 401 über `RequestAction('RefreshToken')` an (höchstens alle 20 s).
- **Nachrichten an die Kacheln:** `reload`, `auth` (`signedIn`), `token` (`accessToken`, `expiresAt`), `favorites`. Kachel → Modul über `requestAction`: `Logout`, `RefreshToken`, `State`, `Device`, `AddFavorite`.

## Prüfen

```bash
php -l SpotifyPlayer/module.php; for f in libs/*.php; do php -l "$f"; done
for f in SpotifyPlayer/assets/*.js; do node --check "$f"; done
php tests/module_test.php
git diff --check
```

Umfang und Handprobe: `tests/README.md`. Prüfstand mit Beispieldaten (Chrome ohne Fenster): Skripte im Scratchpad der Sitzung, Muster wie beim Apple-Modul (`fakecore.js` ersetzt `core.js`).

## Regeln

- **Spotify-Bedingungen:** Wiedergabe und Steuerung nur mit Premium; nie Zugang an Bezahlung knüpfen; Spotify-Logo als Herkunftshinweis anzeigen (`.brand`); Inhalte nicht mit anderen Diensten mischen. Apps bleiben im Development Mode (bis 25 Nutzer, je Nutzer eigene App).
- **Seit November 2024 fehlen neuen Apps:** recommendations, related-artists, audio-features, featured-playlists, category playlists, Vorschau-URLs. Nicht verwenden.
- **Warteschlange:** `POST /v1/me/player/queue` hängt nur einzelne Titel hinten an; kein „Als Nächstes“, kein Umsortieren.
- **Playlists:** eigene (owner = UserID) oder gemeinsame lassen sich bearbeiten; `fields`-Parameter bei `/playlists/{id}/tracks` klein halten; `items[].track` kann null oder eine Episode sein.
- **Geräte:** Befehle brauchen ein Gerät (`NO_ACTIVE_DEVICE` sonst); Reihenfolge aktiv → Kachel-Gerät (`TileDevice`-Puffer aus `State`) → erstes gelistetes; `WantedDevice` aus `RequestAction('Device')` bzw. `TransferPlayback` geht vor.
- **Kein `IPS_ApplyChanges($this->InstanceID)` aus der eigenen Instanz** (re-entrant); Favoriten aus der Kachel über den Timer `ApplyFavorites`.
- **Objekte im Hauptfenster** als Objekte des Hauptfensters anlegen (`new win.Object()`, `new win.Function()` für SDK-Rückrufe), Listener bei `pagehide` abmelden.
- **Commits:** deutsche Botschaft, ein Thema je Commit, **ohne** Co-Authored-By-Zeile; Prüfungen vorher.
- **Nie** `git checkout`/`git restore` auf Dateien.
- **Push und Release nur auf Zuruf.**
- **Öffentliches Repo:** keine IP-Adressen, Ports, Instanz-IDs, Token, Client-IDs, Pfade unter `/Users/`.
- **Symcon-Standards:** `strict_types`, volle Typen, Darstellungen statt Profilen, Texte über `locale.json` (Test prüft, dass alle `T('…')` in `TILE_TEXTS` stehen).

## Wissen

- Gemeinsames Symcon-Plattformwissen: `../List/.claude/docs/plattform/` (Kachel-Nachrichten, Hooks, Geheimnisse).
- Apple-Modul als Vorlage: `../MusicPlayerForAppleMusic/.claude/CLAUDE.md`.
