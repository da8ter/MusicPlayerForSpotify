/* Musikplayer für Spotify – Sonos. Zwei Wege, beide über das Modul und das Heimnetz, weil Spotify die
   Lautsprecher über die Web API weder nennt noch steuern lässt:
   1. Sonos-Raum als Ziel (aus der Geräteauswahl): Das Modul stellt Playlist, Album oder Titel in die Warteschlange
      des Lautsprechers und meldet dessen Zustand (Nachricht „sonos“); Spotify weiß von dieser Wiedergabe nichts.
   2. Spotify Connect läuft schon auf einem Sonos (aus der Spotify-App gestartet): Spotify meldet das Gerät als
      eingeschränkt und lehnt Befehle ab; Wiedergabe, Springen und Lautstärke gehen deshalb ans Modul. */
(function () {
  'use strict';
  window.AMPSonos = function (ctx) {
    const base = ctx.cfg.sonos && typeof ctx.cfg.sonos === 'object' ? ctx.cfg.sonos : {};
    const rooms = Array.isArray(base.rooms) ? base.rooms.filter(r => r && typeof r.id === 'string' && typeof r.name === 'string') : [];
    const PLAYBACK = { play: 2, pause: 3, next: 4, previous: 0 };
    const ID = /^[A-Za-z0-9]{22}$/;
    let st = null;    // Zustand des Ziel-Raums (letzte Nachricht des Moduls), null = kein Sonos-Ziel
    let stAt = 0;
    let meta = null;  // Album und Cover des laufenden Titels, bei Spotify nachgeschlagen
    let metaFor = '';
    const send = data => ctx.action('Sonos', JSON.stringify(data));
    const done = Promise.resolve('sonos');

    function take(msg) {
      st = msg && msg.active && msg.room && typeof msg.room.id === 'string' ? msg : null;
      stAt = Date.now();
      const id = st && ID.test(String(st.trackId)) ? st.trackId : '';
      if (!id || id === metaFor) return;
      metaFor = id;
      meta = null;
      ctx.api('/v1/tracks/' + id).then(t => {
        if (metaFor !== id || !t) return;
        meta = { albumId: t.album ? t.album.id : '', images: t.album ? t.album.images : null };
        ctx.emit('state');
      }).catch(() => { /* ohne Cover */ });
    }
    take(base.state);

    // Gilt, solange weder der eigene Player noch (laut Spotify) ein anderes Gerät spielt
    function active(local, remote) {
      return !!st && !(local && !local.paused) && !(remote && remote.is_playing && remote.device && !remote.device.is_restricted);
    }
    function live(local, remote) {
      if (!active(local, remote)) return null;
      const id = ID.test(String(st.trackId)) ? st.trackId : '';
      return {
        playing: !!st.playing, position: Number(st.position) || 0, duration: Number(st.duration) || 0, at: stAt,
        item: id ? { id, uri: 'spotify:track:' + id, name: st.title || '', artist: st.artist || '', album: st.album || '', albumId: meta ? meta.albumId : '', images: meta ? meta.images : null, type: 'track' } : null,
        shuffle: !!st.shuffle, repeat: Number(st.repeat) || 0, volume: typeof st.volume === 'number' ? st.volume : null,
        context: st.context || '', deviceId: 'sonos:' + st.room.id, deviceName: st.room.name, deviceType: 'Speaker', local: false, sonos: true,
      };
    }
    // Was gerade läuft (oder zuletzt lief), als Auftrag für den Lautsprecher bzw. als Rumpf für die Web API
    function content(current) {
      if (!current.item || !ID.test(String(current.item.id))) return null;
      const m = /^spotify:(album|playlist):([A-Za-z0-9]{22})$/.exec(current.context || '');
      const position = Math.max(0, Math.round(current.position + (current.playing ? Date.now() - current.at : 0)));
      return m ? { type: m[1], id: m[2], track: current.item.id, position } : { type: 'track', id: current.item.id, position };
    }

    /** Liefert ein Promise, wenn der Befehl hier erledigt ist, sonst null (dann geht er an Spotify). */
    function perform(command, args, current, useLocal, local, remote) {
      const value = Math.max(0, Math.min(100, Math.round(Number(args.value) || 0)));
      if (command === 'transfer' && typeof args.id === 'string' && args.id.indexOf('sonos:') === 0) {
        const room = rooms.filter(r => 'sonos:' + r.id === args.id)[0];
        if (!room) return Promise.reject(new Error('Sonos'));
        // Läuft etwas, wandert es mit: hier anhalten, dort an derselben Stelle starten
        const play = current.playing && !current.sonos ? content(current) : null;
        if (play) ctx.call('PUT', '/v1/me/player/pause', current.deviceId ? { device_id: current.deviceId } : {}).catch(() => { /* lief schon nicht mehr */ });
        send({ c: 'select', room: room.id, play });
        take({ active: true, room, playing: false, position: 0, duration: 0, trackId: '', volume: null, context: '' });
        return done;
      }
      if (active(local, remote)) {
        if (Object.prototype.hasOwnProperty.call(PLAYBACK, command)) {
          // Nichts in der Warteschlange des Raums: den zuletzt gespielten Titel dort starten
          const last = command === 'play' && !st.trackId ? content(current) : null;
          if (last) send({ c: 'play', type: last.type, id: last.id, list: [] }); else ctx.action('Playback', PLAYBACK[command]);
          if (command === 'play' || command === 'pause') { st.position = live(local, remote).position + (st.playing ? Date.now() - stAt : 0); stAt = Date.now(); st.playing = command === 'play'; }
          return done;
        }
        switch (command) {
          case 'seek': st.position = Math.max(0, Math.round(args.value)); stAt = Date.now(); ctx.action('Seek', st.position); return done;
          case 'volume': st.volume = value; ctx.action('Volume', value); return done;
          case 'shuffle': st.shuffle = !!args.value; send({ c: 'mode', shuffle: !!args.value }); return done;
          case 'repeat': st.repeat = Number(args.value) || 0; send({ c: 'mode', repeat: st.repeat }); return done;
          case 'playItem':
            if (!ID.test(String(args.id))) return done;
            send({ c: 'play', type: args.type, id: args.id, index: Number.isInteger(args.index) ? args.index : 0, list: Array.isArray(args.list) ? args.list.slice(0, 100) : [] });
            return done;
          case 'playUris': {
            const uris = (args.uris || []).filter(u => /^spotify:track:[A-Za-z0-9]{22}$/.test(u)).slice(0, 100);
            if (uris.length) send({ c: 'play', type: 'track', id: uris[0].split(':').pop(), list: uris });
            return done;
          }
          case 'queue': {
            const m = /^spotify:track:([A-Za-z0-9]{22})$/.exec(String(args.uri));
            if (m) send({ c: 'queue', id: m[1] });
            return done;
          }
        }
        return null;
      }
      // Spotify Connect auf einem eingeschränkten Gerät: Spotify lehnt diese Befehle mit 403 ab
      if (!useLocal && remote && remote.device && remote.device.is_restricted) {
        if (Object.prototype.hasOwnProperty.call(PLAYBACK, command)) { ctx.action('Playback', PLAYBACK[command]); return Promise.resolve(); }
        if (command === 'seek') { ctx.action('Seek', Math.max(0, Math.round(args.value))); return Promise.resolve(); }
        if (command === 'volume') { remote.device.volume_percent = value; ctx.action('Volume', value); return Promise.resolve(); }
      }
      return null;
    }

    /** Die Wiedergabe verlässt den Sonos-Raum: Ziel aufgeben; liefert, was dort lief, als Rumpf für /me/player/play. */
    function release(current) {
      if (!st) return null;
      const c = current.sonos ? content(current) : null;
      send({ c: 'release' });
      st = null;
      if (!c) return null;
      return c.track ? { context_uri: 'spotify:' + c.type + ':' + c.id, offset: { uri: 'spotify:track:' + c.track }, position_ms: c.position } : { uris: ['spotify:track:' + c.id], position_ms: c.position };
    }

    return { take, live, perform, release, rooms: () => rooms };
  };
})();
