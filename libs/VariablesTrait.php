<?php

declare(strict_types=1);

/** Variablen des Musikplayers, ausschließlich mit Darstellungen (keine Profile). */
trait MusicPlayerSpotifyVariablesTrait
{
    private function RegisterVariables(): void
    {
        $playback = defined('VARIABLE_PRESENTATION_PLAYBACK')
            ? ['PRESENTATION' => VARIABLE_PRESENTATION_PLAYBACK]
            : $this->Enumeration([0 => 'Previous', 1 => 'Stop', 2 => 'Play', 3 => 'Pause', 4 => 'Next']);
        $this->RegisterVariableInteger('Playback', $this->Translate('Playback'), $playback, 10);
        $this->EnableAction('Playback');

        $value = ['PRESENTATION' => VARIABLE_PRESENTATION_VALUE_PRESENTATION];
        $this->RegisterVariableString('Title', $this->Translate('Title'), $value + ['ICON' => 'Music'], 20);
        $this->RegisterVariableString('Artist', $this->Translate('Artist'), $value, 30);
        $this->RegisterVariableString('Album', $this->Translate('Album'), $value, 40);
        $this->RegisterVariableString('Cover', $this->Translate('Cover URL'), $value, 50);

        $this->RegisterVariableInteger('Volume', $this->Translate('Volume'), [
            'PRESENTATION' => VARIABLE_PRESENTATION_SLIDER,
            'MIN'          => 0,
            'MAX'          => 100,
            'STEP_SIZE'    => 1,
            'SUFFIX'       => ' %',
            'USAGE_TYPE'   => 3,
        ], 60);
        $this->EnableAction('Volume');

        $this->RegisterVariableBoolean('Shuffle', $this->Translate('Shuffle'), [
            'PRESENTATION' => VARIABLE_PRESENTATION_SWITCH,
            'ICON_TRUE'    => 'shuffle',
            'ICON_FALSE'   => 'shuffle',
            'USAGE_TYPE'   => 2,
        ], 70);
        $this->EnableAction('Shuffle');

        $this->RegisterVariableInteger('Repeat', $this->Translate('Repeat'), $this->Enumeration([0 => 'Off', 1 => 'All', 2 => 'Song']), 80);
        $this->EnableAction('Repeat');

        $options = [];
        foreach ($this->Favorites() as $favorite) {
            $options[$favorite['index']] = $favorite['name'];
        }
        $this->MaintainVariable('Favorite', $this->Translate('Favorite'), VARIABLETYPE_INTEGER, $this->Enumeration($options, false), 90, $options !== []);
        if ($options !== []) {
            $this->EnableAction('Favorite');
        }

        $this->RegisterVariableString('Device', $this->Translate('Active device'), $value, 100);
    }

    private function Enumeration(array $Options, bool $Translate = true): array
    {
        $list = [];
        foreach ($Options as $value => $caption) {
            $list[] = ['Value' => $value, 'Caption' => $Translate ? $this->Translate($caption) : $caption, 'IconActive' => false, 'IconValue' => '', 'Color' => -1];
        }
        return ['PRESENTATION' => VARIABLE_PRESENTATION_ENUMERATION, 'OPTIONS' => json_encode($list, JSON_UNESCAPED_UNICODE)];
    }
}
