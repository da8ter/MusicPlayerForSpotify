/* Musikplayer für Spotify – Detailansichten: Künstler, Album/Playlist mit Trackliste, Album des
   laufenden Titels. Gemeinsame Bausteine kommen aus ui.js (window.AMPUI). */
(function () {
  'use strict';
  const AMP = window.AMP;
  const ui = window.AMPUI;
  const { $, T, esc, fmt, notice, renderList, toItem, moreButton, markPlaying } = ui;
  const svg = window.AMPIcons.svg;
  let stack = []; // Ansichten vor dem Öffnen von Album/Playlist/Künstler (Knoten + Scrollstand), verschachtelt

  // Detailansicht beginnen: die bisherige Ansicht samt Scrollstand auf den Stapel legen,
  // „Zurück“ setzt sie unverändert wieder ein (auch verschachtelt: Künstler → Album → zurück).
  // root: eigene Seite ohne Zurück (Playlist aus der Seitenleiste)
  function beginDetail(root) {
    const panel = $('panel');
    panel.classList.add('detail');
    if (root) {
      stack = [];
      panel.onscroll = null;
      panel.innerHTML = '';
      panel.scrollTop = 0;
      return panel;
    }
    if (stack.length && stack[stack.length - 1].tab !== ui.tab()) stack = [];
    stack.push({ tab: ui.tab(), nodes: Array.from(panel.childNodes), scroll: panel.scrollTop, onscroll: panel.onscroll, backdrop: ui.backdrop() });
    const depth = stack.length;
    panel.onscroll = null;
    panel.innerHTML = '';
    panel.scrollTop = 0;
    const back = document.createElement('button');
    back.className = 'back';
    back.innerHTML = svg('back') + '<span>' + esc(T('Back')) + '</span>';
    back.onclick = () => {
      const view = stack.length === depth ? stack.pop() : null;
      panel.classList.toggle('detail', stack.length > 0);
      if (view && view.tab === ui.tab()) {
        panel.replaceChildren(...view.nodes);
        panel.scrollTop = view.scroll;
        panel.onscroll = view.onscroll;
        ui.setBackdrop(view.backdrop);
      } else {
        stack = [];
        ui.rerender();
      }
    };
    panel.appendChild(back);
    return panel;
  }

  // Kopf einer Detailseite: Bild, Name, Untertitel und Aktionen (Abspielen, ⋯)
  function head(resource, round, sub, kind) {
    const el = document.createElement('div');
    el.className = 'album-head';
    const art = AMP.artwork(ui.imagesOf(resource), 240);
    el.innerHTML = '<span class="album-art' + (round ? ' round' : '') + '"' + (art ? ' style="background-image:url(&quot;' + esc(art) + '&quot;)"' : '') + '></span>'
      + '<span class="txt"><b>' + esc(resource.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '<span class="album-actions"></span></span>';
    const actions = el.querySelector('.album-actions');
    const play = document.createElement('button');
    play.className = 'primary';
    // Auf schmalen Kacheln nur ein runder Knopf mit Play-Symbol (CSS blendet die Beschriftung aus)
    const label = T(kind === 'album' ? 'Play album' : kind === 'playlist' ? 'Play playlist' : 'Play');
    play.innerHTML = svg('play', 'play-icon') + '<span class="label">' + esc(label) + '</span>';
    play.setAttribute('aria-label', label);
    play.onclick = () => AMP.run('playItem', { type: kind, id: String(resource.id) });
    actions.appendChild(play);
    const more = document.createElement('button');
    more.className = 'more';
    more.innerHTML = svg('more');
    more.setAttribute('aria-label', T('More'));
    more.onclick = () => window.AMPActions.menu(ui.refOf(resource));
    actions.appendChild(more);
    return el;
  }

  // ── Künstler: Top-Titel und Alben ──
  function showArtist(resource) {
    const id = String(resource.id);
    const panel = beginDetail();
    ui.setBackdrop(null);
    const top = head(resource, true, '', 'artist');
    panel.appendChild(top);
    // Bild fehlt (z. B. Favorit aus der Instanz): nachladen
    if (!AMP.artwork(ui.imagesOf(resource), 240)) {
      AMP.api('/v1/artists/' + encodeURIComponent(id)).then(full => {
        const url = AMP.artwork(full.images, 240);
        if (url) top.querySelector('.album-art').style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        top.querySelector('.txt b').textContent = full.name || resource.name || '';
      }).catch(() => {});
    }
    const list = document.createElement('div');
    list.innerHTML = '<p class="empty">' + esc(T('Loading…')) + '</p>';
    panel.appendChild(list);
    (async () => {
      const base = '/v1/artists/' + encodeURIComponent(id);
      // Top-Titel bekommen neue Apps nicht mehr (HTTP 403): dann die Suche nach Titeln des Künstlers
      const topTracks = async () => {
        try { return (await AMP.api(base + '/top-tracks', { market: 'from_token' })).tracks || []; } catch (e) { /* Rückfall */ }
        const name = resource.name || (await AMP.api(base).catch(() => ({}))).name || '';
        if (!name) return [];
        const found = await AMP.api('/v1/search', { q: 'artist:"' + name.replace(/"/g, '') + '"', type: 'track', limit: 10, market: 'from_token' }).catch(() => ({}));
        return ((found.tracks && found.tracks.items) || []).filter(t => t && (t.artists || []).some(a => a.id === id));
      };
      const [top, albums] = await Promise.all([
        topTracks(),
        // Spotify erlaubt neuen Apps hier höchstens limit 10: seitenweise bis 50
        AMP.apiAll(base + '/albums', { include_groups: 'album,single', limit: 10, market: 'from_token' }, 50).catch(() => []),
      ]);
      list.innerHTML = '';
      const tracks = top.slice(0, 10);
      if (tracks.length) {
        const h = document.createElement('h3');
        h.textContent = T('Top songs');
        list.appendChild(h);
        const holder = document.createElement('div');
        list.appendChild(holder);
        renderList(tracks.map(toItem).filter(Boolean), '', holder);
      }
      // Alben als Kachelraster mit Erscheinungsjahr, ohne Dubletten (gleicher Name in mehreren Märkten)
      const seen = {};
      const unique = albums.filter(a => a && a.name && !seen[a.name] && (seen[a.name] = true));
      if (unique.length) {
        const h = document.createElement('h3');
        h.textContent = T('Albums');
        list.appendChild(h);
        ui.renderCards(unique, list, 'grid', yearOf);
      }
      if (!list.children.length) list.innerHTML = '<p class="empty">' + esc(T('No results')) + '</p>';
    })().catch(e => { AMP.debug('artist: ' + (e && (e.stack || e.message) || e)); list.innerHTML = '<p class="empty">' + esc(T('No results')) + '</p>'; });
  }

  const yearOf = resource => {
    const date = resource.release_date || '';
    return /^\d{4}/.test(date) ? date.slice(0, 4) : '';
  };

  // ── Album oder Playlist mit Trackliste ──
  function showCollection(resource, options) {
    const id = String(resource.id);
    const kind = ui.TYPES[resource.type];
    const ref = ui.refOf(resource);
    const panel = beginDetail(!!(options && options.root));
    // Das Cover des geöffneten Albums bzw. der Playlist wird zum Hintergrund
    ui.setBackdrop(ui.imagesOf(resource));
    panel.appendChild(head(resource, false, ui.subOf(resource), kind));

    const list = document.createElement('div');
    list.innerHTML = '<p class="empty">' + esc(T('Loading…')) + '</p>';
    panel.appendChild(list);
    (async () => {
      // Playlist-Inhalte (/items, seit Februar 2026) gibt Spotify nur für eigene und gemeinsame Playlists frei
      const path = kind === 'album' ? '/v1/albums/' + encodeURIComponent(id) + '/tracks' : '/v1/playlists/' + encodeURIComponent(id) + '/items';
      const params = kind === 'album' ? { limit: 50, market: 'from_token' } : { limit: 50, market: 'from_token', additional_types: 'track', fields: 'next,items(item(id,uri,name,type,duration_ms,track_number,artists(name)))' };
      const items = await AMP.apiAll(path, params, 1000);
      list.innerHTML = '';
      items.forEach((entry, index) => {
        const t = kind === 'album' ? entry : entry && entry.item;
        if (!t || !t.id || t.type === 'episode') return;
        const row = document.createElement('button');
        row.className = 'row track';
        const artists = (t.artists || []).map(a => a.name).join(', ');
        row.innerHTML = '<span class="num">' + esc(kind === 'album' && t.track_number ? t.track_number : index + 1) + '</span>'
          + '<span class="txt"><b>' + esc(t.name) + '</b>' + (artists && artists !== ui.subOf(resource) ? '<small>' + esc(artists) + '</small>' : '') + '</span>'
          + '<span class="dur">' + esc(fmt((t.duration_ms || 0) / 1000)) + '</span>' + moreButton();
        const trackRef = { type: 'track', id: String(t.id), uri: t.uri, name: t.name || '', inPlaylist: kind === 'playlist' ? { id, own: ref.own } : null };
        row.dataset.track = String(t.id);
        row.onclick = e => {
          if (e.target instanceof Element && e.target.closest('.more')) window.AMPActions.menu(trackRef);
          else AMP.run('playItem', { type: kind, id, index });
        };
        list.appendChild(row);
      });
      if (!list.children.length) list.innerHTML = '<p class="empty">' + esc(T('No results')) + '</p>';
      markPlaying();
    })().catch(e => {
      AMP.debug('collection: ' + (e && (e.stack || e.message) || e));
      // Fremde und redaktionelle Playlists gibt Spotify neuen Apps nicht frei (HTTP 403)
      list.innerHTML = '<p class="empty">' + esc(T(e && e.status === 403 ? 'Spotify does not share this content with this app' : 'No results')) + '</p>';
    });
  }

  // Album des laufenden Titels öffnen (Klick auf Titel in „Läuft gerade“)
  async function openNowPlayingAlbum() {
    const item = AMP.state().item;
    if (!item || !item.albumId) return;
    try {
      showCollection(await AMP.api('/v1/albums/' + encodeURIComponent(item.albumId), { market: 'from_token' }));
    } catch (e) { notice(T('No results')); }
  }

  window.AMPDetails = { showArtist, showCollection, openNowPlayingAlbum, reset: () => { stack = []; } };
})();
