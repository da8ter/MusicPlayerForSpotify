<?php

declare(strict_types=1);

// SDK-Attrappe für den Musikplayer für Spotify. Verbindet sich nie mit einem laufenden Symcon.
// Signaturen wie IPSModuleStrict: unter strict_types fällt jeder lockere Aufruf als TypeError auf.
const KR_INIT = 10102, KR_READY = 10103, IPS_KERNELSTARTED = 10001, KL_WARNING = 10204, KL_ERROR = 10205,
    IS_ACTIVE = 102, VARIABLETYPE_BOOLEAN = 0, VARIABLETYPE_INTEGER = 1, VARIABLETYPE_STRING = 3,
    VARIABLE_PRESENTATION_VALUE_PRESENTATION = '{3319437D-7CDE-699D-750A-3C6A3841FA75}',
    VARIABLE_PRESENTATION_SLIDER = '{6B9CAEEC-5958-C223-30F7-BD36569FC57A}',
    VARIABLE_PRESENTATION_SWITCH = '{60AE6B26-B3E2-BDB1-A3A1-BE232940664B}',
    VARIABLE_PRESENTATION_ENUMERATION = '{52D9E126-D7D2-2CBB-5E62-4CF7BA7C5D82}',
    VARIABLE_PRESENTATION_PLAYBACK = '{2F0FF5B0-FC86-117B-DDAA-2D2D33C3F8AC}';

class IPSModuleStrict
{
    public int $InstanceID;
    public array $properties = [], $attributes = [], $buffers = [], $messages = [], $timers = [];
    public array $updates = [], $logs = [], $variables = [], $values = [], $actions = [], $hooks = [];
    public int $status = 0;

    public function __construct(int $InstanceID = 12345)
    {
        $this->InstanceID = $InstanceID;
        $GLOBALS['modules'][$InstanceID] = $this;
    }

    public function Create(): void {}
    public function ApplyChanges(): void {}
    public function Destroy(): void {}
    public function MessageSink(int $TimeStamp, int $SenderID, int $Message, array $Data): void {}
    public function GetConfigurationForm(): string { return ''; }
    public function GetVisualizationTile(): string { return ''; }
    public function RequestAction(string $Ident, mixed $Value): void {}

    protected function RegisterPropertyInteger(string $Name, int $DefaultValue): bool { $this->properties[$Name] = $DefaultValue; return true; }
    protected function RegisterPropertyString(string $Name, string $DefaultValue): bool { $this->properties[$Name] = $DefaultValue; return true; }
    protected function ReadPropertyInteger(string $Name): int { return $this->read('properties', $Name); }
    protected function ReadPropertyString(string $Name): string { return $this->read('properties', $Name); }
    protected function RegisterAttributeString(string $Name, string $DefaultValue): bool { $this->attributes[$Name] = $DefaultValue; return true; }
    protected function RegisterAttributeInteger(string $Name, int $DefaultValue): bool { $this->attributes[$Name] = $DefaultValue; return true; }
    protected function ReadAttributeString(string $Name): string { return $this->read('attributes', $Name); }
    protected function ReadAttributeInteger(string $Name): int { return $this->read('attributes', $Name); }
    protected function WriteAttributeString(string $Name, string $Value): void { $this->read('attributes', $Name); $this->attributes[$Name] = $Value; }
    protected function WriteAttributeInteger(string $Name, int $Value): void { $this->read('attributes', $Name); $this->attributes[$Name] = $Value; }
    protected function SetBuffer(string $Name, string $Data): void { $this->buffers[$Name] = $Data; }
    protected function GetBuffer(string $Name): string { return $this->buffers[$Name] ?? ''; }
    protected function RegisterTimer(string $Ident, int $Milliseconds, string $ScriptText): bool { $this->timers[$Ident] = $Milliseconds; return true; }
    protected function SetTimerInterval(string $Ident, int $Milliseconds): bool { $this->read('timers', $Ident); $this->timers[$Ident] = $Milliseconds; return true; }
    protected function RegisterMessage(int $SenderID, int $Message): bool { $this->messages[$SenderID][] = $Message; return true; }
    protected function RegisterHook(string $Path): bool { $this->hooks[] = $Path; return true; }
    protected function ProcessHookData(): void {}
    protected function SetStatus(int $Status): bool { $this->status = $Status; return true; }
    protected function SetVisualizationType(int $Type): bool { return true; }
    protected function ReloadForm(): void {}
    protected function UpdateVisualizationValue(string $Value): bool { $this->updates[] = json_decode($Value, true, 512, JSON_THROW_ON_ERROR); return true; }
    protected function LogMessage(string $Message, int $Type): bool { $this->logs[] = $Message; return true; }
    protected function SendDebug(string $Message, string $Data, int $Format): bool { return true; }
    protected function Translate(string $Text): string { return $Text; }
    protected function RegisterVariableInteger(string $Ident, string $Name, string|array $Profile = '', int $Position = 0): bool { return $this->variable($Ident, VARIABLETYPE_INTEGER, $Profile, 0); }
    protected function RegisterVariableString(string $Ident, string $Name, string|array $Profile = '', int $Position = 0): bool { return $this->variable($Ident, VARIABLETYPE_STRING, $Profile, ''); }
    protected function RegisterVariableBoolean(string $Ident, string $Name, string|array $Profile = '', int $Position = 0): bool { return $this->variable($Ident, VARIABLETYPE_BOOLEAN, $Profile, false); }
    protected function MaintainVariable(string $Ident, string $Name, int $Type, string|array $Profile, int $Position, bool $Keep): bool
    {
        if ($Keep) {
            return $this->variable($Ident, $Type, $Profile, $Type === VARIABLETYPE_STRING ? '' : 0);
        }
        unset($this->variables[$Ident], $this->values[$Ident]);
        return true;
    }
    protected function EnableAction(string $Ident): bool { $this->read('variables', $Ident); $this->actions[$Ident] = true; return true; }
    protected function GetValue(string $Ident): mixed { $this->read('variables', $Ident); return $this->values[$Ident]; }
    protected function SetValue(string $Ident, mixed $Value): bool { $this->read('variables', $Ident); $this->values[$Ident] = $Value; return true; }

