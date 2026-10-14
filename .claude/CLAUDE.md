# Musikplayer für Spotify (Symcon)

Symcon-Kachel (HTML-SDK), die Spotify über das Web Playback SDK abspielt und Spotify-Connect-Geräte über die Web API steuert. Repo `da8ter/MusicPlayerForSpotify` (privat auf GitHub, Zweig `main`). Entstanden am 10.10.2026 als Schwester des Apple-Moduls (`../MusicPlayerForAppleMusic`): Kachel-Aufbau, Navigation, Listen, Player und Prüfstand sind von dort übernommen. Auf der SymBox ohne Git per MCP `module_write` installiert, Abgleich über `module_list`-SHA. Bedienung: `SpotifyPlayer/README.md`.

Betriebsdaten dieses Rechners (Testinstanz, Client-ID) stehen in `CLAUDE.local.md` (nicht eingecheckt).

## Aufbau

- **`SpotifyPlayer/`**: einziges Modul „Music Player For Spotify“, Klasse `MusicPlayerForSpotify`, Anzeigename über locale.json „Musikplayer für Spotify“, Präfix `SPM`, `IPSModuleStrict`.
- **Kachel:** `module.html` ist ein Gerüst; `GetVisualizationTile` setzt `assets/player.css` + `layout.css`, die Skripte und die Startdaten (`SPM_CONFIG`) per `strtr` ein. Aufbau wie die Musik-Apps: Start, Neu, Entdecken, Mediathek, Suchen; unter 720 px Reiter unten mit Mini-Player, darüber Seitenleiste (`html.wide`); sehr kleine Kacheln nur Cover und Steuerung (`html.compact`). `AMP.start()` steht als letztes Skript. Die JS-Namen `AMP*` sind vom Apple-Modul geerbt und bewusst gleich geblieben (gemeinsamer Code).
  - `webapi.js`: Access-Token (Push `token`, bei 401 nachfordern), Web API mit 429-Pause im Slot, Zwischenspeicher (5 min, nur JSON-Text, höchstens 150 Einträge) – `window.AMPWebApi(ctx)`, von `core.js` erzeugt.
  - `core.js`: SDK-Player laden (im Browser im Visu-Hauptfenster, sonst in der Kachel; läuft auch in der Symcon-iOS-App, am 13.10.2026 gemessen: Gerät „Symcon“ aktiv und spielend; dort im Kachelfenster, weil das Hauptfenster nicht erreichbar ist, also ein Player je Kachelansicht (zwischenzeitlich zwei „Symcon · iPhone“, nach Neuladen nicht mehr aufgetreten); Ausweichen in die Kachel meldet das Debug mit Grund; Safari auf iOS ungeprüft), Web API mit Token-Nachforderung bei 401, Zustand (SDK oder abgefragtes Connect-Gerät, Abfrage alle 10 s bei sichtbarer Kachel, solange ein Connect-Gerät spielt, und kurz nach dem erwarteten Titelende, sonst 30 s; ein Befehl während einer laufenden Abfrage verwirft deren Antwort und fragt gleich neu), Befehle, Meldung an Symcon.
  - `icons.js`: Font Awesome Light aus `/icons.js` der Visu, Spotify-Logo aus den Brands (`fab`).
  - `nav.js`, `scroll.js`, `player.css`, `layout.css`: wie im Apple-Modul.
  - `ui.js`: Navigation, Listen, Kacheln, Suche (`/v1/search`), Seitenwechsel; `window.AMPUI`.
  - `views.js`: Start (recently-played, top artists/tracks, eigene Playlists, Alben, Künstler), Neu (new-releases, neue Alben der eigenen Künstler, zuletzt gespeichert), Entdecken (featured-playlists, browse/categories mit `locale` aus `navigator.language`, Kategorie-Seite mit categories/{id}/playlists), Mediathek-Kategorien mit `next`-Seiten.
  - `details.js`: Künstler (top-tracks, Rückfall Suche; albums mit `limit` 50), Album/Playlist mit Trackliste (`apiAll` folgt `next`), Album des laufenden Titels.
  - `actions.js`: Warteschlange, Playlists (anlegen, befüllen, umbenennen, Titel entfernen, löschen), Mediathek/Folgen, Kachel-Favoriten.
  - `player.js`: Mini-Player, „Läuft gerade“, Warteschlange (`/v1/me/player/queue`, nur lesend), Geräteauswahl (Connect), Gefällt mir.
