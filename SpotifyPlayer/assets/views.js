/* Musikplayer für Spotify – Inhalte der Bereiche: Start (zuletzt gehört, Top-Künstler, Top-Titel,
   eigene Playlists, gespeicherte Alben, gefolgte Künstler), Neu (Spotifys Neuerscheinungen, neue
   Alben der eigenen Künstler, zuletzt gespeichert), Entdecken (beliebte Playlists, Kategorien) und
   die Mediathek mit ihren Kategorien.
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
  const albumsOf = data => (data.items || []).map(i => i && i.album).filter(Boolean);
  const followed = data => (data.artists && data.artists.items) || [];

  // ── Start ──
  // Hörverlauf und Top-Listen sind bei neuen Konten leer: dann tragen Playlists, Alben und Künstler die Seite
  function home() {
    ui.page(T('Home'));
    if (ui.notSignedIn()) return;
    ui.load(async current => {
      const [recent, artists, tracks, playlists, albums, following] = await Promise.all([
        AMP.api('/v1/me/player/recently-played', { limit: 30 }).catch(none),
        AMP.api('/v1/me/top/artists', { limit: 12, time_range: 'short_term' }).catch(none),
        AMP.api('/v1/me/top/tracks', { limit: 12, time_range: 'short_term' }).catch(none),
        AMP.api('/v1/me/playlists', { limit: 12 }).catch(none),
        AMP.api('/v1/me/albums', { limit: 12 }).catch(none),
        AMP.api('/v1/me/following', { type: 'artist', limit: 12 }).catch(none),
      ]);
      if (!current()) return;
      let any = ui.section(T('Recently played'), uniqueTracks(recent.items).slice(0, 12), 'shelf');
      any = ui.section(T('Top artists'), artists.items, 'shelf') || any;
      any = ui.section(T('Top songs'), tracks.items, 'shelf') || any;
      any = ui.section(T('Your playlists'), (playlists.items || []).filter(Boolean), 'shelf') || any;
      any = ui.section(T('Saved albums'), albumsOf(albums), 'shelf') || any;
      any = ui.section(T('Artists you follow'), followed(following), 'shelf') || any;
      if (!any) ui.renderList([], T('No results'));
    });
  }

  // ── Neu: Spotifys Neuerscheinungen, neue Alben der Künstler, denen du folgst oder die du oft hörst; zuletzt gespeichert ──
  function fresh() {
    ui.page(T('New'));
    if (ui.notSignedIn()) return;
    ui.load(async current => {
      const [releases, following, top, saved] = await Promise.all([
        AMP.api('/v1/browse/new-releases', { limit: 30 }).catch(() => ({ albums: { items: [] } })),
        AMP.api('/v1/me/following', { type: 'artist', limit: 20 }).catch(none),
        AMP.api('/v1/me/top/artists', { limit: 10, time_range: 'medium_term' }).catch(none),
        AMP.api('/v1/me/albums', { limit: 20 }).catch(none),
      ]);
      if (!current()) return;
      let any = ui.section(T('New releases'), releases.albums && releases.albums.items, 'shelf');
      // Je Künstler die drei jüngsten Alben oder Singles, alle zusammen nach Erscheinungsdatum
      const seen = {};
      const artists = followed(following).concat(top.items || []).filter(a => a && a.id && !seen[a.id] && (seen[a.id] = true)).slice(0, 20);
      const lists = await Promise.all(artists.map(a => AMP.api('/v1/artists/' + encodeURIComponent(a.id) + '/albums', { include_groups: 'album,single', limit: 3, market: 'from_token' }).catch(none)));
      if (!current()) return;
      const ids = {};
      const latest = lists.flatMap(l => l.items || []).filter(a => a && a.id && !ids[a.id] && (ids[a.id] = true))
        .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || ''))).slice(0, 30);
      any = ui.section(T('New from your artists'), latest, 'grid') || any;
      any = ui.section(T('Recently saved'), albumsOf(saved), 'grid') || any;
      if (!any) ui.renderList([], T('No results'));
    });
  }

  // ── Entdecken: Spotifys beliebte Playlists und die Browse-Kategorien (Charts, Stimmung, Genres …) ──
  // Spotify liefert Namen und Bilder in der Sprache aus locale; ohne sie kommt Englisch.
  const locale = () => String(navigator.language || 'en-US').replace('-', '_');
  const playlistsOf = data => ((data.playlists && data.playlists.items) || []).filter(p => p && p.id);
  // Persönliche Mixe kommen in Kategorien oft nur als Platzhalter (Name leer, Bild ohne Adresse);
  // einzeln abgefragt liefert Spotify sie vollständig. Nur die Platzhalter nachladen.
  const hasArt = p => (p.images || []).some(i => i && i.url);
  async function completePlaylists(list) {
    return Promise.all(list.map(async p => {
      if (p.name && hasArt(p)) return p;
      try {
        const full = await AMP.api('/v1/playlists/' + encodeURIComponent(p.id), { fields: 'id,uri,type,name,description,images,owner(id,display_name)' });
        return Object.assign({}, p, full);
      } catch (e) { return p; }
    }));
  }
  function discover() {
    ui.page(T('Discover'));
    if (ui.notSignedIn()) return;
    ui.load(async current => {
      const [featured, categories] = await Promise.all([
        AMP.api('/v1/browse/featured-playlists', { limit: 20, locale: locale() }).catch(() => ({})),
        AMP.api('/v1/browse/categories', { limit: 50, locale: locale() }).catch(() => ({})),
      ]);
      if (!current()) return;
      const popular = await completePlaylists(playlistsOf(featured));
      if (!current()) return;
      let any = ui.section(T('Popular playlists'), popular, 'shelf');
      const list = ((categories.categories && categories.categories.items) || []).filter(c => c && c.id);
      if (list.length) {
        const h = document.createElement('h3');
        h.textContent = T('Browse all');
        $('panel').appendChild(h);
        const box = document.createElement('div');
        box.className = 'grid';
        list.forEach(c => box.appendChild(categoryCard(c)));
        $('panel').appendChild(box);
        any = true;
      }
      if (!any) ui.renderList([], T('No results'));
    });
  }

  // Kategorie als Kachel; ein Tipp öffnet ihre Playlists
  function categoryCard(c) {
    const card = document.createElement('div');
    card.className = 'card';
    const art = AMP.artwork(c.icons, 300);
    card.innerHTML = '<button class="card-art thumb noplay"' + (art ? ' style="background-image:url(&quot;' + esc(art) + '&quot;)"' : '') + ' aria-label="' + esc(c.name) + '"></button>'
      + '<button class="card-txt"><b>' + esc(c.name) + '</b></button>';
    card.querySelector('.card-art').onclick = card.querySelector('.card-txt').onclick = () => showCategory(c);
    return card;
  }

  function showCategory(c) {
    ui.page(c.name || '', 'discover', true);
    ui.load(async current => {
      const data = await AMP.api('/v1/browse/categories/' + encodeURIComponent(c.id) + '/playlists', { limit: 50, locale: locale() });
      if (!current()) return;
      const list = await completePlaylists(playlistsOf(data));
      if (!current()) return;
      if (!ui.section('', list, 'grid')) ui.renderList([], T('No results'));
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
    home, new: fresh, discover, library, favorites,
    playlists: () => category('playlists'),
    artists: () => category('artists'),
    albums: () => category('albums'),
    songs: () => category('songs'),
    recent: () => category('recent'),
  };
})();
