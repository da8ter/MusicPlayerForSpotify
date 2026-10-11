/* Musikplayer für Spotify – Aktionen an Titeln, Alben, Playlists und Künstlern: Warteschlange,
   Playlists (anlegen, befüllen, umbenennen, Titel entfernen, löschen), Mediathek, Folgen, Favoriten. */
(function () {
  'use strict';
  const AMP = window.AMP;
  const T = AMP.T;
  const sheet = () => document.getElementById('sheet');
  const enc = encodeURIComponent;

  function close() {
    const el = sheet();
    el.hidden = true;
    el.innerHTML = '';
  }

  function button(text, onClick, className) {
    const b = document.createElement('button');
    b.className = className || 'sheet-item';
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }

  // Blatt von unten mit Titel, Inhalt und „Abbrechen“; Tippen daneben schließt.
  function open(title, build) {
    const el = sheet();
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sheet-box';
    const head = document.createElement('div');
    head.className = 'sheet-title';
    head.textContent = title;
    box.appendChild(head);
    build(box);
    box.appendChild(button(T('Cancel'), close, 'sheet-item sheet-cancel'));
    el.appendChild(box);
    if (window.AMPScroll) window.AMPScroll.bind(box); // sonst sperrt die Kachel das Scrollen im Blatt
    el.onclick = e => { if (e.target === el) close(); };
    el.hidden = false;
  }

  // Schreibende Aufrufe: die Mediathek ändert sich, vorgehaltene Listen verwerfen
  function write(method, path, query, body) {
    return AMP.call(method, path, query, body).then(r => { AMP.clearCache('/v1/me/'); AMP.clearCache('/v1/playlists/'); return r; });
  }

  // Titel eines Eintrags als URIs
  async function urisOf(ref) {
    if (ref.type === 'track') return [ref.uri];
    if (ref.type === 'album') return (await AMP.apiAll('/v1/albums/' + enc(ref.id) + '/tracks', { limit: 50 }, 500)).map(t => t.uri);
    if (ref.type === 'playlist') return (await AMP.apiAll('/v1/playlists/' + enc(ref.id) + '/tracks', { limit: 100, fields: 'next,items(track(uri,type))' }, 500)).map(i => i.track && i.track.type === 'track' ? i.track.uri : '').filter(Boolean);
    return [];
  }

  // Spotify stellt nur einzelne Titel hinten an: Alben und Playlists Titel für Titel (höchstens 50)
  async function enqueue(ref) {
    close();
    try {
      const uris = (await urisOf(ref)).slice(0, 50);
      for (const uri of uris) await AMP.call('POST', '/v1/me/player/queue', { uri });
      if (uris.length) AMP.notify(T('Added to the queue'));
    } catch (e) {
      AMP.notify(e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404 ? T('No device available: open the tile in a browser or start Spotify on a device') : T('Playback failed'));
    }
  }

  function pickPlaylist(ref) {
    open(T('Add to playlist'), box => {
      const create = document.createElement('div');
      create.className = 'sheet-new';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 100;
      input.placeholder = T('New playlist');
      create.appendChild(input);
      create.appendChild(button(T('Create'), async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        close();
        try {
          const playlist = await write('POST', '/v1/users/' + enc(AMP.cfg.userId) + '/playlists', {}, { name, public: false });
          await write('POST', '/v1/playlists/' + enc(playlist.id) + '/tracks', {}, { uris: (await urisOf(ref)).slice(0, 100) });
          AMP.notify(T('Playlist created') + ': ' + name);
        } catch (e) { AMP.notify(T('Could not change the playlist')); }
      }, 'primary'));
      box.appendChild(create);

      const list = document.createElement('div');
      list.className = 'sheet-list';
      list.textContent = T('Loading…');
      box.appendChild(list);
      AMP.apiAll('/v1/me/playlists', { limit: 50 }, 200).then(playlists => {
        list.innerHTML = '';
        // Nur Playlists, die das Konto bearbeiten darf (eigene oder gemeinsame)
        playlists.filter(p => p && (p.collaborative || (p.owner && p.owner.id === AMP.cfg.userId))).forEach(p => {
          list.appendChild(button(p.name || '', async () => {
            close();
            try {
              await write('POST', '/v1/playlists/' + enc(p.id) + '/tracks', {}, { uris: (await urisOf(ref)).slice(0, 100) });
              AMP.notify(T('Added to') + ' „' + (p.name || '') + '“');
            } catch (e) { AMP.notify(T('Could not change the playlist')); }
          }));
        });
      }).catch(() => { list.textContent = T('No results'); });
    });
  }

  // ── Mediathek: gespeichert (Titel, Alben), gefolgt (Künstler, Playlists) ──
  // null: unbekannt (die contains-Abfragen bekommen neue Apps nicht, HTTP 403)
  async function inLibrary(ref) {
    try {
      if (ref.type === 'track') return (await AMP.call('GET', '/v1/me/tracks/contains', { ids: ref.id }))[0] === true;
      if (ref.type === 'album') return (await AMP.call('GET', '/v1/me/albums/contains', { ids: ref.id }))[0] === true;
      if (ref.type === 'artist') return (await AMP.call('GET', '/v1/me/following/contains', { type: 'artist', ids: ref.id }))[0] === true;
      if (ref.type === 'playlist') return (await AMP.call('GET', '/v1/playlists/' + enc(ref.id) + '/followers/contains', { ids: AMP.cfg.userId }))[0] === true;
    } catch (e) { /* unbekannt */ }
    return null;
  }
  function setLibrary(ref, on) {
    const method = on ? 'PUT' : 'DELETE';
    if (ref.type === 'track') return write(method, '/v1/me/tracks', { ids: ref.id });
    if (ref.type === 'album') return write(method, '/v1/me/albums', { ids: ref.id });
    if (ref.type === 'artist') return write(method, '/v1/me/following', { type: 'artist', ids: ref.id });
    return write(method, '/v1/playlists/' + enc(ref.id) + '/followers', {});
  }
  const LIBRARY_LABELS = {
    track: ['Like', 'Remove like', 'Added to library', 'Removed from library'],
    album: ['Add to library', 'Remove from library', 'Added to library', 'Removed from library'],
    playlist: ['Add to library', 'Remove from library', 'Added to library', 'Removed from library'],
    artist: ['Follow artist', 'Unfollow artist', 'Now following', 'Unfollowed'],
  };
  // Hinzufügen oder Entfernen, je nachdem, ob der Eintrag schon in der Mediathek ist; ist das
  // nicht zu erfahren, stehen beide Knöpfe da
  function libraryButton(ref) {
    const labels = LIBRARY_LABELS[ref.type];
    const act = on => async () => {
      close();
      try {
        await setLibrary(ref, on);
        AMP.notify(T(on ? labels[2] : labels[3]));
      } catch (e) { AMP.notify(T('Could not change the library')); }
    };
    const add = button(T(labels[0]), act(true));
    const remove = button(T(labels[1]), act(false));
    add.disabled = remove.disabled = true;
    inLibrary(ref).then(has => {
      add.disabled = remove.disabled = false;
      add.hidden = has === true;
      remove.hidden = has === false;
    });
    const both = document.createDocumentFragment();
    both.appendChild(add);
    both.appendChild(remove);
    return both;
  }

  // ── Eigene Playlists bearbeiten ──
  function renamePlaylist(ref) {
    open(T('Rename playlist'), box => {
      const form = document.createElement('div');
      form.className = 'sheet-new';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 100;
      input.value = ref.name || '';
      form.appendChild(input);
      form.appendChild(button(T('Rename playlist'), async () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        close();
        try {
          await write('PUT', '/v1/playlists/' + enc(ref.id), {}, { name });
          AMP.notify(T('Playlist renamed'));
          window.AMPUI.rerender();
        } catch (e) { AMP.notify(T('Could not change the playlist')); }
      }, 'primary'));
      box.appendChild(form);
    });
  }
  async function deletePlaylist(ref) {
    close();
    try {
      await write('DELETE', '/v1/playlists/' + enc(ref.id) + '/followers', {});
      AMP.notify(T('Playlist deleted'));
      window.AMPUI.select('playlists');
    } catch (e) { AMP.notify(T('Could not change the playlist')); }
  }
  async function removeFromPlaylist(ref) {
    close();
    try {
      await write('DELETE', '/v1/playlists/' + enc(ref.inPlaylist.id) + '/tracks', {}, { tracks: [{ uri: ref.uri }] });
      AMP.notify(T('Removed from playlist'));
      document.querySelectorAll('.row.track[data-track="' + ref.id + '"]').forEach(row => row.remove());
    } catch (e) { AMP.notify(T('Could not change the playlist')); }
  }

  // ref: { type: 'track'|'album'|'playlist'|'artist', id, uri, name, own?, inPlaylist?: { id, own } }
  function menu(ref) {
    open(ref.name || '', box => {
      if (ref.type !== 'artist') box.appendChild(button(T('Add to queue'), () => enqueue(ref)));
      if (ref.type === 'track' || ref.type === 'album') box.appendChild(button(T('Add to playlist…'), () => pickPlaylist(ref)));
      if (!(ref.type === 'playlist' && ref.own)) box.appendChild(libraryButton(ref));
      if (ref.inPlaylist && ref.inPlaylist.own) box.appendChild(button(T('Remove from playlist'), () => removeFromPlaylist(ref)));
      if (ref.type === 'playlist' && ref.own) {
        box.appendChild(button(T('Rename playlist'), () => renamePlaylist(ref)));
        box.appendChild(button(T('Delete playlist'), () => deletePlaylist(ref)));
      }
      if (!isTileFavorite(ref)) box.appendChild(button(T('Add to tile favorites'), () => addTileFavorite(ref)));
      // Verweis auf Spotify (Branding Guidelines: gezeigte Inhalte verlinken auf Spotify)
      box.appendChild(button(T('Open in Spotify'), () => { close(); window.open('https://open.spotify.com/' + ref.type + '/' + enc(ref.id), '_blank'); }));
    });
  }

  // Kachel-Favoriten (Favoritenliste der Instanz, auch für Skripte und die Favorit-Variable)
  const isTileFavorite = ref => (AMP.cfg.favorites || []).some(f => f.type === ref.type && String(f.id) === String(ref.id));
  function addTileFavorite(ref) {
    close();
    try {
      requestAction('AddFavorite', JSON.stringify({ type: ref.type, id: String(ref.id), name: ref.name || '' }));
      AMP.notify(T('Added to tile favorites'));
    } catch (e) { /* außerhalb von Symcon */ }
  }

  window.AMPActions = { menu, inLibrary, setLibrary };
})();
