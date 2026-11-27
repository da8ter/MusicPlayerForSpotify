<?php

declare(strict_types=1);

/**
 * Andocken an die Visu-Erweiterung (Browser-Erweiterung „Visu-Erweiterung für Symcon“, Vertrag 2).
 *
 * Gekoppelte Browser laden bei jedem Laden der Visualisierung das Skript dieser Instanz ins Hauptfenster
 * (assets/agent.js): Der SDK-Player steht dann als Spotify-Connect-Gerät bereit, ohne dass eine Kachel
 * angezeigt wurde; optional erscheint ein Mini-Player über der Visu (assets/mini.js). Ohne Visu-Erweiterung
 * läuft das Modul wie bisher.
 *
 * Datenfluss: Describe / Script / Event von der Visu-Erweiterung (ReceiveData), Send an die Geräte (SendDataToParent).
 * Nachrichten an die Geräte: token, auth, state. Vom Gerät: {a: State|Player|RefreshToken|Playback, v}.
 */
trait MusicPlayerSpotifyDockTrait
{
    private static string $VisuExtension = '{CB9C6C38-9B97-45CA-BFB5-EC7F936AF3FF}';
    private static string $DockTx = '{A5B87602-1C34-4981-89A5-62A0735CB359}';
    private static string $DockRx = '{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}';
    /** Was ein Gerät auslösen darf: dieselben Wege wie die Kachel über requestAction. */
    private static array $DockEvents = ['State', 'Player', 'RefreshToken', 'Playback'];
    /** So lange nach der Anlage gilt eine Abfrage als Teil des Anlege-Dialogs der Konsole (Sekunden). */
    private static int $DockCreateWindow = 5;

    public function GetCompatibleParents(): string
    {
        // Andocken ist freiwillig. Die Konsole meldet eine fehlende übergeordnete Instanz nur bei „moduleIDs“, mit „modules“
        // bietet „Gateway ändern“ die Visu-Erweiterung trotzdem an. Beim Anlegen fragt sie sofort hier nach und öffnet ohne
        // „type“ keinen Dialog (Abbrechen dort löscht die neue Instanz): deshalb in den ersten Sekunden nach der Anlage '{}'.
        if (!$this->Docked() && time() - $this->ReadAttributeInteger('CreatedAt') < self::$DockCreateWindow) {
            return '{}';
        }
        return (string) json_encode(['type' => 'connect', 'modules' => [['moduleID' => self::$VisuExtension]]]);
    }

    /** In Create() aufrufen: merkt sich den Zeitpunkt der Anlage (einmalig, überlebt Neustart und Neuladen). */
    protected function RegisterDockAttributes(): void
    {
        $this->RegisterAttributeInteger('CreatedAt', 0);
        if ($this->ReadAttributeInteger('CreatedAt') === 0) {
            $this->WriteAttributeInteger('CreatedAt', time());
        }
    }

    /** Hinweis zum Andocken (über „Gateway ändern“) und ein Knopf zur Anleitung der Visu-Erweiterung. */
    protected function DockFormItems(string $Docked, string $Undocked): array
    {
        $items = [['type' => 'Label', 'caption' => $this->Translate($this->Docked() ? $Docked : $Undocked)]];
        if (!$this->Docked() && $this->VisuExtensionID() === 0) {
            $items[] = ['type' => 'Label', 'caption' => $this->Translate('The module "Visu Extension" is optional and not installed.')];
        }
        $items[] = ['type' => 'Button', 'caption' => $this->Translate('Visu Extension guide'), 'onClick' => "echo 'https://github.com/da8ter/VisuExtensionForSymcon#readme';"];
        return $items;
    }

    /** Die aktive Instanz „Visu-Erweiterung“ (je Server eine: die mit der kleinsten Kennung), sonst 0. */
    private function VisuExtensionID(): int
    {
        if (!IPS_ModuleExists(self::$VisuExtension)) {
            return 0;
        }
        $instances = IPS_GetInstanceListByModuleID(self::$VisuExtension);
        return $instances === [] ? 0 : min($instances);
    }

