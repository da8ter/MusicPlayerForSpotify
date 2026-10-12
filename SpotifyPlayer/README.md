# Musikplayer für Spotify

Spielt Spotify direkt in der Symcon-Kachelvisualisierung und steuert jedes Spotify-Connect-Gerät. Die Kachel ist aufgebaut wie die Musik-Apps: Start (zuletzt gespielt, Top-Künstler, Top-Titel, deine Playlists, Alben und Künstler), Neu (neue Alben deiner Künstler, zuletzt gespeichert), Mediathek (Playlists, Künstler, Alben, Lieblingssongs, zuletzt gespielt, Favoriten) und Suchen. Schmale Kacheln zeigen die Bereiche als Reiter unten, breite als Seitenleiste. Der Mini-Player öffnet „Läuft gerade“ mit Steuerung, Lautstärke, Geräteauswahl und Warteschlange. Über „⋯“ lassen sich Titel, Alben und Playlists in die Warteschlange stellen, zu Playlists oder zur Mediathek hinzufügen, Playlists anlegen, umbenennen, Titel daraus entfernen und löschen, Künstlern folgen und Favoriten für die Kachel anlegen. Skripte und Ablaufpläne steuern die Wiedergabe über Variablen und `SPM_*`-Funktionen, auch ohne offene Kachel.

## Voraussetzungen

- Symcon ab 8.1 mit Kachelvisualisierung und aktivem **Symcon Connect**. Die Anmeldung läuft über den OAuth-Dienst von Symcon (`oauth.ipmagic.de`) mit derselben Spotify-App wie Symcons eigenes Spotify-Modul; Spotify leitet danach über die Connect-Adresse zurück. Eine eigene App bei Spotify ist nicht nötig.
- **Spotify Premium**: Ohne Premium lässt Spotify weder die Wiedergabe in der Kachel noch die Steuerung von Geräten zu. Mediathek und Suche gehen auch ohne.

## Wo die Musik spielt

- **Browser (Mac, Windows, Android):** Die Kachel ist selbst ein Spotify-Connect-Gerät (Name aus der Instanz, Vorgabe „Symcon“). Es spielt nur über eine sichere Adresse (https, also die Connect-Adresse, oder `localhost`), nicht über `http://<IP>`. Der Player läuft im Fenster der Visualisierung weiter, auch wenn du die Kategorie wechselst.
- **iPhone und iPad (Safari und Symcon-App):** Spotify bietet dort keinen Web-Player. Die Kachel zeigt und steuert das Gerät, auf dem Spotify gerade spielt (Handy, Sonos, Echo, Fernseher …), und wechselt es über die Geräteauswahl.
- **Skripte und Variablen** steuern immer das aktive Gerät; ohne aktives Gerät die Kachel im Browser oder das erste bekannte Gerät. `SPM_TransferPlayback` holt die Wiedergabe auf ein bestimmtes Gerät.

## Einrichtung

1. Instanz „Musikplayer für Spotify“ anlegen.
2. Die Kachel öffnen und **Mit Spotify anmelden** (öffnet ein Fenster bei Spotify; Pop-ups erlauben). Alternativ im Instanzformular *Anmeldelink anzeigen* und den Link im Browser öffnen. Die Anmeldung gilt danach für alle Geräte der Instanz.
3. Optional Favoriten anlegen: Name und ein `open.spotify.com`-Link (oder `spotify:`-URI) zu einer Playlist, einem Album, einem Titel oder einem Künstler (in Spotify über *Teilen → Link kopieren*).

Das Modul erneuert das Access-Token selbst (Spotify-Token gelten eine Stunde). Die Anmeldung endet über **Abmelden**, wenn Spotify sie widerruft, oder nach spätestens sechs Monaten (so lange gelten Spotifys Refresh-Token seit Juli 2026); dann zeigt die Kachel wieder **Mit Spotify anmelden**.

Wer vorher eine eigene Spotify-App mit Client ID genutzt hat: Nach dem Update ist die Instanz abgemeldet, einmal neu anmelden genügt. Die App bei Spotify kann danach gelöscht werden.

## Variablen

| Variable | Bedeutung |
|---|---|
| Wiedergabe | 0 Zurück, 1 Stopp (= Pause), 2 Play, 3 Pause, 4 Weiter (schaltbar) |
| Titel, Interpret, Album, Cover-Adresse | was gerade läuft |
| Lautstärke | 0–100 % (schaltbar; nicht bei Geräten ohne Lautstärkeregelung) |
| Zufallswiedergabe | an/aus (schaltbar) |
| Wiederholen | 0 Aus, 1 Alle, 2 Titel (schaltbar) |
| Favorit | startet einen Favoriten (schaltbar, nur mit Favoriten) |
| Aktives Gerät | Name des Spotify-Connect-Geräts, das gerade spielt |

Die Variablen werden im eingestellten Abstand (Vorgabe 10 s, 0 = aus) über die Web API aktualisiert und zusätzlich sofort von jeder offenen Kachel.

## Funktionen

```php
SPM_Play(int $InstanzID): bool;
SPM_Pause(int $InstanzID): bool;
SPM_Next(int $InstanzID): bool;
SPM_Previous(int $InstanzID): bool;
SPM_SetVolume(int $InstanzID, int $Lautstaerke): bool;     // 0–100
SPM_SetShuffle(int $InstanzID, bool $Zufall): bool;
SPM_SetRepeat(int $InstanzID, int $Modus): bool;           // 0 aus, 1 alle, 2 Titel
SPM_PlayFavorite(int $InstanzID, int $Index): bool;        // Index aus der Favoritenliste (ab 0)
SPM_PlayURL(int $InstanzID, string $Link): bool;           // open.spotify.com-Link oder spotify:-URI
SPM_TransferPlayback(int $InstanzID, string $Geraet): bool; // Name wie in Spotify Connect
SPM_UpdateState(int $InstanzID): bool;                     // Variablen sofort aktualisieren
SPM_RefreshAccessToken(int $InstanzID): bool;
SPM_Request(int $InstanzID, string $Methode, string $Pfad, string $QueryJSON = '', string $BodyJSON = ''): string; // Rohzugriff auf die Web API, Antwort als JSON
SPM_Logout(int $InstanzID): void;
```

