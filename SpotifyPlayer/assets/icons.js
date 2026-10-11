/* Musikplayer für Spotify – Symbole aus Font Awesome, das die Visualisierung unter /icons.js
   mitbringt (vollständig nur der Light-Schnitt; das Spotify-Logo kommt aus den Brands).
   Das SVG entsteht hier direkt aus den Icon-Daten statt über <i>-Ersetzung: es steht sofort im
   DOM, und nav.js misst die Reiter nicht vor dem Austausch. */
(function () {
  'use strict';
  // Kachel-Name → Font-Awesome-Name
  const NAMES = {
    play: 'play', pause: 'pause', stop: 'stop', next: 'forward-step', previous: 'backward-step',
    shuffle: 'shuffle', repeat: 'repeat', repeatOne: 'repeat-1', volume: 'volume', heart: 'heart',
    search: 'magnifying-glass', clear: 'xmark', back: 'chevron-left', check: 'check', more: 'ellipsis',
    forward: 'chevron-right', down: 'chevron-down', queue: 'list-ul', stream: 'airplay',
    // Reiter und Seitenleiste
    home: 'house', new: 'grid-2', library: 'album-collection',
    albums: 'album', artists: 'microphone-stand', playlists: 'list-music', songs: 'heart', recent: 'clock-rotate-left', favorites: 'bookmark',
    // Geräte (Spotify Connect)
    laptop: 'laptop', mobile: 'mobile', tablet: 'tablet', speaker: 'speaker', tv: 'tv', gamepad: 'gamepad', car: 'car', house: 'house',
  };
  const BRANDS = { spotify: 'spotify' };

  // [Breite, Höhe, Ligaturen, Unicode, Pfad] oder null
  function definition(name) {
    const brand = BRANDS[name];
    const iconName = brand || NAMES[name] || name;
    const prefix = brand ? 'fab' : 'fal';
    const fa = window.FontAwesome;
    if (fa && typeof fa.findIconDefinition === 'function') {
      const found = fa.findIconDefinition({ prefix, iconName });
      if (found && found.icon) return found.icon;
    }
    const ns = window.___FONT_AWESOME___;
    return (ns && ns.styles && ns.styles[prefix] && ns.styles[prefix][iconName]) || null;
  }
  const pathOf = icon => (Array.isArray(icon[4]) ? icon[4].join(' ') : icon[4]);

  function svg(name, className) {
    const icon = definition(name);
    const cls = 'fa-icon' + (className ? ' ' + className : '');
    if (!icon) return '<svg class="' + cls + '" viewBox="0 0 512 512" aria-hidden="true"></svg>';
    return '<svg class="' + cls + '" viewBox="0 0 ' + icon[0] + ' ' + icon[1] + '" aria-hidden="true"><path fill="currentColor" d="' + pathOf(icon) + '"/></svg>';
  }

  // Als CSS-Bild (Maske oder Hintergrund) für Pseudoelemente, die kein SVG im DOM tragen können
  function url(name, color) {
    const icon = definition(name);
    if (!icon) return 'none';
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + icon[0] + ' ' + icon[1] + '"><path fill="' + (color || '#000') + '" d="' + pathOf(icon) + '"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(markup) + '")';
  }

  const root = document.documentElement.style;
  root.setProperty('--icon-search', url('search'));
  root.setProperty('--icon-clear', url('clear'));
  root.setProperty('--icon-play', url('play'));
  root.setProperty('--icon-play-white', url('play', '#fff'));
  root.setProperty('--icon-stop-white', url('stop', '#fff'));

  window.AMPIcons = { svg, url };
})();