    public function ReceiveData(string $JSONString): string
    {
        $data = json_decode($JSONString, true);
        if (!is_array($data) || ($data['DataID'] ?? '') !== self::$DockRx || !in_array($data['Target'] ?? null, [0, $this->InstanceID], true)) {
            return '';
        }
        $signedIn = $this->SignedIn();
        switch ((string) ($data['Action'] ?? '')) {
            case 'Describe':
                return (string) json_encode([
                    'instance' => $this->InstanceID,
                    'name'     => IPS_GetName($this->InstanceID),
                    'version'  => $this->LibraryVersion(),
                    'active'   => $signedIn,
                    'info'     => $signedIn ? '' : $this->Translate('Not signed in to Spotify'),
                ], JSON_UNESCAPED_UNICODE);
            case 'Script':
                return $signedIn ? $this->AgentScript(is_array($data['Device'] ?? null) ? $data['Device'] : []) : '';
            case 'Event':
                $this->DockEvent($data['Data'] ?? null);
                return '';
        }
        return '';
    }

    /** Skript fürs Hauptfenster: SDK-Lader, Mini-Player (wenn gewünscht) und Agent mit den Startdaten. */
    private function AgentScript(array $Device): string
    {
        $mini = $this->ReadPropertyBoolean('MiniPlayer');
        $texts = [];
        foreach (['Previous', 'Play', 'Pause', 'Next', 'Close', 'Minimize', 'Expand', 'Open player'] as $text) {
            $texts[$text] = $this->Translate($text);
        }
        $config = [
            'instance'    => $this->InstanceID,
            // Nur an gekoppelte Browser, über eine je Gerät unterschriebene Adresse: wie der Seitenaufbau der Kachel
            'accessToken' => $this->AccessToken(true),
            'expiresAt'   => $this->ReadAttributeInteger('AccessExpiry'),
            'playerName'  => mb_substr(trim($this->ReadPropertyString('PlayerName')) ?: 'Symcon', 0, 60),
            'mini'        => $mini,
            'state'       => $this->DockStateMessage(),
            'texts'       => $texts,
        ];
        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
        $dir = __DIR__ . '/../SpotifyPlayer/assets/';
        return file_get_contents($dir . 'sdkhost.js') . "\n"
            . ($mini ? file_get_contents($dir . 'mini.js') . "\n" : '')
            . str_replace('/*SPM_AGENT*/null', (string) json_encode($config, $flags), (string) file_get_contents($dir . 'agent.js'));
    }

    private function DockEvent(mixed $Data): void
    {
        $ident = is_array($Data) && is_string($Data['a'] ?? null) ? $Data['a'] : '';
        if (!in_array($ident, self::$DockEvents, true)) {
            return;
        }
        $value = $Data['v'] ?? '';
        try {
            $this->RequestAction($ident, $ident === 'Playback' ? (is_int($value) ? $value : -1) : (is_string($value) ? $value : ''));
        } catch (\Throwable $e) {
            $this->SendDebug('Dock', $ident . ': ' . $e->getMessage(), 0);
        }
    }

    /** @return array{type: string, playing: bool, title: string, artist: string, cover: string, device: string} */
    private function DockStateMessage(): array
    {
        return [
            'type'    => 'state',
            'playing' => $this->GetValue('Playback') === 2,
            'title'   => (string) $this->GetValue('Title'),
            'artist'  => (string) $this->GetValue('Artist'),
            'cover'   => (string) $this->GetValue('Cover'),
            'device'  => (string) $this->GetValue('Device'),
        ];
    }

    /** Zustand an die Geräte (Mini-Player), nur wenn er sich geändert hat. */
    private function DockState(): void
    {
        $message = $this->DockStateMessage();
        $hash = md5((string) json_encode($message));
        if ($this->GetBuffer('DockState') !== $hash) {
            $this->SetBuffer('DockState', $hash);
            $this->SendToDevices($message);
        }
    }

    private function SendToDevices(array $Message): void
    {
        if (!$this->Docked() || !$this->HasActiveParent()) {
            return;
        }
        try {
            $this->SendDataToParent((string) json_encode(['DataID' => self::$DockTx, 'Action' => 'Send', 'Instance' => $this->InstanceID, 'Device' => '', 'Data' => $Message],
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } catch (\Throwable $e) {
            $this->SendDebug('Dock', $e->getMessage(), 0);
        }
    }

    /** Hängt diese Instanz im Datenfluss an einer Visu-Erweiterung? */
    protected function Docked(): bool
    {
        return (int) (@IPS_GetInstance($this->InstanceID)['ConnectionID'] ?? 0) > 0;
    }

    protected function LibraryVersion(): string
    {
        try {
            $module = IPS_GetModule(IPS_GetInstance($this->InstanceID)['ModuleInfo']['ModuleID']);
            return (string) (IPS_GetLibrary($module['LibraryID'])['Version'] ?? '');
        } catch (\Throwable $e) {
            return '';
        }
    }
}
