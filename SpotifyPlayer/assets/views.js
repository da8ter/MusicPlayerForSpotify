/* Musikplayer für Spotify – Inhalte der Bereiche: Start (zuletzt gehört, Top-Künstler, Top-Titel,
   Neuerscheinungen), Neu (Neuerscheinungen) und die Mediathek mit ihren Kategorien.
   Bausteine kommen aus ui.js (window.AMPUI). */
(function () {
  'use strict';
  const AMP = window.AMP;
  const ui = window.AMPUI;
  const { $, T, esc } = ui;
  const svg = window.AMPIcons.svg;
  const none = () => ({ items: [] });
  // Zuletzt gehörte Titel ohne Wiederholungen
  const uniqueTracks = items => {
    const seen = {};
    return (items || []).map(i => i.track).filter(t => t && t.id && !seen[t.id] && (seen[t.id] = true));
  };

  // ── Start ──
  function home() {
    ui.page(T('Home'));
    if (ui.notSignedIn()) return;
    ui.load(async current => {
      const [recent, artists, tracks, releases] = await Promise.all([
        AMP.api('/v1/me/player/recently-played', { limit: 30 }).catch(none),
        AMP.api('/v1/me/top/artists', { limit: 12, time_range: 'short_term' }).catch(none),
        AMP.api('/v1/me/top/tracks', { limit: 12, time_range: 'short_term' }).catch(none),
        AMP.api('/v1/browse/new-releases', { limit: 12 }).catch(() => ({ albums: { items: [] } })),
      ]);
      if (!current()) return;
      let any = ui.section(T('Recently played'), uniqueTracks(recent.items).slice(0, 12), 'shelf');
      any = ui.section(T('Top artists'), artists.items, 'shelf') || any;
      any = ui.section(T('Top songs'), tracks.items, 'shelf') || any;
      any = ui.section(T('New releases'), releases.albums && releases.albums.items, 'shelf') || any;
      if (!any) ui.renderList([], T('No results'));
    });
  }

  // ── Neu: Neuerscheinungen des eigenen Landes ──
  function fresh() {
    ui.page(T('New'));
    ui.load(async current => {
      const data = await AMP.api('/v1/browse/new-releases', { limit: 50 });
      if (!current()) return;
      const albums = (data.albums && data.albums.items) || [];
      if (!albums.length) { ui.renderList([], T('No results')); return; }
      ui.renderCards(albums, $('panel'), 'grid');
    });
  }

  // ── Mediathek: Kategorien wie in der App, darunter die Playlists ──
  const CATEGORIES = ['playlists', 'artists', 'albums', 'songs', 'recent', 'favorites'];
  function library() {
    const panel = ui.page(T('Library'));
    if (ui.notSignedIn()) return;
    const list = document.createElement('div');
    list.className = 'categories';
    CATEGORIES.filter(key => key !== 'favorites' || AMP.cfg.favorites.length).forEach(key => {
      const row = document.createElement('button');
      row.className = 'category';
      row.innerHTML = svg(key, 'cat-icon') + '<span>' + esc(T(ui.LABELS[key])) + '</span>' + svg('forward', 'cat-chevron');
      row.onclick = () => ui.select(key);
      list.appendChild(row);
    });
    panel.appendChild(list);
    ui.load(async current => {
      const data = await AMP.api('/v1/me/playlists', { limit: 24 });
      if (current()) ui.section(T('Playlists'), (data.items || []).filter(Boolean), 'grid');
    });
  }

  // Eine Kategorie der Mediathek, seitenweise; Alben als Raster
  const SOURCES = {
    playlists: ['/v1/me/playlists', { limit: 50 }, 'list', items => items],
    artists: ['/v1/me/following', { type: 'artist', limit: 50 }, 'list', items => items],
    albums: ['/v1/me/albums', { limit: 50 }, 'grid', items => items.map(i => i.album)],
    songs: ['/v1/me/tracks', { limit: 50 }, 'list', items => items.map(i => i.track)],
    recent: ['/v1/me/player/recently-played', { limit: 50 }, 'list', uniqueTracks],
  };
  function category(key) {
    const [path, params, layout, map] = SOURCES[key];
    ui.page(T(ui.LABELS[key]), 'library');
    if (ui.notSignedIn()) return;
    const render = (items, holder) => {
      const resources = map(items).filter(Boolean);
      if (layout === 'grid') ui.renderCards(resources, holder, 'grid');
      else ui.renderList(resources.map(ui.toItem).filter(Boolean), '', holder);
    };
    ui.load(async current => {
      const data = await AMP.api(path, params);
      if (!current()) return;
      const box = data.artists || data;
      if (!(box.items || []).length) { ui.renderList([], T('No results')); return; }
      const holder = document.createElement('div');
      $('panel').appendChild(holder);
      render(box.items, holder);
      if (box.next && key !== 'recent') ui.pageOnScroll(data, render);
    });
  }

  // Favoriten der Kachel (Instanz-Einstellungen)
  const TYPE_LABELS = { album: 'Album', playlist: 'Playlist', track: 'Song', artist: 'Artist' };
  function favorites() {
    ui.page(T('Favorites'), 'library');
    ui.renderList(AMP.cfg.favorites.map(f => ({
      name: f.name, sub: T(TYPE_LABELS[f.type] || f.type), play: { type: f.type, id: f.id }, round: f.type === 'artist',
      ref: { type: f.type, id: f.id, uri: f.uri, name: f.name },
      onClick: f.type === 'artist' ? e => {
        if (e.target instanceof Element && e.target.closest('.more')) window.AMPActions.menu({ type: f.type, id: f.id, uri: f.uri, name: f.name });
        else window.AMPDetails.showArtist({ type: 'artist', id: f.id, name: f.name, uri: f.uri });
      } : null,
    })), '');
  }

  window.AMPViews = {
    home, new: fresh, library, favorites,
    playlists: () => category('playlists'),
    artists: () => category('artists'),
    albums: () => category('albums'),
    songs: () => category('songs'),
    recent: () => category('recent'),
  };
})();