    private function variable(string $Ident, int $Type, string|array $Presentation, mixed $Default): bool
    {
        $this->variables[$Ident] = ['type' => $Type, 'presentation' => $Presentation];
        $this->values[$Ident] ??= $Default;
        return true;
    }

    private function read(string $store, string $name): mixed
    {
        if (!array_key_exists($name, $this->{$store})) {
            throw new RuntimeException('Not registered (' . $store . '): ' . $name);
        }
        return $this->{$store}[$name];
    }
}

// Kernel-Zustand der Attrappe
$runlevel = KR_READY;
$modules = [];
$kernelDir = sys_get_temp_dir() . '/spm-test-' . getmypid() . '/';
@mkdir($kernelDir, 0700, true);

function IPS_GetKernelRunlevel(): int { return $GLOBALS['runlevel']; }
function IPS_GetKernelDir(): string { return $GLOBALS['kernelDir']; }
function IPS_SetProperty(int $InstanceID, string $Name, mixed $Value): bool { $GLOBALS['modules'][$InstanceID]->properties[$Name] = $Value; return true; }
// Wie Symcon 9.1: eine Instanz, die gerade selbst arbeitet, nimmt kein zweites ApplyChanges an
// („Instanz ist durch eine selbst gestartete Operation belegt (re-entranter Aufruf abgelehnt)“).
function IPS_ApplyChanges(int $InstanceID): bool
{
    if (isset($GLOBALS['busy'][$InstanceID])) {
        trigger_error('Instance #' . $InstanceID . ' is busy (re-entrant call rejected)', E_USER_WARNING);
        return false;
    }
    $GLOBALS['busy'][$InstanceID] = true;
    try {
        $GLOBALS['modules'][$InstanceID]->ApplyChanges();
    } finally {
        unset($GLOBALS['busy'][$InstanceID]);
    }
    return true;
}
function IPS_GetInstanceListByModuleID(string $ModuleID): array { return $GLOBALS['connect'] ?? []; }
function CC_GetConnectURL(int $InstanceID): string|false { return 'https://example.ipmagic.de'; }
function IPS_InstanceExists(int $InstanceID): bool { return isset($GLOBALS['modules'][$InstanceID]); }
function IPS_GetInstance(int $InstanceID): array { return ['ModuleInfo' => ['ModuleID' => '{E52C1561-E92E-4C39-9EDE-988A9285B8A1}']]; }
function IPS_GetObjectIDByIdent(string $Ident, int $ParentID): int|false
{
    return isset($GLOBALS['modules'][$ParentID]->variables[$Ident]) ? 20000 : false;
}

function check(bool $condition, string $label): void
{
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $label);
    }
    echo 'PASS: ' . $label . PHP_EOL;
}

function throws(callable $fn, string $class): bool
{
    try {
        $fn();
    } catch (Throwable $e) {
        return $e instanceof $class;
    }
    return false;
}

// Jede Warnung bricht ab, außer sie ist im Modul ausdrücklich mit @ unterdrückt.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) === 0) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

require __DIR__ . '/../SpotifyPlayer/module.php';
