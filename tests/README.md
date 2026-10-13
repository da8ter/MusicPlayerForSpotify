# Tests

Ohne laufendes Symcon aus dem Repository-Verzeichnis ausführen:

```sh
php -l SpotifyPlayer/module.php
for f in libs/*.php; do php -l "$f"; done
for f in SpotifyPlayer/assets/*.js; do node --check "$f"; done
php tests/module_test.php
git diff --check
```

`tests/bootstrap.php` ist eine kleine SDK-Attrappe mit den Signaturen von `IPSModuleStrict`. Unter `strict_types` fällt jeder lockere Aufruf als `TypeError` auf, und jede nicht unterdrückte Warnung bricht ab. `TestModule` zeichnet HTTP-Aufrufe auf und liefert vorbereitete Antworten; es geht nichts ins Netz.

`tests/module_test.php` prüft:

- **Links:** open.spotify.com-Links (auch mit Sprachpräfix und `?si=`) und `spotify:`-URIs; fremde Hosts, http, Benutzerangaben, falsche ID-Längen, Shows und `javascript:` werden abgelehnt.
- **Geheimnisspeicher:** Rundlauf; anderes Feld, andere Instanz entschlüsseln nicht; Schlüsseldatei 0600; beschädigte Datei liefert null.
- **Module Strict:** wartet auf `KR_READY`, holt nach `IPS_KERNELSTARTED` nach; Hook in `Create` registriert; kein re-entrantes `IPS_ApplyChanges`.
- **Anmeldung (PKCE):** Anmeldeadresse mit Client-ID, Redirect-URI aus der Connect-Adresse und Scopes; Challenge = SHA-256 des Prüfwerts; Rückruf lehnt unbekannte Zustände ohne Netzaufruf ab; Token-Tausch mit Prüfwert und ohne Client Secret; Profil geholt; Token nur verschlüsselt; Zustand gilt nur einmal.
- **Hook:** Fehler von Spotify und unbekannte Zustände werden angezeigt, Eingaben landen nicht roh in der Seite.
- **Token-Erneuerung:** neues Token geht per Push an die Kacheln; die Web API erneuert bei 401 einmal und wiederholt.
- **Befehle und Geräte:** aktives Gerät, sonst Kachel-Gerät; ohne Gerät false mit Logmeldung; Playlist als Kontext, Titel als `uris`; `TransferPlayback` nach Namen; ungültige Eingaben abgelehnt.
- **Zustand:** aus der Kachel (Werte begrenzt, nur https-Cover) und per `UpdateState` aus `/v1/me/player`.
- **Variablen:** nur Darstellungen, Aktionen nur an schaltbaren Variablen, stabile Favoriten-Indizes.
- **Kachel:** alle Platzhalter ersetzt; Konfiguration angemeldet und abgemeldet; alle `T('…')`-Texte der Kachel stehen in `TILE_TEXTS`.
- **Übernehmen:** lädt die Kacheln nur bei Änderungen am Anmeldestand neu, geänderte Favoriten gehen als Nachricht; Favoriten aus der Kachel.

Nicht abgedeckt sind der echte Kernel, Spotify und der Browser. Handprobe in einer Testinstanz:

- Client-ID eintragen, Redirect-URI im Spotify-Dashboard hinterlegen, in der Kachel anmelden (Pop-up).
- Chrome oder Safari über die Connect-Adresse: Wiedergabe in der Kachel („Diese Kachel“), Kategorie wechseln, die Musik läuft weiter.
- iPhone, Symcon-App: Kachel spielt selbst (Gerät mit dem Instanznamen aktiv, gemessen 13.10.2026); Geräteauswahl wechselt das Gerät. Safari auf iOS ungeprüft.
- Variablen und `SPM_*`-Funktionen ohne offene Kachel: Spotify auf dem Handy starten, aus Symcon pausieren, weiter, Lautstärke.
- Playlist anlegen, befüllen, umbenennen, Titel entfernen, löschen; Gefällt mir; Künstler folgen; Favorit aus der Kachel.
