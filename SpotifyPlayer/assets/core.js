/* Musikplayer für Spotify – Kern: Web Playback SDK laden, Web API aufrufen, Befehle ausführen,
   Zustand melden. Im Browser läuft der SDK-Player einmal im Visu-Hauptfenster (gleicher Ursprung),
   damit die Musik einen Kategoriewechsel übersteht; die Kachel ist dann nur Bedienoberfläche.
   Spielt ein anderes Spotify-Connect-Gerät, zeigt die Kachel dessen Zustand (Abfrage alle 10 s)
   und steuert es über die Web API. Das SDK läuft auch in der Symcon-App auf iOS (gemessen 13.10.2026);
   offiziell unterstützt Spotify mobile Browser nicht. Ohne SDK bleibt nur die Fernsteuerung. */
(function () {
  'use strict';
  const cfg = window.SPM_CONFIG || {};
  // Ein Slot je Instanz: zwei Instanzen (zwei Spotify-Konten) auf einer Seite teilen weder Player noch Token
  const SLOT = '__symconSpotifyPlayer' + (/^\d+$/.test(String(cfg.instance || '')) ? '_' + cfg.instance : '');
  // Das SDK-Skript gibt es je Fenster nur einmal, auch für mehrere Instanzen
  const SDK_FLAG = '__symconSpotifySdk';
  const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
  const API = 'https://api.spotify.com';
  const ITEM_TYPES = ['track', 'album', 'playlist', 'artist'];
  const listeners = [];
  const bound = [];
  let host = null;
  try { if (window.top !== window && window.top.document.head) host = window.top; } catch (e) { host = null; }
  let win = host || window;
  let token = cfg.accessToken || '';
  let expiresAt = cfg.expiresAt || 0;
  let player = null; // SDK-Player (Objekt des Player-Fensters)
  let local = null;  // letzter Zustand des SDK-Players (null: ein anderes Gerät ist aktiv)
  let remote = null; // letzter Zustand von /v1/me/player
  let remoteAt = 0;
  let localVolume = 50;
  let premiumMissing = false;
  let lastReport = '';

  const T = key => (cfg.texts && cfg.texts[key]) || key;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const errText = e => (e && (e.reason || e.message || e.name)) || String(e);
  function randomId() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function emit(kind, data) { listeners.forEach(fn => { try { fn(kind, data); } catch (e) { debug('listener ' + kind + ': ' + errText(e)); } }); }
  function action(ident, value) { try { requestAction(ident, value); } catch (e) { /* außerhalb von Symcon */ } }
  // Fehler der Kachel landen im Debug-Fenster der Instanz (Fehlersuche ohne Browser-Konsole)
  function debug(text) { action('Debug', String(text).slice(0, 1000)); }
  window.addEventListener('error', e => debug('error: ' + (e.message || '') + ' @' + (e.lineno || 0)));
  window.addEventListener('unhandledrejection', e => debug('rejection: ' + errText(e.reason)));

  // Gemeinsamer Zustand des Fensters, das den SDK-Player besitzt. Objekte des Hauptfensters,
  // damit es keine (später verworfene) Kachel festhält.
  function slot() {
    let s = win[SLOT];
    if (!s) {
      s = new win.Object();
      s.state = 'new';
      s.error = '';
      s.deviceId = '';
      s.token = '';
      s.playerId = randomId();
      win[SLOT] = s;
    }
    return s;
  }

  // ── Access-Token: kommt beim Seitenaufbau und per Push (type token); bei 401 anfordern und warten ──
  let tokenWaiters = [];
  function setToken(value, exp) {
    token = value || '';
    expiresAt = exp || 0;
    slot().token = token;
    tokenWaiters.forEach(fn => fn());
    tokenWaiters = [];
  }
  function requestToken() {
    action('RefreshToken', '');
    return new Promise(resolve => { tokenWaiters.push(resolve); setTimeout(resolve, 8000); });
  }
  async function ensureToken() {
    if (token && expiresAt * 1000 - Date.now() > 60000) return token;
    await requestToken();
    return token;
  }

  // ── Web API ──
  // Spotify zählt Abrufe je App (gleitendes 30-s-Fenster); bei HTTP 429 pausieren alle Kacheln des Fensters
  const RATE_LIMIT_MIN = 30000;
  function rateLimitError() {
    const e = new Error('HTTP 429');
    e.status = 429;
    return e;
  }
  async function call(method, path, query, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((slot().rateLimitUntil || 0) > Date.now()) throw rateLimitError();
      const t = await ensureToken();
      if (!t) { const e = new Error(T('Not signed in to Spotify')); e.status = 401; throw e; }
      const qs = query && Object.keys(query).length ? (path.indexOf('?') >= 0 ? '&' : '?') + new URLSearchParams(query).toString() : '';
      const url = (path.indexOf('https://') === 0 ? path : API + path) + qs;
      const headers = { Authorization: 'Bearer ' + t };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      if (res.status === 401 && attempt === 0) { token = ''; await requestToken(); continue; }
      if (res.status === 429) {
        // Retry-After gibt Spotify Browsern nicht frei: dann 30 s, bei jedem weiteren 429 doppelt so lange (höchstens 1 h)
        const s = slot();
        const retry = (parseInt(res.headers.get('Retry-After'), 10) || 0) * 1000;
        const wait = retry > 0 ? Math.max(RATE_LIMIT_MIN, retry) : Math.min(3600000, Math.max(RATE_LIMIT_MIN, (s.rateLimitStep || 0) * 2));
        s.rateLimitStep = retry > 0 ? 0 : wait;
        s.rateLimitUntil = Date.now() + wait;
        debug('api ' + method + ' ' + path + ' -> 429, pause ' + Math.round(wait / 1000) + ' s');
        throw rateLimitError();
      }
      slot().rateLimitStep = 0;
      if (res.status === 204 || res.status === 202) return {};
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!res.ok) {
        debug('api ' + method + ' ' + path + ' -> ' + res.status + ' ' + ((data.error && (data.error.reason || data.error.message)) || ''));
        const err = new Error((data.error && (data.error.reason || data.error.message)) || ('HTTP ' + res.status));
        err.status = res.status;
        err.reason = data.error && data.error.reason;
        if (res.status === 401) loginExpired();
        throw err;
      }
      return data;
    }
    const e = new Error(T('Not signed in to Spotify'));
    e.status = 401;
    throw e;
  }

  // Lesende Abfragen 5 Minuten vorhalten. Der Speicher hängt am Slot des Player-Fensters und
  // übersteht im Browser damit auch das Neuladen der Kachel nach einem Kategoriewechsel.
  const CACHE_TTL = 5 * 60 * 1000;
  function cache() {
    const s = slot();
    if (!s.cache) s.cache = new win.Object();
    return s.cache;
  }
  function clearCache(prefix) {
    const c = cache();
    Object.keys(c).forEach(key => { if (!prefix || key.indexOf(prefix) === 0) delete c[key]; });
  }
  async function api(path, params) {
    const key = path + '?' + JSON.stringify(params || {});
    const hit = cache()[key];
    if (hit && Date.now() - hit.time < CACHE_TTL) return hit.data;
    const data = await call('GET', path, params);
    const entry = new win.Object();
    entry.time = Date.now();
    entry.data = data;
    cache()[key] = entry;
    return data;
  }
  // Alle Seiten einer Liste (items + next), bis max Einträge; /me/following liefert sie unter artists
  async function apiAll(path, params, max) {
    const limit = max || 1000;
    const all = [];
    let data = await api(path, params || {});
    for (;;) {
      const box = data.artists || data;
      const page = box.items || [];
      all.push(...page);
      if (!box.next || !page.length || all.length >= limit) break;
      data = await api(box.next);
    }
    return all.slice(0, limit);
  }

  // Nur eine bestehende Anmeldung kann ablaufen, und nur einmal je Seite melden.
  let expiredSent = false;
  function loginExpired() {
    if (expiredSent || cfg.mode !== 'player' || token) return;
    expiredSent = true;
    emit('error', T('Sign-in expired. Please sign in again.'));
  }

  // ── SDK-Player im Player-Fenster ──
  function on(target, name, fn) {
    (target.addListener || target.addEventListener).call(target, name, fn);
    bound.push([target, name, fn]);
  }
  function unbindAll() {
    bound.forEach(([t, n, f]) => { try { (t.removeListener || t.removeEventListener).call(t, n, f); } catch (e) { /* schon weg */ } });
    bound.length = 0;
  }
  window.addEventListener('pagehide', unbindAll);

  // spotify-player.js laden; der Bereit-Rückruf gehört dem Player-Fenster (keine Kachel-Funktion)
  function inject(s) {
    s.state = 'loading';
    s.loadingSince = Date.now();
    if (win.Spotify && win.Spotify.Player) win[SDK_FLAG] = 'ready';
    if (win[SDK_FLAG] === 'ready' || (win[SDK_FLAG] === 'loading' && Date.now() - (win[SDK_FLAG + 'Since'] || 0) < 15000)) return;
    win[SDK_FLAG] = 'loading';
    win[SDK_FLAG + 'Since'] = Date.now();
    win.onSpotifyWebPlaybackSDKReady = new win.Function('window["' + SDK_FLAG + '"] = "ready";');
    const el = win.document.createElement('script');
    el.src = SDK_URL;
    el.async = true;
    on(el, 'error', () => { s.state = 'error'; s.error = 'script'; win[SDK_FLAG] = ''; });
    win.document.head.appendChild(el);
  }

  async function loadPlayer() {
    const s = slot();
    s.token = token;
    if (s.state === 'error') s.state = 'new';
    if (s.state === 'new') inject(s);
    for (let i = 0; i < 300; i++) {
      if (s.state === 'ready') return s.player;
      // Die Kachel, die den Player einrichtet, kann mitten im Verbinden verworfen werden (Kategoriewechsel):
      // dann läuft ihre Fortsetzung nie. Nach 20 s übernimmt eine andere Kachel und trennt den halben Player.
      if (s.state === 'configuring' && Date.now() - (s.configuringSince || 0) > 20000) {
        if (s.pending) { try { s.pending.disconnect(); } catch (e) { /* egal */ } s.pending = null; }
        s.state = 'loading';
      }
      if (s.state === 'error') throw new Error(s.error);
      if (s.state === 'loading' && win[SDK_FLAG] === 'ready' && win.Spotify && win.Spotify.Player) {
        s.state = 'configuring';
        const since = s.configuringSince = Date.now();
        // Von einer anderen Kachel übernommen (siehe oben): dieses Ergebnis verwerfen
        const superseded = () => s.state !== 'configuring' || s.configuringSince !== since;
        try {
          const options = new win.Object();
          options.name = window.AMPPlayer ? await window.AMPPlayer.deviceName() : (cfg.playerName || 'Symcon');
          s.deviceName = options.name;
          options.volume = 0.5;
          // Token-Rückruf und Geräte-ID gehören dem Player-Fenster: das SDK hält keine Kachel fest
          options.getOAuthToken = new win.Function('cb', 'cb(window["' + SLOT + '"].token);');
          const p = new win.Spotify.Player(options);
          s.pending = p;
          p.addListener('ready', new win.Function('e', 'window["' + SLOT + '"].deviceId = e.device_id;'));
          p.addListener('not_ready', new win.Function('e', 'var s = window["' + SLOT + '"]; if (s.deviceId === e.device_id) s.deviceId = "";'));
          p.addListener('account_error', new win.Function('e', 'window["' + SLOT + '"].accountError = true;'));
          if (!(await p.connect())) throw new Error('connect');
          if (superseded()) { try { p.disconnect(); } catch (e) { /* egal */ } continue; }
          s.pending = null;
          s.player = p;
          s.state = 'ready';
        } catch (e) { if (!superseded()) { s.state = 'error'; s.error = errText(e); } }
        continue;
      }
      if (s.state === 'loading' && !win.Spotify && Date.now() - (s.loadingSince || 0) > 15000) inject(s);
      await sleep(100);
    }
    throw new Error('timeout');
  }

  function bindPlayer() {
    on(player, 'player_state_changed', state => {
      local = state || null;
      if (local) player.getVolume().then(v => { localVolume = Math.round(v * 100); }).catch(() => {});
      emit('state');
      report(false);
    });
    on(player, 'authentication_error', () => { token = ''; requestToken(); });
    on(player, 'account_error', () => { premiumMissing = true; emit('notice', T('Spotify Premium is required for playback')); });
    on(player, 'playback_error', e => emit('error', T('Playback failed') + ' (' + errText(e) + ')'));
    on(player, 'initialization_error', e => emit('error', T('Spotify could not be loaded') + ' (' + errText(e) + ')'));
  }

  // ── Zustand: SDK-Player, wenn er das aktive Gerät ist, sonst das abgefragte Connect-Gerät ──
  const REPEAT_FROM_API = { off: 0, context: 1, track: 2 };
  const REPEAT_TO_API = { 0: 'off', 1: 'context', 2: 'track' };
  // Zuletzt gespielt: ohne aktives Gerät zeigt die Kachel den letzten Titel pausiert an (kein Autoplay);
  // Play startet ihn dann auf dieser Kachel. Quelle: laufende Wiedergabe dieser Sitzung, sonst recently-played.
  let lastPlayed = null;
  function state() {
    const live = liveState();
    if (live.item) {
      const position = Math.min(live.duration, live.position + (live.playing ? Date.now() - live.at : 0));
      lastPlayed = { item: live.item, duration: live.duration, position, context: live.context || '' };
      return live;
    }
    if (!lastPlayed) return live;
    return Object.assign(live, { item: lastPlayed.item, duration: lastPlayed.duration, position: lastPlayed.position, context: lastPlayed.context, last: true });
  }
  async function loadLastPlayed() {
    if (lastPlayed || state().item) return;
    try {
      const entry = ((await api('/v1/me/player/recently-played', { limit: 1 })).items || [])[0];
      const t = entry && entry.track;
      if (!t || !t.id || lastPlayed) return;
      lastPlayed = {
        item: { id: t.id, uri: t.uri, name: t.name, artist: (t.artists || []).map(a => a.name).join(', '), album: t.album ? t.album.name : '', albumId: t.album ? t.album.id : '', images: t.album ? t.album.images : null, type: 'track' },
        duration: t.duration_ms || 0, position: 0, context: (entry.context && entry.context.uri) || '',
      };
      emit('state');
    } catch (e) { /* bleibt leer */ }
  }
  function liveState() {
    const s = slot();
    if (local && local.track_window && local.track_window.current_track) {
      const t = local.track_window.current_track;
      return {
        playing: !local.paused, position: local.position || 0, duration: local.duration || 0, at: Date.now(),
        item: { id: t.id, uri: t.uri, name: t.name, artist: (t.artists || []).map(a => a.name).join(', '), album: t.album && t.album.name, albumId: t.album && t.album.uri ? String(t.album.uri).split(':').pop() : '', images: t.album && t.album.images, type: t.type || 'track' },
        shuffle: !!local.shuffle, repeat: local.repeat_mode || 0, volume: localVolume,
        context: local.context && local.context.uri, deviceId: s.deviceId, deviceName: s.deviceName || cfg.playerName, deviceType: 'tile', local: true,
      };
    }
    if (remote && remote.device) {
      const it = remote.item || null;
      const d = remote.device;
      return {
        playing: !!remote.is_playing, position: remote.progress_ms || 0, duration: it ? it.duration_ms || 0 : 0, at: remoteAt,
        item: it ? { id: it.id, uri: it.uri, name: it.name, artist: (it.artists || []).map(a => a.name).join(', '), album: it.album ? it.album.name : (it.show ? it.show.name : ''), albumId: it.album ? it.album.id : '', images: it.album ? it.album.images : it.images, type: it.type } : null,
        shuffle: !!remote.shuffle_state, repeat: REPEAT_FROM_API[remote.repeat_state] || 0, volume: typeof d.volume_percent === 'number' ? d.volume_percent : null,
        context: remote.context && remote.context.uri, deviceId: d.id, deviceName: d.name, deviceType: d.type, local: d.id === s.deviceId,
      };
    }
    return { playing: false, position: 0, duration: 0, at: Date.now(), item: null, shuffle: false, repeat: 0, volume: null, context: '', deviceId: '', deviceName: '', deviceType: '', local: false };
  }

  // Aktives Gerät alle 10 s abfragen (30 s, solange der SDK-Player selbst spielt; der Fortschritt läuft
  // dazwischen in player.js weiter) und kurz nach dem erwarteten Titelende; nur bei sichtbarer Kachel.
  // Mehrere Kacheln einer Instanz im selben Fenster teilen sich das Ergebnis (als Text im Slot, damit
  // das Hauptfenster keine Objekte einer verworfenen Kachel hält).
  const SHARED_POLL = 8000;
  let polling = false;
  async function poll() {
    if (polling || document.visibilityState === 'hidden' || !token) return;
    polling = true;
    try {
      const s = slot();
      if (s.remoteAt && Date.now() - s.remoteAt < SHARED_POLL) {
        remote = JSON.parse(s.remoteJson || 'null');
        remoteAt = s.remoteAt;
      } else {
        const data = await call('GET', '/v1/me/player', { additional_types: 'track,episode' });
        remote = data && data.device ? data : null;
        remoteAt = Date.now();
        s.remoteJson = JSON.stringify(remote);
        s.remoteAt = remoteAt;
      }
      // Spielt ein anderes Gerät, ist der SDK-Zustand veraltet
      if (remote && remote.device.id !== slot().deviceId) local = null;
      emit('state');
      report(false);
    } catch (e) { /* nächster Versuch */ }
    polling = false;
  }
  let pollTimer = 0;
  function nextPoll() {
    const every = local ? 30000 : 10000;
    if (local || !remote || !remote.is_playing || !remote.item) return every;
    const left = (remote.item.duration_ms || 0) - (remote.progress_ms || 0) - (Date.now() - remoteAt);
    return left > 0 && left < every ? left + 1500 : every;
  }
  function schedulePoll(delay) {
    clearTimeout(pollTimer);
    const pause = (slot().rateLimitUntil || 0) - Date.now();
    pollTimer = setTimeout(async () => { await poll(); schedulePoll(nextPoll()); }, Math.max(delay, pause));
  }

  async function listDevices() {
    try { return (await call('GET', '/v1/me/player/devices')).devices || []; } catch (e) { return []; }
  }

  // ── Befehle ──
  function deviceParam() {
    const current = state();
    const id = current.deviceId || slot().deviceId;
    return id ? { device_id: id } : {};
  }
  async function perform(command, args) {
    const current = state();
    const useLocal = player && current.local && local;
    switch (command) {
      case 'play':
        if (useLocal) return player.resume();
        if (current.last && current.item) {
          // Zuletzt gespielten Titel an der gemerkten Stelle starten, im Album bzw. in der Playlist, sonst einzeln
          const body = /^spotify:(album|playlist):[A-Za-z0-9]{22}$/.test(current.context) ? { context_uri: current.context, offset: { uri: current.item.uri } } : { uris: [current.item.uri] };
          body.position_ms = Math.max(0, Math.round(current.position || 0));
          return call('PUT', '/v1/me/player/play', deviceParam(), body);
        }
        return call('PUT', '/v1/me/player/play', deviceParam());
      case 'pause': return useLocal ? player.pause() : call('PUT', '/v1/me/player/pause', deviceParam());
      case 'next': return useLocal ? player.nextTrack() : call('POST', '/v1/me/player/next', deviceParam());
      case 'previous': return useLocal ? player.previousTrack() : call('POST', '/v1/me/player/previous', deviceParam());
      case 'seek': return useLocal ? player.seek(Math.round(args.value)) : call('PUT', '/v1/me/player/seek', Object.assign({ position_ms: Math.round(args.value) }, deviceParam()));
      case 'volume': {
        const v = Math.max(0, Math.min(100, Math.round(Number(args.value) || 0)));
        localVolume = v;
        if (useLocal) return player.setVolume(v / 100);
        if (remote && remote.device) remote.device.volume_percent = v;
        return call('PUT', '/v1/me/player/volume', Object.assign({ volume_percent: v }, deviceParam()));
      }
      case 'shuffle': return call('PUT', '/v1/me/player/shuffle', Object.assign({ state: args.value ? 'true' : 'false' }, deviceParam()));
      case 'repeat': return call('PUT', '/v1/me/player/repeat', Object.assign({ state: REPEAT_TO_API[args.value] || 'off' }, deviceParam()));
      case 'playItem': {
        if (ITEM_TYPES.indexOf(args.type) < 0 || !/^[A-Za-z0-9]{22}$/.test(String(args.id))) return Promise.resolve();
        const uri = 'spotify:' + args.type + ':' + args.id;
        // Nur als Brücke, bis Spotify den neuen Kontext meldet (isCurrent); Titel erkennt isCurrent an der ID
        slot().context = args.type === 'track' ? '' : uri;
        slot().contextAt = Date.now();
        const body = args.type === 'track' ? { uris: [uri] } : { context_uri: uri };
        // Titel aus einer Liste (Top-Titel, Suche …): die ganze Liste ab diesem Titel, wie in der Spotify-App;
        // ein einzelner Titel ergäbe eine Warteschlange, die nur ihn selbst wiederholt
        const list = args.type === 'track' && Array.isArray(args.list) ? args.list.filter(u => /^spotify:track:[A-Za-z0-9]{22}$/.test(u)).slice(0, 100) : [];
        if (list.length > 1 && list.indexOf(uri) >= 0) { body.uris = list; body.offset = { uri }; }
        if (args.type !== 'track' && Number.isInteger(args.index) && args.index > 0) body.offset = { position: args.index };
        return call('PUT', '/v1/me/player/play', deviceParam(), body);
      }
      case 'playUris': return call('PUT', '/v1/me/player/play', deviceParam(), { uris: args.uris });
      case 'queue': return call('POST', '/v1/me/player/queue', Object.assign({ uri: args.uri }, deviceParam()));
      case 'transfer':
        action('Device', args.id);
        return call('PUT', '/v1/me/player', {}, { device_ids: [args.id], play: args.play !== false });
    }
    return Promise.resolve();
  }

  // Liefert true bei Erfolg; Fehler zeigt die Kachel als Hinweis.
  function run(command, args) {
    return Promise.resolve().then(() => perform(command, args || {})).then(() => {
      // Zustand bald nachziehen (die Web API meldet Änderungen nicht von selbst); das geteilte Ergebnis ist jetzt alt
      slot().remoteAt = 0;
      schedulePoll(command === 'volume' ? 1500 : 600);
      return true;
    }, e => {
      if (e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404) emit('error', T('No device available: open the tile in a browser or start Spotify on a device'));
      else if (e.reason === 'PREMIUM_REQUIRED') emit('error', T('Spotify Premium is required for playback'));
      else if (e.status !== 401) emit('error', T('Playback failed') + ' (' + errText(e) + ')');
      return false;
    });
  }

  // ── Zustand an Symcon melden (Ereignisse 300 ms gesammelt) ──
  // Nur, was Spotify wirklich meldet: „zuletzt gespielt“ ist Anzeige, kein Wiedergabezustand für die Variablen
  function snapshot() {
    const c = liveState();
    const images = c.item && c.item.images;
    return {
      playing: c.playing, title: c.item ? c.item.name || '' : '', artist: c.item ? c.item.artist || '' : '', album: c.item ? c.item.album || '' : '',
      cover: images && images[0] ? images[0].url : '', volume: c.volume, shuffle: c.shuffle, repeat: c.repeat,
      device: c.deviceName || '', deviceId: c.deviceId || '', local: c.local,
    };
  }
  let reportTimer = 0;
  function report(force) {
    clearTimeout(reportTimer);
    if (!force) { reportTimer = setTimeout(() => reportNow(false), 300); return; }
    reportNow(true);
  }
  function reportNow(force) {
    const json = JSON.stringify(snapshot());
    const s = slot();
    const now = Date.now();
    if (!force && (json === lastReport || (json === s.lastReport && now - (s.lastReportAt || 0) < 2000))) return;
    lastReport = json;
    s.lastReport = json;
    s.lastReportAt = now;
    action('State', json);
  }

  // ── Nachrichten vom Modul ──
  function receive(data) {
    let msg;
    try { msg = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'reload') { location.reload(); return; }
    if (msg.type === 'auth') {
      // Schon abgemeldet geladen: nichts zu tun (sonst lädt jede Abmeldung alle Kacheln endlos neu).
      if (msg.signedIn === false && cfg.mode !== 'player') return;
      if (msg.signedIn === false && player) { try { player.disconnect(); } catch (e) { /* egal */ } }
      location.reload();
      return;
    }
    if (msg.type === 'token' && typeof msg.accessToken === 'string') { setToken(msg.accessToken, Number(msg.expiresAt) || 0); return; }
    if (msg.type === 'login' && msg.playerId === slot().playerId && typeof msg.url === 'string') {
      if (msg.url.indexOf('https://oauth.ipmagic.de/authorize/') === 0) {
        if (loginWindow && !loginWindow.closed) loginWindow.location.href = msg.url;
        else window.open(msg.url, '_blank', 'popup,width=520,height=760');
      } else {
        // Ohne Connect startet keine Anmeldung
        if (loginWindow && !loginWindow.closed) loginWindow.close();
        loginWindow = null;
        emit('error', T('Signing in needs an active Symcon Connect'));
      }
      return;
    }
    if (msg.type === 'favorites' && Array.isArray(msg.favorites)) { cfg.favorites = msg.favorites; emit('favorites'); }
  }
  window.handleMessage = receive;
  window.addEventListener('message', ev => {
    if (ev.source !== window && ev.source !== window.parent) return;
    receive(ev.data);
  });

  // Anmeldung: das Fenster sofort im Klick öffnen (sonst blockt der Browser es), die Adresse des
  // Symcon-OAuth-Dienstes kommt vom Modul per Push (type login) für genau diese Kachel.
  let loginWindow = null;
  function login() {
    loginWindow = window.open('', '_blank', 'popup,width=520,height=760');
    if (!loginWindow) { emit('error', T('Sign-in window blocked: allow pop-ups for this page')); return; }
    try { loginWindow.document.write('<p style="font:16px sans-serif;padding:24px">Spotify …</p>'); } catch (e) { /* egal */ }
    action('Login', slot().playerId);
    setTimeout(() => { if (loginWindow && !loginWindow.closed && loginWindow.location.href === 'about:blank') { loginWindow.close(); loginWindow = null; emit('error', T('Spotify could not be loaded')); } }, 10000);
  }
  function logout() {
    if (player) { try { player.disconnect(); } catch (e) { /* egal */ } }
    action('Logout', '');
  }

  // Bild passender Größe aus Spotifys images-Liste (absteigend sortiert)
  function artwork(images, size) {
    if (!Array.isArray(images) || !images.length) return '';
    let best = images[0];
    images.forEach(img => { if (img && img.width && img.width >= size && img.width < (best.width || Infinity)) best = img; });
    return (best && best.url) || '';
  }

  async function start() {
    if (cfg.mode !== 'player') { emit('ready'); return; }
    slot().token = token;
    // SDK-Player: im Hauptfenster, sonst in der Kachel; ohne SDK nur Fernsteuerung
    try {
      player = await loadPlayer();
    } catch (e) {
      debug('sdk ' + (host ? 'host' : 'tile') + ': ' + errText(e));
      if (host) {
        host = null;
        win = window;
        try { player = await loadPlayer(); } catch (e2) { player = null; }
      }
    }
    if (player) {
      bindPlayer();
      try { local = await player.getCurrentState(); } catch (e) { local = null; }
      if (slot().accountError) premiumMissing = true;
    }
    // Chrome & Co. geben den Kopierschutz (Widevine) nur auf sicheren Seiten frei (https, localhost)
    if (!player && !window.isSecureContext && !/iPhone|iPad|iPod/.test(navigator.userAgent)) emit('notice', T('Playback needs a secure connection (https). Open the visualization via the Connect address.'));
    emit('ready');
    await poll();
    loadLastPlayed();
    schedulePoll(nextPoll());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePoll(0); });
    report(true);
    // Lebenszeichen fürs Modul (es fragt dann selbst nicht ab): nur mit frischem Zustand, also sichtbar
    // (Abfrage läuft) oder mit spielendem SDK-Player (Ereignisse)
    setInterval(() => { if (document.visibilityState === 'visible' || local) report(true); }, 30000);
  }

  window.AMP = {
    cfg, T, start, run, api, apiAll, call, clearCache, login, logout, state, artwork, debug,
    devices: listDevices,
    onChange: fn => listeners.push(fn),
    notify: text => emit('notice', text),
    hasPlayer: () => !!player && !premiumMissing,
    sdkDevice: () => slot().deviceId,
    premiumMissing: () => premiumMissing,
    // Ist dieser Eintrag der zuletzt gestartete Kontext bzw. der laufende Titel?
    isCurrent: play => {
      if (!play) return false;
      const c = state();
      const uri = 'spotify:' + play.type + ':' + play.id;
      // Gerade gestarteter Kontext zählt nur, bis Spotify einen meldet (höchstens 15 s); sonst gilt der gemeldete
      const started = !c.context && !c.last && !!c.item && slot().context === uri && Date.now() - (slot().contextAt || 0) < 15000;
      return (c.context && !c.last && c.context === uri) || started || (play.type === 'track' && !!c.item && !c.last && c.item.id === play.id);
    },
  };
})();