- **libs/**: `AuthTrait.php` (Anmeldung über den Symcon-OAuth-Dienst, Token-Erneuerung, `Http()` für Tests überschreibbar), `ApiTrait.php` (Web API aus PHP: Befehle an Geräte, `UpdateState`), `SecretStore.php` (sodium, Schlüsseldatei `SpotifyPlayer.key`), `SpotifyLink.php`, `VariablesTrait.php`.
- **Anmeldung (seit 12.10.2026):** über Symcons OAuth-Dienst mit der Kennung `spotify`, also Symcons Spotify-App (dieselbe wie `symcon/SymconSpotify`). `authorize/spotify?username=<IPS_GetLicensee()>` leitet zu Spotify weiter (Scopes legt der Dienst fest, am 12.10.2026 gelesen: alle, die das Modul braucht, dazu `user-read-email` und `app-remote-control`); Rückruf über `oauth.ipmagic.de/forward/spotify` an die Connect-Adresse und `ProcessOAuthData()`. Code-Tausch per POST `code=` an `access_token/spotify`, Erneuerung per POST `refresh_token=` an dieselbe Adresse; das Client Secret liegt beim Dienst. `RegisterOAuth('spotify')` erst beim Start der Anmeldung (`GetAuthURL`), denn die Kennung zeigt auf genau eine Instanz und Symcons Modul registriert sie in seinem `ApplyChanges`; der Puffer `Auth` (Startzeit, 10 min) lässt nur selbst gestartete Anmeldungen zu. Ohne Connect: Status 201, keine Anmeldung. Bis dahin eigene App des Nutzers mit PKCE und Hook `/hook/spotifyplayer`: `MigrateOwnApp()` verwirft solche Token (Attribut `TokenSource`) und meldet den Hook ab. Refresh-Token gelten seit 20.07.2026 sechs Monate (`invalid_grant` → abgemeldet).
- **Token:** Refresh- und Access-Token verschlüsselt in Attributen; Timer `RefreshToken` erneuert 2 min vor Ablauf; die Kachel bekommt neue Token per Push `token` und fordert sie bei 401 über `RequestAction('RefreshToken')` an (höchstens alle 20 s).
- **Nachrichten an die Kacheln:** `reload`, `auth` (`signedIn`), `token` (`accessToken`, `expiresAt`), `favorites`. Kachel → Modul über `requestAction`: `Logout`, `RefreshToken`, `State`, `Device`, `AddFavorite`.

## Prüfen

```bash
php -l SpotifyPlayer/module.php; for f in libs/*.php; do php -l "$f"; done
for f in SpotifyPlayer/assets/*.js; do node --check "$f"; done
php tests/module_test.php
node tests/webapi_test.js
git diff --check
```

Umfang und Handprobe: `tests/README.md`. Prüfstand mit Beispieldaten (Chrome ohne Fenster): Skripte im Scratchpad der Sitzung, Muster wie beim Apple-Modul (`fakecore.js` ersetzt `core.js`).

## Regeln

- **Spotify-Bedingungen:** Wiedergabe und Steuerung nur mit Premium; nie Zugang an Bezahlung knüpfen; Spotify-Logo als Herkunftshinweis anzeigen (`.brand`); Inhalte nicht mit anderen Diensten mischen. Die App gehört Symcon und ist **nicht** im Development Mode (am 12.10.2026 gemessen: top-tracks, browse/new-releases, featured-playlists, categories, fremde Playlists über `/items` und `/tracks`, `limit` 50, Batch-GETs, `contains`, `users/{id}` liefern 200; `/me` mit `product` und `country`). Weiter weg (404): recommendations, related-artists.
- **Spotify Dev-Mode-Umstellung Februar 2026** (gilt für Symcons App nicht, s. o.; die Kachel nutzt trotzdem die neuen Endpunkte, die überall gehen) (Migrationsleitfaden `web-api/tutorials/february-2026-migration-guide`, am 11.10.2026 gegen das Konto des Nutzers gemessen): entfernt sind `browse/*`, `artists/{id}/top-tracks`, `markets`, alle Batch-GETs (`/tracks?ids` usw.), `users/{id}*`, die Einzel-Endpunkte für Mediathek und Folgen (`me/tracks`, `me/albums`, `me/following` als PUT/DELETE/contains) und `playlists/{id}/tracks`. Ersatz: `PUT/DELETE /me/library?uris=`, `GET /me/library/contains?uris=` (Antwort `[bool]`), `POST /me/playlists`, `/playlists/{id}/items` (Einträge unter `items[].item`, nur eigene und gemeinsame Playlists, sonst 403). `limit` höchstens 10 bei `search` und `artists/{id}/albums`. `GET /me` ohne `product`, `email`, `country`. Höchstens 5 Nutzer je App, Inhaber braucht Premium. Dazu seit November 2024: recommendations, related-artists, audio-features, featured-playlists, Vorschau-URLs. Nichts davon verwenden.
- **Abruflimit (Symcons App, geteilt mit allen Installationen beider Spotify-Module):** Spotify zählt je App im gleitenden 30-s-Fenster, Zahlen nennt die Doku nicht. Deshalb sparsam: Timer `Poll` (`PollState`) fragt nicht, solange eine Kachel binnen 35 s gemeldet hat (`TileReport`; die Kachel meldet bei Änderungen und alle 30 s, aber nur sichtbar oder mit spielendem SDK); Abstand während der Wiedergabe = `PollInterval` (Vorgabe 30 s wie Home Assistant), sonst ≥ 60 s. HTTP 429: Modul (Attribute `RateLimitUntil`, `RateLimitStep`, übersteht Neustarts) und Kachel (`slot().rateLimitUntil`/`rateLimitStep`; Browser sehen `Retry-After` nicht) pausieren `Retry-After`, mindestens 30 s, ohne Angabe verdoppelnd bis 1 h, ohne Spotify anzufragen. Recherche 12.10.2026: keine offiziellen Zahlen; Music Assistant drosselt auf 30 Abrufe/30 s, Berichte von `Retry-After` bis 21 h.
- **Warteschlange:** `POST /v1/me/player/queue` hängt nur einzelne Titel hinten an; kein „Als Nächstes“, kein Umsortieren.
- **Playlists:** eigene (owner = UserID) oder gemeinsame lassen sich bearbeiten; `fields`-Parameter bei `/playlists/{id}/tracks` klein halten; `items[].track` kann null oder eine Episode sein.
- **Geräte (PHP):** Befehle gehen ohne `device_id` an das aktive Gerät; nur bei 404 `NO_ACTIVE_DEVICE` wird gelistet: Kachel-Gerät (`TileDevice` aus `State`, nur `local`) → erstes gelistetes. `WantedDevice` (`id|Zeit` aus `RequestAction('Device')` bzw. `TransferPlayback`) geht vor, aber nur 60 s.
- **Kachel ohne Hauptfenster (iOS-App):** Player erst auf Wunsch (`lazyTile`, `ensureTilePlayer`): Platzhalter `TILE_ID` in der Geräteauswahl, Play ohne aktives Gerät legt ihn an; pausiert im Hintergrund (`visibilitychange`) und bei `pagehide` wird er abgemeldet (`dropTilePlayer`). Grund: Die App beendet die Webansicht ohne pagehide, jeder verbundene Player bleibt bei Spotify als Geist „Symcon · iPhone“ stehen, und Spotify behält sie stundenlang (13./14.10.2026 gemessen, 4 Geister >9 h). Web Lock je Instanz nur, solange eine Ansicht den Player hält; andere Ansichten nutzen seine Geräte-ID aus `localStorage` (alle 2 s bestätigt, 90 s gültig).
- **Slot im Hauptfenster:** `configuring` mit `configuringSince`; eine andere Kachel übernimmt nach 20 s (Kachel beim Verbinden verworfen). Abmelden/Kontowechsel (`auth`-Push, `logout()`) setzt Player, Zwischenspeicher, Kontext und abgefragten Zustand zurück (`resetSlot`). `slot().context` gilt nur 15 s als Brücke, bis Spotify den Kontext meldet. Gemeldet wird `liveState()`, nicht die Anzeige „zuletzt gespielt“.
- **Schlüsseldatei fehlt/beschädigt:** Status 203, Tokens bleiben, einmal ins Log (kein Abmelden, sonst löscht ein vorübergehender Lesefehler die Anmeldung).
- **Kein `IPS_ApplyChanges($this->InstanceID)` aus der eigenen Instanz** (re-entrant); Favoriten aus der Kachel über den Timer `ApplyFavorites`.
- **Slot im Hauptfenster je Instanz** (`__symconSpotifyPlayer_<ID>`, `cfg.instance`): zwei Instanzen mit verschiedenen Konten auf einer Seite teilen weder Player noch Token, Zwischenspeicher oder 429-Pause; das SDK-Skript lädt je Fenster einmal (`__symconSpotifySdk`). Kacheln einer Instanz im selben Fenster teilen das Ergebnis von `/me/player` 8 s lang (`remoteJson`/`remoteAt` als Text im Slot; ein Befehl setzt `remoteAt` zurück).
- **Objekte im Hauptfenster** als Objekte des Hauptfensters anlegen (`new win.Object()`, `new win.Function()` für SDK-Rückrufe), Listener bei `pagehide` abmelden.
- **Commits:** deutsche Botschaft, ein Thema je Commit, **ohne** Co-Authored-By-Zeile; Prüfungen vorher.
- **Nie** `git checkout`/`git restore` auf Dateien.
- **Push und Release nur auf Zuruf.**
- **Öffentliches Repo:** keine IP-Adressen, Ports, Instanz-IDs, Token, Client-IDs, Pfade unter `/Users/`.
- **Symcon-Standards:** `strict_types`, volle Typen, Darstellungen statt Profilen, Texte über `locale.json` (Test prüft, dass alle `T('…')` in `TILE_TEXTS` stehen).

## Wissen

- Gemeinsames Symcon-Plattformwissen: `../List/.claude/docs/plattform/` (Kachel-Nachrichten, Hooks, Geheimnisse).
- Apple-Modul als Vorlage: `../MusicPlayerForAppleMusic/.claude/CLAUDE.md`.
