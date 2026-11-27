# Musikplayer für Spotify

![Musikplayer für Spotify — Start](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Start.png)

Spielt Spotify direkt in der Symcon-Kachelvisualisierung und steuert jedes Spotify-Connect-Gerät. Skripte und Ablaufpläne steuern die Wiedergabe über Variablen und `SPM_*`-Funktionen, auch ohne offene Kachel.

## Die Kachel

Aufgebaut wie die Musik-Apps:

| Bereich | Inhalt |
|---|---|
| **Start** | zuletzt gespielt, Top-Künstler, Top-Titel, deine Playlists, Alben und Künstler |
| **Neu** | Neuerscheinungen, neue Alben deiner Künstler, zuletzt gespeichert |
| **Entdecken** | beliebte Playlists und Spotifys Kategorien wie Charts, Stimmung und Genres |
| **Mediathek** | Playlists, Künstler, Alben, Lieblingssongs, zuletzt gespielt, Favoriten |
| **Suchen** | Künstler, Titel, Alben und Playlists |

![Musikplayer für Spotify — Entdecken](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Entdecken.png)

![Musikplayer für Spotify — Album](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Album.png)

### Ansichten

- **Breit:** Seitenleiste mit den Bereichen und deinen Playlists. Unten links zeigt ein Knopf, auf welchem Gerät Spotify gerade spielt, und öffnet die Geräteauswahl.
- **Schmal:** Reiter unten wie auf dem Handy, die Geräteauswahl sitzt fest oben rechts.
- **Klein:** nur Cover und Steuerung.

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Schmal.png" alt="Musikplayer für Spotify — Schmale Kachel" width="49%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Menue.png" alt="Musikplayer für Spotify — Menü" width="49%"></p>

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Kompakt.png" alt="Musikplayer für Spotify — Kleine Kachel" width="60%"></p>

### Bedienung

- **Mini-Player:** öffnet „Läuft gerade“ mit Steuerung, Lautstärke, Geräteauswahl und Warteschlange. Spielt gerade nichts, zeigt er den zuletzt gespielten Titel; Play startet ihn.
- **Titel aus Listen** (Top-Titel, Suche, Lieblingssongs …) spielen die ganze Liste ab diesem Titel.
- **Menü „⋯“:** Titel, Alben und Playlists in die Warteschlange stellen, zu Playlists oder zur Mediathek hinzufügen; Playlists anlegen, umbenennen, Titel daraus entfernen und löschen; Künstlern folgen; Favoriten für die Kachel anlegen.

## Voraussetzungen

- Symcon ab 8.1 mit Kachelvisualisierung und aktivem **Symcon Connect**. Die Anmeldung läuft über den OAuth-Dienst von Symcon (`oauth.ipmagic.de`).
- **Spotify Premium**: Ohne Premium lässt Spotify weder die Wiedergabe in der Kachel noch die Steuerung von Geräten zu. Mediathek und Suche gehen auch ohne.

## Wo die Musik spielt

![Musikplayer für Spotify — Spotify-Connect-Auswahl](https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Spotify%20Connect.png)

### Die Kachel als Spotify-Connect-Gerät

Im Browser (Mac, Windows, Android) und in den Symcon-Apps ist die Kachel selbst ein Spotify-Connect-Gerät (in den Apps mit Einschränkungen, siehe unten).

- **Name:** Gerätename der Instanz (Vorgabe „Symcon“) plus Gerätetyp, etwa „Symcon · iPhone“ oder „Symcon · Mac“, auf Android mit Chrome das Modell. Den echten Namen des Geräts geben Browser nicht heraus.
- **Eigener Name:** *Geräte → Dieses Gerät benennen …* Gespeichert im Browser bzw. in der App, gilt nach dem Neuladen der Visualisierung.
- **Sichere Adresse nötig:** Gespielt wird nur über https (also die Connect-Adresse) oder `localhost`, nicht über `http://<IP>`.
- **Läuft weiter:** Der Player bleibt im Fenster der Visualisierung, auch wenn du die Kategorie wechselst.
- **Symcon-Apps (iPhone, iPad, Android):** Die Kachel wird erst zum Gerät, wenn du auf ihr abspielst: über *Geräte → Diese Kachel* oder mit Play, solange nirgends etwas läuft. Die Apps bauen eine Kachel beim Maximieren, Verkleinern und beim Wechsel der Kategorie neu auf; die Wiedergabe auf der Kachel stoppt dann, und die Kachel meldet sich bei Spotify ab. So entsteht kein Geräteeintrag je Ansicht. Für Musik, die weiterläuft, wähle ein anderes Gerät, etwa die Spotify-App auf demselben Telefon (einmal öffnen, damit sie in der Liste erscheint).

