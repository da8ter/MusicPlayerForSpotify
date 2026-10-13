# Musikplayer für Spotify

![Musikplayer für Spotify — Start](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Start.png)

Spielt Spotify direkt in der Symcon-Kachelvisualisierung und steuert jedes Spotify-Connect-Gerät. Die Kachel ist aufgebaut wie die Musik-Apps: Start (zuletzt gespielt, Top-Künstler, Top-Titel, deine Playlists, Alben und Künstler), Neu (Neuerscheinungen, neue Alben deiner Künstler, zuletzt gespeichert), Entdecken (beliebte Playlists und Spotifys Kategorien wie Charts, Stimmung und Genres), Mediathek (Playlists, Künstler, Alben, Lieblingssongs, zuletzt gespielt, Favoriten) und Suchen. Schmale Kacheln zeigen die Bereiche als Reiter unten, breite als Seitenleiste; dort zeigt unten links ein Knopf, auf welchem Gerät Spotify gerade spielt, und öffnet die Geräteauswahl. Der Mini-Player öffnet „Läuft gerade“ mit Steuerung, Lautstärke, Geräteauswahl und Warteschlange. Über „⋯“ lassen sich Titel, Alben und Playlists in die Warteschlange stellen, zu Playlists oder zur Mediathek hinzufügen, Playlists anlegen, umbenennen, Titel daraus entfernen und löschen, Künstlern folgen und Favoriten für die Kachel anlegen. Skripte und Ablaufpläne steuern die Wiedergabe über Variablen und `SPM_*`-Funktionen, auch ohne offene Kachel.

![Musikplayer für Spotify — Entdecken](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Entdecken.png)

![Musikplayer für Spotify — Album](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Album.png)

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Schmal.png" alt="Musikplayer für Spotify — Schmale Kachel" width="49%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Menue.png" alt="Musikplayer für Spotify — Menü" width="49%"></p>

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Kompakt.png" alt="Musikplayer für Spotify — Kleine Kachel" width="60%"></p>

## Voraussetzungen

- Symcon ab 8.1 mit Kachelvisualisierung und aktivem **Symcon Connect**. Die Anmeldung läuft über den OAuth-Dienst von Symcon (`oauth.ipmagic.de`) mit derselben Spotify-App wie Symcons eigenes Spotify-Modul; Spotify leitet danach über die Connect-Adresse zurück. Eine eigene App bei Spotify ist nicht nötig.
- **Spotify Premium**: Ohne Premium lässt Spotify weder die Wiedergabe in der Kachel noch die Steuerung von Geräten zu. Mediathek und Suche gehen auch ohne.

## Wo die Musik spielt

- **Browser und Symcon-App (Mac, Windows, Android, iPhone, iPad):** Die Kachel ist selbst ein Spotify-Connect-Gerät. Ihr Name setzt sich aus dem Gerätenamen der Instanz (Vorgabe „Symcon“) und dem Gerätetyp zusammen, etwa „Symcon · iPhone“ oder „Symcon · Mac“, auf Android mit Chrome das Modell. Den echten Namen des Geräts geben Browser nicht heraus; über *Geräte → Dieses Gerät benennen …* bekommt jedes Gerät einen eigenen Namen (gespeichert im Browser bzw. in der App, gilt nach dem Neuladen der Visualisierung). Es spielt nur über eine sichere Adresse (https, also die Connect-Adresse, oder `localhost`), nicht über `http://<IP>`. Der Player läuft im Fenster der Visualisierung weiter, auch wenn du die Kategorie wechselst. In der Symcon-App auf dem iPhone spielt die Kachel ebenfalls selbst; offiziell unterstützt Spotify mobile Browser aber nicht, in Safari auf iPhone und iPad kann es daher anders aussehen.
- **Andere Geräte:** Über die Geräteauswahl zeigt und steuert die Kachel jedes Gerät, auf dem Spotify gerade spielt (Handy, Sonos, Echo, Fernseher …), und holt die Wiedergabe dorthin. Wo die Kachel nicht selbst abspielen kann, bleibt sie Fernbedienung.
- **Skripte und Variablen** steuern immer das aktive Gerät; ohne aktives Gerät die Kachel im Browser oder das erste bekannte Gerät. `SPM_TransferPlayback` holt die Wiedergabe auf ein bestimmtes Gerät.

![Musikplayer für Spotify — Spotify-Connect-Auswahl](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Spotify%20Connect.png)

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Laeuft%20gerade.png" alt="Musikplayer für Spotify — Läuft gerade" width="32%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Geraete.png" alt="Musikplayer für Spotify — Geräteauswahl" width="32%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Warteschlange.png" alt="Musikplayer für Spotify — Warteschlange" width="32%"></p>

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

Solange eine Kachel offen ist, meldet sie jede Änderung sofort, und die Instanz fragt selbst nicht ab. Sonst fragt die Instanz während der Wiedergabe im eingestellten Abstand ab (Vorgabe 30 s, 0 = aus), ohne Wiedergabe höchstens alle 60 s. Spotify begrenzt die Abrufe je App und antwortet bei Überschreitung mit HTTP 429; Instanz und Kachel pausieren dann für die von Spotify genannte Zeit, mindestens 30 s; fehlt die Angabe, bei jedem weiteren 429 doppelt so lange (höchstens eine Stunde). Die Instanz schreibt eine Warnung ins Log, und eine Sperre übersteht auch einen Neustart.

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
