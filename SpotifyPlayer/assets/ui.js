/* Musikplayer für Spotify – Oberfläche, aufgebaut wie die Musik-Apps: Start, Neu, Mediathek und
   Suchen; schmal als Reiter unten (iPhone), breit als Seitenleiste (iPad). Hier liegen Navigation,
   Listen, Kacheln und Suche; die Inhalte der Bereiche kommen aus views.js, der Player aus player.js. */
(function () {
  'use strict';
  const AMP = window.AMP;
  const cfg = AMP.cfg;
  const T = AMP.T;
  const $ = id => document.getElementById(id);
  const svg = window.AMPIcons.svg;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = sec => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  // Ab dieser Breite Seitenleiste statt Reiter (wie die Musik-Apps auf dem iPad)
  const WIDE = 720;
  const TABS = ['home', 'new', 'library'];
  const LIBRARY = ['playlists', 'artists', 'albums', 'songs', 'recent', 'favorites'];
  const LABELS = {
    home: 'Home', new: 'New', library: 'Library', search: 'Search', playlists: 'Playlists', artists: 'Artists',
    albums: 'Albums', songs: 'Liked Songs', recent: 'Recently played', favorites: 'Favorites',
  };
  let view = 'home';
  let viewBeforeSearch = 'home';
  let wide = null;
  let searchTimer = 0;
  let noticeTimer = 0;

  // Ränder der Visualisierung (Kachelname, Vollbild-Symbol) aus der iframe-Adresse
  const params = new URLSearchParams(location.search);
  ['margintop', 'marginside', 'marginbottom'].forEach(name => {
    const v = parseInt(params.get(name), 10);
    if (!isNaN(v)) document.documentElement.style.setProperty('--' + name, v + 'px');
  });

  function notice(text) {
    const el = $('notice');
    el.textContent = text;
    el.hidden = !text;
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // Hauptfarbe eines Covers aus einer kleinen Fassung des Bilds (i.scdn.co erlaubt CORS)
  const colorCache = {};
  function coverColor(images) {
    const url = AMP.artwork(images, 64);
    if (!url) return Promise.resolve('');
    if (!colorCache[url]) {
      colorCache[url] = new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 16;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 16, 16);
            const px = ctx.getImageData(0, 0, 16, 16).data;
            // Kräftige Farben zählen mehr als Grau, damit nicht jedes Cover zu Grau verschwimmt
            let r = 0, g = 0, b = 0, w = 0;
            for (let i = 0; i < px.length; i += 4) {
              const weight = 0.2 + (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2])) / 255;
              r += px[i] * weight; g += px[i + 1] * weight; b += px[i + 2] * weight; w += weight;
            }
            resolve('#' + [r, g, b].map(v => Math.round(v / w).toString(16).padStart(2, '0')).join(''));
          } catch (e) { resolve(''); }
        };
        img.onerror = () => resolve('');
        img.src = url;
      });
    }
    return colorCache[url];
  }

  // ── Cover des geöffneten Albums bzw. der Playlist als Hintergrund des Inhalts ──
  function sizeBackdrop() {
    const rect = $('panel').getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--backdrop-left', Math.round(rect.left) + 'px');
    root.setProperty('--backdrop-h', Math.round(rect.width) + 'px');
    root.setProperty('--cover-h', Math.round(rect.width) + 'px');
  }
  let backdropOverride = null;
  let backdropShown = '';
  function setBackdrop(images) {
    backdropOverride = images || null;
    const backdrop = AMP.artwork(backdropOverride, 640);
    if (backdrop === backdropShown) return;
    backdropShown = backdrop;
    sizeBackdrop();
    $('backdrop').style.backgroundImage = backdrop ? 'url("' + backdrop.replace(/"/g, '%22') + '")' : '';
    document.body.classList.toggle('has-cover', !!backdrop);
    document.documentElement.classList.toggle('has-cover', !!backdrop);
    coverColor(backdropOverride).then(color => {
      if (backdropShown !== backdrop) return; // inzwischen ein anderes Cover
      if (color) document.documentElement.style.setProperty('--cover-color', color);
      else document.documentElement.style.removeProperty('--cover-color');
    });
  }

  // ── Listen ──
  const TYPES = { track: 'track', album: 'album', playlist: 'playlist', artist: 'artist' };
  const imagesOf = r => r.images || (r.album && r.album.images) || null;
  const subOf = r => {
    if (r.type === 'playlist') return (r.owner && r.owner.display_name) || '';
    const artists = r.artists || (r.album && r.album.artists) || [];
    return artists.map(a => a.name).join(', ');
  };
  // Verweis für Aktionen; own: eigene Playlist (bearbeitbar)
  function refOf(r) {
    return { type: TYPES[r.type], id: String(r.id), uri: r.uri || ('spotify:' + r.type + ':' + r.id), name: r.name || '', own: r.type === 'playlist' && !!r.owner && r.owner.id === cfg.userId };
  }
  function toItem(resource) {
    if (!resource || !TYPES[resource.type] || !resource.id) return null;
    const type = TYPES[resource.type];
    // Künstler lassen sich auch abspielen, aber die Zeile öffnet die Künstleransicht
    if (type === 'artist') return { name: resource.name || '', sub: '', art: imagesOf(resource), round: true, ref: refOf(resource), onClick: e => rowClick(e, resource, null) };
    const item = { name: resource.name || '', sub: subOf(resource), art: imagesOf(resource), play: { type, id: String(resource.id) }, ref: refOf(resource) };
    // Alben und Playlists: Cover spielt, der Rest der Zeile öffnet die Trackliste
    if (type === 'album' || type === 'playlist') item.open = () => window.AMPDetails.showCollection(resource);
    return item;
  }
  function rowClick(e, resource) {
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('.more')) window.AMPActions.menu(refOf(resource));
    else window.AMPDetails.showArtist(resource);
  }

  // Abspielen; läuft der Eintrag schon: anhalten bzw. an derselben Stelle weiter statt von vorn
  function playOrToggle(play) {
    if (AMP.isCurrent(play)) AMP.run(AMP.state().playing ? 'pause' : 'play');
    else AMP.run('playItem', play);
  }

  // Inhalte nur über esc() oder textContent: Namen kommen von Spotify bzw. aus der Instanz.
  function renderList(items, emptyText, target) {
    const panel = target || $('panel');
    if (!items.length) { panel.insertAdjacentHTML('beforeend', '<p class="empty">' + esc(emptyText) + '</p>'); return; }
    items.forEach(item => {
      const row = document.createElement('button');
      row.className = 'row';
      const art = AMP.artwork(item.art, 96);
      row.innerHTML = '<span class="thumb' + (item.round ? ' round' : '') + (item.play ? '' : ' noplay') + '"' + (art ? ' style="background-image:url(&quot;' + esc(art) + '&quot;)"' : '') + '></span>'
        + '<span class="txt"><b>' + esc(item.name) + '</b><small>' + esc(item.sub) + '</small></span>'
        + (item.ref ? moreButton() : '');
      if (item.play) row.dataset.play = JSON.stringify(item.play);
      row.onclick = item.onClick || (e => {
        const target = e.target instanceof Element ? e.target : null;
        if (target && target.closest('.more')) window.AMPActions.menu(item.ref);
        else if (item.open && !(target && target.closest('.thumb'))) item.open();
        else playOrToggle(item.play);
      });
      panel.appendChild(row);
    });
    markPlaying();
  }

  // Kacheln (Cover mit Name darunter): als Raster oder als waagerechtes Regal.
  // Cover spielt (Künstler: öffnet), der Name öffnet Album, Playlist oder Künstler; Alben: Tipp öffnet und spielt.
  function renderCards(resources, target, layout, subFn) {
    const box = document.createElement('div');
    box.className = layout === 'shelf' ? 'shelf' : 'grid';
    resources.forEach(resource => {
      const type = resource && TYPES[resource.type];
      if (!type || !resource.id) return;
      const card = document.createElement('div');
      card.className = 'card';
      const art = AMP.artwork(imagesOf(resource), 300);
      const sub = subFn ? subFn(resource) : subOf(resource);
      const round = type === 'artist' ? ' round noplay' : '';
      card.innerHTML = '<button class="card-art thumb' + round + '"' + (art ? ' style="background-image:url(&quot;' + esc(art) + '&quot;)"' : '') + ' aria-label="' + esc(resource.name) + '"></button>'
        + '<button class="card-txt"><b>' + esc(resource.name) + '</b><small>' + esc(sub) + '</small></button>';
      const play = { type, id: String(resource.id) };
      const open = type === 'artist' ? () => window.AMPDetails.showArtist(resource)
        : (type === 'album' || type === 'playlist') ? () => window.AMPDetails.showCollection(resource) : () => playOrToggle(play);
      if (type !== 'artist') card.dataset.play = JSON.stringify(play);
      card.querySelector('.card-art').onclick = type === 'artist' ? open : () => playOrToggle(play);
      card.querySelector('.card-txt').onclick = open;
      if (type === 'album') {
        card.querySelector('.card-art').onclick = card.querySelector('.card-txt').onclick = () => {
          open();
          if (!AMP.isCurrent(play)) AMP.run('playItem', play);
        };
      }
      box.appendChild(card);
    });
    target.appendChild(box);
    markPlaying();
    return box;
  }

  // Abschnitt mit Überschrift; leere Abschnitte entfallen
  function section(title, resources, layout, target) {
    const list = (resources || []).filter(r => r && TYPES[r.type] && r.id);
    if (!list.length) return false;
    const host = target || $('panel');
    const h = document.createElement('h3');
    h.textContent = title;
    host.appendChild(h);
    if (layout === 'list') {
      const holder = document.createElement('div');
      host.appendChild(holder);
      renderList(list.map(toItem).filter(Boolean), '', holder);
    } else {
      renderCards(list, host, layout);
    }
    return true;
  }

  // Cover des laufenden Eintrags bekommen beim Darüberfahren ein Stopp- statt Play-Symbol
  function markPlaying() {
    const playing = AMP.state().playing;
    document.querySelectorAll('[data-play] > .thumb').forEach(thumb => {
      let play = null;
      try { play = JSON.parse(thumb.parentElement.dataset.play); } catch (e) { play = null; }
      thumb.classList.toggle('playing', playing && AMP.isCurrent(play));
    });
    // Trackliste: laufenden Track markieren (Play-Symbol statt Nummer)
    const item = AMP.state().item;
    document.querySelectorAll('.row.track[data-track]').forEach(row => {
      row.classList.toggle('now', !!item && row.dataset.track === item.id);
    });
  }

  // „⋯“ innerhalb einer Zeile (die Zeile ist selbst ein Knopf, deshalb ein span)
  const moreButton = () => '<span class="more" role="button" aria-label="' + esc(T('More')) + '">' + svg('more') + '</span>';

  // Neue Seite: Inhalt leeren, Zurück-Knopf (schmal, aus einer Mediathek-Kategorie) und großer Titel
  function page(title, backTo) {
    const panel = $('panel');
    panel.classList.remove('detail');
    if (window.AMPDetails) window.AMPDetails.reset();
    panel.onscroll = null;
    panel.innerHTML = '';
    panel.scrollTop = 0;
    if (backTo && !wide) {
      const back = document.createElement('button');
      back.className = 'back';
      back.innerHTML = svg('back') + '<span>' + esc(T(LABELS[backTo])) + '</span>';
      back.onclick = () => select(backTo);
      panel.appendChild(back);
    }
    if (title) {
      const h = document.createElement('h1');
      h.className = 'page-title';
      h.textContent = title;
      panel.appendChild(h);
    }
    return panel;
  }

  // Inhalt laden: Ladehinweis, bei Fehler „Keine Ergebnisse“; nur, solange die Seite noch gilt
  async function load(fn) {
    const panel = $('panel');
    const shown = view;
    const hint = document.createElement('p');
    hint.className = 'empty';
    hint.textContent = T('Loading…');
    panel.appendChild(hint);
    try { await fn(() => view === shown); } catch (e) { if (view === shown) panel.insertAdjacentHTML('beforeend', '<p class="empty">' + esc(T('No results')) + '</p>'); }
    hint.remove();
  }

  const signedIn = () => cfg.mode === 'player';
  function notSignedIn() {
    if (signedIn()) return false;
    $('panel').insertAdjacentHTML('beforeend', '<p class="empty">' + esc(T('Not signed in to Spotify')) + '</p>');
    return true;
  }

  // Weitere Seiten (next-Adresse von Spotify) nachladen, sobald das Ende fast erreicht ist
  function pageOnScroll(first, render) {
    const panel = $('panel');
    const shown = view;
    let next = (first.artists || first).next || '';
    let busy = false;
    let count = (first.artists || first).items ? (first.artists || first).items.length : 0;
    const more = async () => {
      if (!next || busy || view !== shown || panel.onscroll !== more) return;
      if (panel.scrollTop + panel.clientHeight < panel.scrollHeight - 600) return;
      busy = true;
      try {
        const data = await AMP.api(next);
        const box = data.artists || data;
        if ((box.items || []).length && panel.onscroll === more) {
          const holder = document.createElement('div');
          panel.appendChild(holder);
          render(box.items, holder);
        }
        count += (box.items || []).length;
        next = count < 5000 ? box.next || '' : '';
      } catch (e) { next = ''; }
      busy = false;
      more();
    };
    panel.onscroll = more;
    more();
  }

  // ── Suchen: schmal ein eigener Reiter mit Feld über dem Inhalt, breit das Feld oben in der Seitenleiste ──
  function showSearch() {
    page('');
    search();
  }
  function bindSearch() {
    $('q').onkeydown = e => { if (e.key === 'Escape') { $('q').value = ''; $('q').oninput(); $('q').blur(); } };
    $('q').placeholder = T('Search Spotify');
    $('q').oninput = () => {
      clearTimeout(searchTimer);
      if ($('q').value.trim().length >= 2) {
        if (view !== 'search') { viewBeforeSearch = view; showView('search'); }
        // Ein aus der Suche geöffnetes Album verlassen, sonst landen die Treffer unter der Trackliste
        else if ($('panel').classList.contains('detail')) page('');
        searchTimer = setTimeout(search, 400);
      } else if (view === 'search') {
        if (wide) showView(viewBeforeSearch);
        else showSearch();
      }
    };
  }

  function search() {
    const term = $('q').value.trim();
    Array.from($('panel').querySelectorAll('.results')).forEach(el => el.remove());
    if (term.length < 2) return;
    const results = document.createElement('div');
    results.className = 'results';
    $('panel').appendChild(results);
    load(async current => {
      const data = await AMP.api('/v1/search', { q: term, type: 'artist,track,album,playlist', limit: 8 });
      if (!current() || $('q').value.trim() !== term) return;
      let any = false;
      [['artists', T('Artists')], ['tracks', T('Songs')], ['albums', T('Albums')], ['playlists', T('Playlists')]].forEach(([key, label]) => {
        any = section(label, data[key] && data[key].items, 'list', results) || any;
      });
      if (!any) renderList([], T('No results'), results);
    });
  }

  // ── Navigation ──
  function activeKey() {
    if (wide) return view;
    return LIBRARY.indexOf(view) >= 0 || view.indexOf('pl:') === 0 ? 'library' : view;
  }

  // Eigene Playlists unten in der Seitenleiste
  let sidePlaylists = null;
  const playlistResources = {};
  function loadSidePlaylists() {
    if (sidePlaylists || !signedIn()) return;
    sidePlaylists = [];
    AMP.api('/v1/me/playlists', { limit: 50 }).then(data => {
      sidePlaylists = (data.items || []).filter(Boolean).map(r => {
        playlistResources['pl:' + r.id] = r;
        return { key: 'pl:' + r.id, label: r.name || '', icon: 'playlists' };
      });
      buildNav();
    }).catch(() => { sidePlaylists = null; });
  }

  function buildNav() {
    const active = activeKey();
    if (wide) {
      const library = LIBRARY.filter(key => key !== 'favorites' || cfg.favorites.length);
      const groups = [
        { items: ['home', 'new'].map(key => ({ key, label: T(LABELS[key]), icon: key })) },
        { title: T('Library'), items: library.map(key => ({ key, label: T(LABELS[key]), icon: key })) },
      ];
      if (sidePlaylists && sidePlaylists.length) groups.push({ title: T('Playlists'), items: sidePlaylists });
      window.AMPNav.sidebar($('sideNav'), groups, active, select);
      loadSidePlaylists();
      return;
    }
    window.AMPNav.render(TABS.map(key => ({ key, label: T(LABELS[key]) })), active, select, T('More'));
    $('tabSearch').classList.toggle('active', view === 'search');
  }

  function select(key) {
    if (key !== 'search') $('q').value = '';
    showView(key);
    if (key === 'search' && !wide) setTimeout(() => $('q').focus(), 0);
  }

  function showView(key) {
    view = key;
    setBackdrop(null);
    document.documentElement.classList.toggle('searching', key === 'search');
    buildNav();
    if (key === 'search') { showSearch(); return; }
    if (key.indexOf('pl:') === 0) {
      page('');
      if (playlistResources[key]) window.AMPDetails.showCollection(playlistResources[key], { root: true });
      return;
    }
    const render = window.AMPViews[key];
    if (render) render();
  }

  function layout() {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    // Sehr kleine Kachel: nur Cover und Steuerung (layout.css, html.compact)
    document.documentElement.classList.toggle('compact', h <= 320 || (w <= 420 && h <= 520));
    const isWide = w >= WIDE;
    sizeBackdrop();
    if (isWide === wide) return;
    wide = isWide;
    document.documentElement.classList.toggle('wide', wide);
    (wide ? $('sideSearch') : $('topSearch')).appendChild($('searchWrap'));
    if (document.body.classList.contains('ready')) buildNav();
  }
  window.addEventListener('resize', layout);
  layout();

  // Anmeldung bzw. Einrichtung fehlt: Hinweis über allem
  function showLogin() {
    $('login').hidden = signedIn();
    if (signedIn()) return;
    $('loginText').textContent = T(cfg.mode === 'setup' ? 'Enter the Client ID in the instance first' : 'Not signed in to Spotify');
    $('bLogin').hidden = cfg.mode !== 'login';
    $('bLogin').textContent = T('Sign in with Spotify');
    $('bLogin').onclick = () => AMP.login();
  }

  AMP.onChange((kind, data) => {
    if (kind === 'state') markPlaying();
    // Favoriten geändert (Instanz oder andere Kachel): Navigation und betroffene Seiten auffrischen
    if (kind === 'favorites' && document.body.classList.contains('ready')) {
      if (view === 'favorites' || view === 'library') showView(view);
      else buildNav();
    }
    if (kind === 'error' || kind === 'notice') notice(data);
    if (kind === 'ready') {
      document.body.classList.add('ready');
      showLogin();
      showView(view);
    }
  });

  $('tabSearch').innerHTML = svg('search', 'tab-icon');
  $('tabSearch').title = T('Search');
  $('tabSearch').onclick = () => select('search');
  // Markenhinweis (Spotify Design Guidelines): Logo neben Inhalten aus Spotify
  ['sideBrand', 'npBrand'].forEach(id => { $(id).innerHTML = svg('spotify') + '<span>Spotify</span>'; });

  // Schnittstelle für details.js, views.js und player.js
  window.AMPUI = {
    $, T, esc, fmt, notice, renderList, renderCards, section, toItem, refOf, imagesOf, subOf, moreButton, markPlaying, TYPES, LABELS,
    page, load, notSignedIn, pageOnScroll, coverColor, playOrToggle, select, signedIn,
    tab: () => view,
    wide: () => wide,
    rerender: () => showView(view),
    setBackdrop,
    backdrop: () => backdropOverride,
  };

  bindSearch();
})();