### Ohne die Kachel zu öffnen (Visu-Erweiterung)

![Musikplayer für Spotify — Mini-Player über der Visualisierung](https://raw.githubusercontent.com/da8ter/images/main/Visu-Erweiterung%20Mini-Player.png)

Normalerweise wird ein Browser erst zum Spotify-Connect-Gerät, wenn die Player-Kachel einmal angezeigt wurde. Mit der [Visu-Erweiterung für Symcon](https://github.com/da8ter/VisuExtensionForSymcon) lädt der Player schon beim Öffnen der Visualisierung, auf jeder Seite, und auf Wunsch liegt ein kleiner Player über der Visualisierung.

Die Visu-Erweiterung besteht aus einer Browser-Erweiterung für Chrome und Edge und einem eigenen Symcon-Modul. Sie läuft am Rechner oder Tablet mit Windows, macOS oder Linux, nicht in den Symcon-Apps, nicht auf iPhone und iPad und nicht in Chrome für Android.

**Einrichten**

1. Die Visu-Erweiterung nach ihrer [Anleitung](https://github.com/da8ter/VisuExtensionForSymcon#readme) installieren: das Symcon-Modul mit einer Instanz „Visu-Erweiterung“, die Browser-Erweiterung in Chrome oder Edge, und den Browser mit dem sechsstelligen Code koppeln.
2. Im Formular der Instanz „Musikplayer für Spotify“ unten auf „An die Visu-Erweiterung andocken“ klicken. Der Player steht danach in deren Formular unter den angedockten Modulen. Die Visu-Erweiterung ist freiwillig: Ohne sie läuft der Player wie gewohnt in der Kachel.
3. Für den Mini-Player im Formular des Musikplayers „Mini-Player über der Visualisierung“ einschalten.
4. Die Visualisierung im Browser neu laden.

**Was sich damit ändert**

- **Spotify-Connect-Gerät ohne Kachel:** Jeder gekoppelte Browser meldet sich beim Öffnen der Visualisierung als Gerät bei Spotify an, auch wenn die Player-Kachel noch nie angezeigt wurde. Du kannst die Wiedergabe also aus der Spotify-App, aus einem Skript oder einem Ablaufplan dorthin holen. Das Gerät heißt wie der Gerätename der Instanz plus der Name, den der Browser in der Visu-Erweiterung trägt, etwa „Symcon · Küche“.
- **Welche Browser mitmachen:** Vorgabe ist jeder gekoppelte Browser. Sobald mehrere Module angedockt sind, legst du in der Visu-Erweiterung fest, welches Modul auf welchem Gerät läuft.
- **Mini-Player:** Er erscheint, sobald du die Seite mit der Kachel verlässt und ein Titel geladen ist: Cover, Titel, Interpret und Zurück / Wiedergabe / Weiter. Er lässt sich mit Finger oder Maus frei verschieben, der Browser merkt sich die Stelle. Ein Tipp aufs Cover führt zurück zur Seite mit der Kachel. Das × blendet ihn aus, bis der nächste Titel beginnt.
- **Minimieren:** Der Knopf rechts verkleinert den Mini-Player auf das Cover am linken Fensterrand, mit Wiedergabe / Pause darauf. Ein Tipp aufs Cover klappt ihn wieder auf. Auch das merkt sich der Browser.

**Zu beachten**

- **Sichere Adresse:** Auch hier spielt der Browser nur über https (die Connect-Adresse) oder `localhost`, nicht über `http://<IP>`.
- **Erst einmal berühren:** Browser spielen Ton erst ab, nachdem jemand die Seite einmal berührt oder angeklickt hat. Danach lässt sich die Wiedergabe aus Symcon starten. Ein Kiosk-Chrome kann die Sperre mit dem Startschalter `--autoplay-policy=no-user-gesture-required` aufheben.
- **Öffnest du die Visualisierung unter mehreren Adressen** (zu Hause und über Symcon Connect), koppelst du den Browser in der Visu-Erweiterung für jede Adresse einmal.

### Andere Geräte

Über die Geräteauswahl zeigt und steuert die Kachel jedes Gerät, auf dem Spotify gerade spielt (Handy, Sonos, Echo, Fernseher …), und holt die Wiedergabe dorthin. Wo die Kachel nicht selbst abspielen kann, bleibt sie Fernbedienung.

**Warum ein Lautsprecher fehlt:** Die Geräteliste kommt von Spotify (Web API), nicht aus dem Heimnetz. Viele Spotify-Connect-Lautsprecher (Echo, Verstärker, Fernseher) findet die Spotify-App direkt im WLAN; beim Spotify-Konto und damit in dieser Liste erscheinen sie erst, nachdem einmal über die Spotify-App (bei Echo auch über Alexa) auf ihnen abgespielt wurde, und nach längerem Leerlauf verschwinden sie wieder. Manche Gerätemodelle lässt Spotify dort laut Doku ganz weg. Geräte, die Spotify als „eingeschränkt“ meldet (keine Fernsteuerung über die Web API), blendet die Kachel aus. Das gilt für jedes Modul, das Spotify über die Web API steuert.

**Sonos:** Spotify nennt Sonos-Lautsprecher in seiner Geräteliste nicht und lässt sie nicht fernsteuern. Die Kachel bietet die Sonos-Räume aus eurem Heimnetz deshalb selbst an, in der Geräteauswahl mit dem Zusatz „Sonos“.

- **Raum wählen:** Läuft gerade etwas, wandert es mit: Die Kachel hält es an und startet dieselbe Playlist oder dasselbe Album im Raum am laufenden Titel und an der laufenden Stelle. Danach spielt alles, was ihr in der Kachel startet, in diesem Raum.
- **So spielt der Raum:** Der Lautsprecher holt die Musik über seinen eigenen Spotify-Dienst. Dafür muss Spotify in der Sonos-App eingerichtet sein. Die Warteschlange des Raums wird dabei ersetzt.
- **Was anders ist:** Die Spotify-App zeigt diese Wiedergabe nicht als laufend an. „Als Nächstes“ zeigt die Warteschlange des Raums in ihrer Reihenfolge, bis zu 50 Titel; bei eingeschaltetem Zufall spielt der Lautsprecher in anderer Folge. Ein Titel aus einer Liste nimmt bis zu 100 Titel der Liste mit, ein Künstler seine Top-Titel.
- **Zurück auf ein anderes Gerät:** Wählt ihr wieder ein Spotify-Gerät, hält der Raum an und das Gerät spielt an derselben Stelle weiter.
- **Aus der Spotify-App gestartet:** Läuft Spotify schon auf einem Sonos, weil ihr es in der Spotify-App dorthin geschickt habt, zeigt die Kachel Titel und Gerät und steuert Wiedergabe, Pause, Weiter, Zurück, Springen und Lautstärke direkt am Lautsprecher.
- **Finden:** Die Lautsprecher findet das Modul von selbst; klappt das nicht, tragt ihr in der Instanz die Adresse eines Sonos-Lautsprechers ein. Variablen, Mini-Player und Skriptbefehle wirken ebenfalls auf den gewählten Raum.

<p><img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Laeuft%20gerade.png" alt="Musikplayer für Spotify — Läuft gerade" width="32%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Geraete.png" alt="Musikplayer für Spotify — Geräteauswahl" width="32%"> <img src="https://raw.githubusercontent.com/da8ter/images/main/MusicPlayerForSpotify%20Warteschlange.png" alt="Musikplayer für Spotify — Warteschlange" width="32%"></p>

### Skripte und Variablen

Sie steuern immer das aktive Gerät; ohne aktives Gerät die Kachel im Browser oder das erste bekannte Gerät. `SPM_TransferPlayback` holt die Wiedergabe auf ein bestimmtes Gerät.

## Einrichtung

1. Bibliothek installieren: im **Module Store** den Kanal **Beta** wählen und genau nach **Musikplayer für Spotify** suchen (in einer englischen Konsole **Music Player for Spotify**). Alternativ über das **Module Control** mit `https://github.com/da8ter/MusicPlayerForSpotify.git`.
2. Instanz „Musikplayer für Spotify“ anlegen.
3. Die Kachel öffnen und **Mit Spotify anmelden** (öffnet ein Fenster bei Spotify; Pop-ups erlauben). Alternativ im Instanzformular *Anmeldelink anzeigen* und den Link im Browser öffnen. Die Anmeldung gilt danach für alle Geräte der Instanz.
4. Optional Favoriten anlegen: Name und ein `open.spotify.com`-Link (oder `spotify:`-URI) zu einer Playlist, einem Album, einem Titel oder einem Künstler (in Spotify über *Teilen → Link kopieren*).

### Anmeldung

- Das Modul erneuert das Access-Token selbst (Spotify-Token gelten eine Stunde).
- Die Anmeldung endet über **Abmelden**, wenn Spotify sie widerruft, oder nach spätestens sechs Monaten (so lange gelten Spotifys Refresh-Token seit Juli 2026). Dann zeigt die Kachel wieder **Mit Spotify anmelden**.

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

### Aktualisierung und Abruflimit

- **Kachel offen:** Sie meldet jede Änderung sofort, die Instanz fragt selbst nicht ab.
- **Ohne Kachel:** Die Instanz fragt während der Wiedergabe im eingestellten Abstand ab (Vorgabe 30 s, 0 = aus), ohne Wiedergabe höchstens alle 60 s.
- **Abruflimit:** Spotify begrenzt die Abrufe je App und antwortet bei Überschreitung mit HTTP 429. Instanz und Kachel pausieren dann für die von Spotify genannte Zeit, mindestens 30 s; fehlt die Angabe, bei jedem weiteren 429 doppelt so lange (höchstens eine Stunde). Die Instanz schreibt eine Warnung ins Log, und eine Sperre übersteht auch einen Neustart.

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

Das Modul nutzt die Spotify-Plattform über die Spotify-App von Symcon, die auch Symcons eigenes Spotify-Modul verwendet. Für die Nutzung gelten die Spotify-Nutzungsbedingungen.

### Nutzungsbedingungen

- Das Modul ist ein unabhängiges Projekt. Es gibt keine Gewährleistung oder Zusicherung im Namen von Spotify; alle stillschweigenden Gewährleistungen für die Spotify-Plattform, den Spotify-Dienst und Spotify-Inhalte (Marktgängigkeit, Eignung für einen bestimmten Zweck, Nichtverletzung von Rechten) sind ausgeschlossen. Verantwortlich für das Modul ist sein Autor, nicht Spotify; Spotify haftet nicht für das Modul.
- Die Spotify-Plattform, der Spotify-Dienst und Spotify-Inhalte dürfen nicht verändert, abgeleitet, dekompiliert oder zurückentwickelt werden, soweit das Gesetz nichts anderes erlaubt.
- Spotify ist Drittbegünstigter dieser Bedingungen und kann sie unmittelbar durchsetzen.
- Die Wiedergabe setzt Spotify Premium voraus; das Modul darf nicht gegen Bezahlung angeboten werden, denn eine kommerzielle Nutzung der Spotify-Plattform erfordert die schriftliche Zustimmung von Spotify.

### Datenschutz

- **Welche Daten das Modul verarbeitet:** die Anmeldung bei Spotify (Refresh- und Access-Token, verschlüsselt in der Instanz), Benutzer-ID und Anzeigename deines Spotify-Kontos, und den Wiedergabezustand (Titel, Interpret, Album, Cover-Adresse, Gerät, Lautstärke) in den Variablen. Die Kachel hält Listen aus Spotify höchstens fünf Minuten im Browser vor. Spotify fragt bei der Anmeldung auch den Zugriff auf die E-Mail-Adresse ab, weil Symcons App diese Berechtigung anfordert; das Modul liest sie nicht.
- **Wohin Daten gehen:** Anmeldung und Token-Erneuerung laufen über den OAuth-Dienst von Symcon (`oauth.ipmagic.de`), der dafür deinen Symcon-Lizenznehmer, den Anmeldecode und das Refresh-Token an Spotify weiterreicht. Alles andere geht direkt an Spotify. Das Modul gibt nichts an weitere Dritte weiter, setzt keine Cookies und verkauft keine Daten.
- **Verbindung trennen:** „Von Spotify abmelden“ (Kachel oder Instanz) löscht Token, Kontodaten und den Wiedergabezustand; die Instanz zu löschen entfernt alles. Danach fragt das Modul keine Daten mehr ab. Zusätzlich kannst du den Zugriff unter spotify.com in den Kontoeinstellungen (*Apps*) widerrufen.

## Marken

Spotify ist eine Marke von Spotify AB. Dieses Modul ist kein Produkt von Spotify. Das Spotify-Logo erscheint in der Kachel als Herkunftshinweis für Inhalte aus Spotify, wie es die Spotify Design Guidelines verlangen.
