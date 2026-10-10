# Musikplayer für Spotify

Spielt Spotify direkt in der Symcon-Kachelvisualisierung und steuert jedes Spotify-Connect-Gerät. Die Kachel ist aufgebaut wie die Musik-Apps: Start (zuletzt gespielt, Top-Künstler, Top-Titel, Neuerscheinungen), Neu, Mediathek (Playlists, Künstler, Alben, Lieblingssongs, zuletzt gespielt, Favoriten) und Suchen. Schmale Kacheln zeigen die Bereiche als Reiter unten, breite als Seitenleiste. Der Mini-Player öffnet „Läuft gerade“ mit Steuerung, Lautstärke, Geräteauswahl und Warteschlange. Über „⋯“ lassen sich Titel, Alben und Playlists in die Warteschlange stellen, zu Playlists oder zur Mediathek hinzufügen, Playlists anlegen, umbenennen, Titel daraus entfernen und löschen, Künstlern folgen und Favoriten für die Kachel anlegen. Skripte und Ablaufpläne steuern die Wiedergabe über Variablen und `SPM_*`-Funktionen, auch ohne offene Kachel.

## Voraussetzungen

- Symcon ab 8.1 mit Kachelvisualisierung und einer **Connect-Adresse** (https), denn Spotify erlaubt den Rückruf der Anmeldung nur über https. Alternativ eine eigene öffentliche https-Adresse.
- **Spotify Premium**: Ohne Premium lässt Spotify weder die Wiedergabe in der Kachel noch die Steuerung von Geräten zu. Mediathek und Suche gehen auch ohne.
- Eine **eigene App bei Spotify** (kostenlos): Unter https://developer.spotify.com/dashboard anmelden, *Create app*, einen Namen vergeben, als Redirect URI die Adresse aus dem Instanzformular eintragen (`https://<Connect-Adresse>/hook/spotifyplayer`), bei den APIs *Web API* und *Web Playback SDK* anhaken. Die **Client ID** aus den App-Einstellungen kommt in die Instanz. Spotify lässt solche Apps im Development Mode mit bis zu 25 Nutzern laufen; weitere Konten müssen in der App unter *User Management* eingetragen werden.

## Wo die Musik spielt

- **Browser (Mac, Windows, Android):** Die Kachel ist selbst ein Spotify-Connect-Gerät (Name aus der Instanz, Vorgabe „Symcon“). Es spielt nur über eine sichere Adresse (https, also die Connect-Adresse, oder `localhost`), nicht über `http://<IP>`. Der Player läuft im Fenster der Visualisierung weiter, auch wenn du die Kategorie wechselst.
- **iPhone und iPad (Safari und Symcon-App):** Spotify bietet dort keinen Web-Player. Die Kachel zeigt und steuert das Gerät, auf dem Spotify gerade spielt (Handy, Sonos, Echo, Fernseher …), und wechselt es über die Geräteauswahl.
- **Skripte und Variablen** steuern immer das aktive Gerät; ohne aktives Gerät die Kachel im Browser oder das erste bekannte Gerät. `SPM_TransferPlayback` holt die Wiedergabe auf ein bestimmtes Gerät.

## Einrichtung

1. Instanz „Musikplayer für Spotify“ anlegen.
2. **Client ID** eintragen und übernehmen. Das Formular zeigt die Redirect-URI, die in der Spotify-App stehen muss.
3. Die Kachel öffnen und **Mit Spotify anmelden** (öffnet ein Fenster bei Spotify; Pop-ups erlauben). Die Anmeldung gilt danach für alle Geräte der Instanz.
4. Optional Favoriten anlegen: Name und ein `open.spotify.com`-Link (oder `spotify:`-URI) zu einer Playlist, einem Album, einem Titel oder einem Künstler (in Spotify über *Teilen → Link kopieren*).

Das Modul erneuert das Access-Token selbst (Spotify-Token gelten eine Stunde). Die Anmeldung endet nur über **Abmelden** oder wenn Spotify sie widerruft.

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
SPM_Logout(int $InstanzID): void;
```

Alle Funktionen geben `false` zurück und schreiben ins Log, wenn kein Gerät erreichbar ist oder Spotify den Befehl ablehnt.

## Grenzen

- Spotify stellt neue Titel nur hinten an die Warteschlange; „Als Nächstes“ gibt es in der Web API nicht. Die Warteschlange lässt sich anzeigen, aber nicht umsortieren.
- Empfehlungen, ähnliche Künstler und redaktionelle Playlists stellt Spotify neuen Apps seit November 2024 nicht mehr bereit; „Start“ zeigt deshalb Hörverlauf, Top-Listen und Neuerscheinungen.
- Das Access-Token ist in der Kachel sichtbar. Wer die Visualisierung öffnen darf, kann damit das Spotify-Konto bedienen, so wie über die Kachel selbst.

## Marken

Spotify ist eine Marke von Spotify AB. Dieses Modul ist kein Produkt von Spotify. Das Spotify-Logo erscheint in der Kachel als Herkunftshinweis für Inhalte aus Spotify, wie es die Spotify Design Guidelines verlangen.