Alle Funktionen geben `false` zurück und schreiben ins Log, wenn kein Gerät erreichbar ist oder Spotify den Befehl ablehnt.

## Grenzen

- Spotify stellt neue Titel nur hinten an die Warteschlange; „Als Nächstes“ gibt es in der Web API nicht. Die Warteschlange lässt sich anzeigen, aber nicht umsortieren.
- Seit Spotifys Umstellung für Apps im Development Mode (Februar 2026, bestehende Apps ab 9. März 2026) gibt es für solche Apps keine Neuerscheinungen, Browse-Kategorien, Empfehlungen, ähnlichen Künstler und Top-Titel eines Künstlers mehr; Playlist-Inhalte liefert Spotify nur für eigene und gemeinsame Playlists. „Start“ und „Neu“ bauen deshalb auf deiner Mediathek und deinen Künstlern auf, die Künstlerseite holt Titel über die Suche, und bei fremden Playlists steht ein Hinweis. Suche und Künstleralben liefert Spotify nur in Zehnerschritten, das Modul blättert selbst nach.
- **Zusammen mit Symcons Spotify-Modul:** Beide nutzen beim OAuth-Dienst dieselbe Kennung, und der Rückruf der Anmeldung geht an genau eine Instanz. Dieses Modul übernimmt sie beim Klick auf *Anmelden*, Symcons Modul beim Übernehmen seiner Instanz. Vor einer Anmeldung in Symcons Modul daher dort einmal *Übernehmen*. Bestehende Anmeldungen beider Module betrifft das nicht. Dasselbe gilt für mehrere Instanzen dieses Moduls: angemeldet wird jeweils die Instanz, deren Kachel die Anmeldung gestartet hat.
- Das Access-Token ist in der Kachel sichtbar. Wer die Visualisierung öffnen darf, kann damit das Spotify-Konto bedienen, so wie über die Kachel selbst.

## Nutzungsbedingungen und Datenschutz

Das Modul nutzt die Spotify-Plattform über die Spotify-App von Symcon, die auch Symcons eigenes Spotify-Modul verwendet. Für die Nutzung gelten die Spotify-Nutzungsbedingungen; für das Modul selbst die [Spotify Developer Terms](https://developer.spotify.com/terms). Daraus folgt:

- Das Modul ist ein unabhängiges Projekt. Es gibt keine Gewährleistung oder Zusicherung im Namen von Spotify; alle stillschweigenden Gewährleistungen für die Spotify-Plattform, den Spotify-Dienst und Spotify-Inhalte (Marktgängigkeit, Eignung für einen bestimmten Zweck, Nichtverletzung von Rechten) sind ausgeschlossen. Verantwortlich für das Modul ist sein Autor, nicht Spotify; Spotify haftet nicht für das Modul.
- Die Spotify-Plattform, der Spotify-Dienst und Spotify-Inhalte dürfen nicht verändert, abgeleitet, dekompiliert oder zurückentwickelt werden, soweit das Gesetz nichts anderes erlaubt.
- Spotify ist Drittbegünstigter dieser Bedingungen und kann sie unmittelbar durchsetzen.
- **Welche Daten das Modul verarbeitet:** die Anmeldung bei Spotify (Refresh- und Access-Token, verschlüsselt in der Instanz), Benutzer-ID und Anzeigename deines Spotify-Kontos, und den Wiedergabezustand (Titel, Interpret, Album, Cover-Adresse, Gerät, Lautstärke) in den Variablen. Die Kachel hält Listen aus Spotify höchstens fünf Minuten im Browser vor. Spotify fragt bei der Anmeldung auch den Zugriff auf die E-Mail-Adresse ab, weil Symcons App diese Berechtigung anfordert; das Modul liest sie nicht.
- **Wohin Daten gehen:** Anmeldung und Token-Erneuerung laufen über den OAuth-Dienst von Symcon (`oauth.ipmagic.de`), der dafür deinen Symcon-Lizenznehmer, den Anmeldecode und das Refresh-Token an Spotify weiterreicht. Alles andere geht direkt an Spotify. Das Modul gibt nichts an weitere Dritte weiter, setzt keine Cookies und verkauft keine Daten.
- **Verbindung trennen:** „Von Spotify abmelden“ (Kachel oder Instanz) löscht Token, Kontodaten und den Wiedergabezustand; die Instanz zu löschen entfernt alles. Danach fragt das Modul keine Daten mehr ab. Zusätzlich kannst du den Zugriff unter spotify.com in den Kontoeinstellungen (*Apps*) widerrufen.
- Die Wiedergabe setzt Spotify Premium voraus; das Modul darf nicht gegen Bezahlung angeboten werden, denn eine kommerzielle Nutzung der Spotify-Plattform erfordert die schriftliche Zustimmung von Spotify.

## Marken

Spotify ist eine Marke von Spotify AB. Dieses Modul ist kein Produkt von Spotify. Das Spotify-Logo erscheint in der Kachel als Herkunftshinweis für Inhalte aus Spotify, wie es die Spotify Design Guidelines verlangen.
