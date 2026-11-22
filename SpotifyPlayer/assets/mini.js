/* Mini-Player über der Visualisierung (nur mit der Browser-Erweiterung „Visu-Erweiterung für Symcon“).
   Erscheint, wenn die Seite mit der Player-Kachel verlassen ist und ein Titel geladen ist; frei verschiebbar
   wie die Klebezettel, die Lage merkt sich der Browser je Instanz. Ein Tipp aufs Cover führt zurück zur
   Seite der Kachel. Die Datei ist in beiden Musik-Modulen gleich; agent.js ruft
     window.SymconMiniPlayer({ key, texts, send, tile })
   auf und meldet den Zustand mit update({ playing, title, artist, cover }).
   send(command) mit 'previous' | 'toggle' | 'next'; tile() liefert { at, page } der zuletzt sichtbaren Kachel. */
(function () {
  'use strict';
  if (window.SymconMiniPlayer) return;
  var w = window, d = document;
  var HIDE_AFTER = 2500; // so lange nach dem letzten Lebenszeichen der Kachel gilt sie als sichtbar (beim Verlassen meldet sie sich sofort ab)

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Font-Awesome-Icons über den geteilten Platz window.__symconIcons (siehe Vorlage der Visu-Erweiterung). */
  function icons(done) {
    var slot = w.__symconIcons;
    if (!slot) {
      if (w.FontAwesome || w.FontAwesomeConfig) return;
      slot = w.__symconIcons = { v: 1, fa: null, css: '', fehler: false };
      w.FontAwesomeConfig = { autoReplaceSvg: false, observeMutations: false, autoAddCss: false };
      var s = d.createElement('script');
      s.src = '/icons.js';
      s.onload = function () {
        s.onload = s.onerror = null;
        if (w.FontAwesome && w.FontAwesome.dom) { slot.css = w.FontAwesome.dom.css(); slot.fa = w.FontAwesome; } else slot.fehler = true;
      };
      s.onerror = function () { s.onload = s.onerror = null; slot.fehler = true; };
      (d.head || d.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() {
      if (slot.fa) done(slot.fa, slot.css);
      else if (!slot.fehler && ++tries <= 100) w.setTimeout(wait, 100);
    })();
  }

  w.SymconMiniPlayer = function (o) {
    var T = function (k) { return (o.texts && o.texts[k]) || k; };
    var KEY = 'symconMini.' + o.key;
    var state = { playing: false, title: '', artist: '', cover: '' };
    var dismissed = '';  // Titel, für den der Nutzer den Mini-Player geschlossen hat
    var root = null, img = null, title = null, artist = null, bPlay = null, fa = null;
    var pos = load();
    var small = false; // minimiert: nur das Cover, am linken Fensterrand
    try { small = w.localStorage.getItem(KEY + '.min') === '1'; } catch (e) { /* ohne Speicher */ }

    function load() {
      try { var p = JSON.parse(w.localStorage.getItem(KEY + '.pos') || 'null'); if (p && typeof p.x === 'number' && typeof p.y === 'number') return p; } catch (e) { /* ohne Speicher */ }
      return { x: 0.5, y: 0.9 }; // Mitte des Kastens relativ zum Fenster: unten mittig
    }
    function save() { try { w.localStorage.setItem(KEY + '.pos', JSON.stringify(pos)); } catch (e) { /* ohne Speicher */ } }
    function setSmall(on) {
      small = on;
      try { w.localStorage.setItem(KEY + '.min', on ? '1' : '0'); } catch (e) { /* ohne Speicher */ }
      if (!root) return;
      root.classList.toggle('smp-min', on);
      img.title = T(on ? 'Expand' : 'Open player');
      place();
    }
    function trackKey() { return state.title + '\n' + state.artist; }

    function icon(name, fallback) {
      if (fa) {
        var def = fa.findIconDefinition({ prefix: 'fal', iconName: name }) || fa.findIconDefinition({ prefix: 'fas', iconName: name });
        if (def) return fa.icon(def).html.join('');
      }
      return '<span>' + fallback + '</span>';
    }
    function button(label, iconName, fallback, fn) {
      var b = d.createElement('button');
      b.type = 'button';
      b.className = 'smp-b';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon(iconName, fallback);
      b.dataset.icon = iconName;
      b.dataset.fallback = fallback;
      b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
      return b;
    }
    function paintIcons() {
      if (!root) return;
      Array.prototype.forEach.call(root.querySelectorAll('.smp-b'), function (b) { b.innerHTML = icon(b.dataset.icon, b.dataset.fallback); });
    }

    function build() {
      var style = d.createElement('style');
      style.textContent = '.smp{position:fixed;z-index:2147483001;display:none;align-items:center;gap:10px;box-sizing:border-box;width:min(340px,calc(100vw - 16px));'
        + 'padding:8px 6px 8px 8px;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:#fff;-webkit-backdrop-filter:blur(14.4px) saturate(180%);backdrop-filter:blur(14.4px) saturate(180%);'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.18),0 1px 2px rgba(0,0,0,.10);text-shadow:0 1px 2px rgba(0,0,0,.35);font:14px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;transition:left .25s ease}'
        + '.smp.smp-on{display:flex}.smp.smp-drag{cursor:grabbing;transition:none}'
        + '.smp.smp-min{width:auto;padding:6px 6px 6px 4px;border-left:0;border-radius:0 14px 14px 0}.smp.smp-min>:not(.smp-c):not(.smp-p):not(.smp-o){display:none}.smp-b.smp-o{display:none}'
        + '.smp.smp-min .smp-p{position:absolute;left:10px;top:50%;margin-top:-18px;background:rgba(0,0,0,.45)}.smp.smp-min .smp-o{display:flex;width:22px;margin-left:-4px;opacity:.75}'
        + '.smp-c{flex:0 0 48px;width:48px;height:48px;border-radius:8px;background:#3a3a3c center/cover no-repeat;cursor:pointer}'
        + '.smp-t{flex:1;min-width:0}.smp-t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.smp-a{opacity:.72;font-size:13px;margin-top:2px}'
        + '.smp-b{flex:0 0 auto;width:36px;height:36px;border:0;border-radius:50%;background:none;color:inherit;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}'
        + '.smp-b:active{background:rgba(255,255,255,.15)}.smp-b svg{width:18px;height:18px}.smp-x{width:28px;height:28px;opacity:.6}.smp-x svg{width:14px;height:14px}';
      d.head.appendChild(style);
      root = d.createElement('div');
      root.className = 'smp';
      root.setAttribute('data-symcon-mini', o.key);
      img = d.createElement('div');
      img.className = 'smp-c';
      img.title = T('Open player');
      var text = d.createElement('div');
      text.className = 'smp-t';
      title = d.createElement('div');
      artist = d.createElement('div');
      artist.className = 'smp-a';
      text.appendChild(title);
      text.appendChild(artist);
      root.appendChild(img);
      root.appendChild(text);
      root.appendChild(button(T('Previous'), 'backward-step', '⏮', function () { o.send('previous'); }));
      bPlay = button(T('Play'), 'play', '▶', function () { state.playing = !state.playing; paintPlay(); o.send('toggle'); });
      bPlay.classList.add('smp-p');
      root.appendChild(bPlay);
      root.appendChild(button(T('Next'), 'forward-step', '⏭', function () { o.send('next'); }));
      var close = button(T('Close'), 'xmark', '×', function () { dismissed = trackKey(); show(); });
      close.classList.add('smp-x');
      root.appendChild(close);
      var minimize = button(T('Minimize'), 'down-left-and-up-right-to-center', '–', function () { setSmall(true); });
      minimize.classList.add('smp-x');
      root.appendChild(minimize);
      var expand = button(T('Expand'), 'chevron-right', '›', function () { setSmall(false); });
      expand.classList.add('smp-o');
      root.appendChild(expand);
      root.classList.toggle('smp-min', small);
      if (small) img.title = T('Expand');
      root.addEventListener('pointerdown', startDrag);
      d.body.appendChild(root);
      icons(function (lib, css) {
        fa = lib;
        if (css && !d.getElementById('symcon-fa-css')) { var s = d.createElement('style'); s.id = 'symcon-fa-css'; s.textContent = css; d.head.appendChild(s); }
        paintIcons();
        paintPlay();
      });
      w.addEventListener('resize', place);
    }

    function paintPlay() {
      if (!bPlay) return;
      var name = state.playing ? 'pause' : 'play';
      bPlay.dataset.icon = name;
      bPlay.dataset.fallback = state.playing ? '❚❚' : '▶';
      bPlay.title = T(state.playing ? 'Pause' : 'Play');
      bPlay.setAttribute('aria-label', bPlay.title);
      bPlay.innerHTML = icon(name, bPlay.dataset.fallback);
    }

    function paint() {
      title.textContent = state.title;
      artist.textContent = state.artist;
      img.style.backgroundImage = state.cover ? 'url("' + state.cover.replace(/["\\\n]/g, '') + '")' : '';
      paintPlay();
      place();
    }

    function place() {
      if (!root || !root.classList.contains('smp-on')) return;
      var W = w.innerWidth, H = w.innerHeight, bw = root.offsetWidth, bh = root.offsetHeight;
      root.style.left = small ? '0px' : clamp(pos.x * W - bw / 2, 4, Math.max(4, W - bw - 4)) + 'px';
      root.style.top = clamp(pos.y * H - bh / 2, 4, Math.max(4, H - bh - 4)) + 'px';
    }

    /* Verschieben; ohne nennenswerte Bewegung zählt es als Tipp (aufs Cover: zurück zur Kachel, minimiert: aufklappen).
       Minimiert bleibt er am linken Rand und lässt sich nur auf und ab schieben. */
    function startDrag(ev) {
      if (ev.button) return;
      ev.preventDefault();
      var startX = ev.clientX, startY = ev.clientY, left = root.offsetLeft, top = root.offsetTop, moved = false, onCover = ev.target === img;
      try { root.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
      function move(e) {
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        moved = true;
        root.classList.add('smp-drag');
        var W = w.innerWidth, H = w.innerHeight, bw = root.offsetWidth, bh = root.offsetHeight;
        var y = clamp(top + dy, 4, Math.max(4, H - bh - 4));
        root.style.top = y + 'px';
        if (small) { pos = { x: pos.x, y: (y + bh / 2) / H }; return; }
        var x = clamp(left + dx, 4, Math.max(4, W - bw - 4));
        root.style.left = x + 'px';
        pos = { x: (x + bw / 2) / W, y: (y + bh / 2) / H };
      }
      function up() {
        root.removeEventListener('pointermove', move);
        root.removeEventListener('pointerup', up);
        root.removeEventListener('pointercancel', up);
        root.classList.remove('smp-drag');
        if (moved) save();
        else if (onCover && small) setSmall(false);
        else if (onCover) openTile();
      }
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up);
      root.addEventListener('pointercancel', up);
    }

    function openTile() {
      var page = (o.tile() || {}).page;
      if (typeof page !== 'string' || page.charAt(0) !== '/' || page.charAt(1) === '/') return;
      var i = page.indexOf('#'), path = i < 0 ? page : page.slice(0, i);
      if (path === w.location.pathname) w.location.hash = i < 0 ? '' : page.slice(i);
      else w.location.assign(page);
    }

    function show() {
      var tile = o.tile() || {};
      var tileVisible = tile.at && Date.now() - tile.at < HIDE_AFTER;
      var on = !!state.title && !tileVisible && dismissed !== trackKey();
      if (on && !root) { build(); paint(); }
      if (!root) return;
      var was = root.classList.contains('smp-on');
      root.classList.toggle('smp-on', on);
      if (on && !was) place();
    }

    w.setInterval(show, 300);

    return {
      update: function (s) {
        if (!s || typeof s !== 'object') return;
        state = {
          playing: s.playing === true,
          title: typeof s.title === 'string' ? s.title : '',
          artist: typeof s.artist === 'string' ? s.artist : '',
          cover: typeof s.cover === 'string' && /^https:\/\//.test(s.cover) ? s.cover : '',
        };
        if (dismissed && dismissed !== trackKey()) dismissed = ''; // anderer Titel: wieder zeigen
        if (!state.title) dismissed = '';
        show();
        if (root) paint();
      },
    };
  };
})();
