/* Musikplayer für Spotify – Kern: Web Playback SDK laden, Befehle ausführen, Zustand melden
   (Token, Web API und Zwischenspeicher in webapi.js). Im Browser läuft der SDK-Player einmal im
   Visu-Hauptfenster (gleicher Ursprung), damit die Musik einen Kategoriewechsel übersteht.
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
  const ITEM_TYPES = ['track', 'album', 'playlist', 'artist'];
  const listeners = [];
  const bound = [];
  let host = null;
  try { if (window.top !== window && window.top.document.head) host = window.top; } catch (e) { host = null; }
  let win = host || window;
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

  // Access-Token, Web API und Zwischenspeicher: webapi.js
  const web = window.AMPWebApi({ cfg, T, slot, win: () => win, action, debug, emit });
  const { call, api, apiAll, clearCache, requestToken, setToken } = web;

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
    s.token = web.token();
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
          // Verlässt das Player-Fenster die Seite (Neuladen, App geschlossen), das Gerät bei Spotify abmelden;
          // sonst bleibt es dort stehen und jedes Neuladen fügt ein weiteres „Symcon · …“ hinzu
          if (!s.unloadBound) {
            s.unloadBound = true;
            win.addEventListener('pagehide', new win.Function('var s = window["' + SLOT + '"]; if (s && s.player) { try { s.player.disconnect(); } catch (e) {} }'));
          }
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
    on(player, 'authentication_error', () => { web.dropToken(); requestToken(); });
    on(player, 'account_error', () => { premiumMissing = true; emit('notice', T('Spotify Premium is required for playback')); });
    on(player, 'playback_error', e => emit('error', T('Playback failed') + ' (' + errText(e) + ')'));
    on(player, 'initialization_error', e => emit('error', T('Spotify could not be loaded') + ' (' + errText(e) + ')'));
    // iOS lässt Ton nur nach einer Berührung zu: eine frisch geladene Seite (Vergrößern, Schließen) darf
    // nicht von selbst weiterspielen. Dann beim nächsten Tippen fortsetzen.
    on(player, 'autoplay_failed', () => { needsTap = true; emit('notice', T('Tap the tile to continue playback')); });
  }
  // Jede Berührung schaltet den Ton des SDK-Players frei (activateElement muss im Tipp-Ereignis laufen)
  let needsTap = false;
  function unlockAudio() {
    if (!player || typeof player.activateElement !== 'function') return;
    try { player.activateElement(); } catch (e) { /* egal */ }
    if (needsTap) { needsTap = false; player.resume().catch(() => {}); }
  }
  ['touchend', 'click'].forEach(name => document.addEventListener(name, unlockAudio, true));

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
        context: remote.context && remote.context.uri, deviceId: d.id, deviceName: d.name, deviceType: d.type, local: d.id === ownDeviceId(),
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
  let pollAgain = false;
  let commandAt = 0;
  let pollOkAt = 0;
  async function poll() {
    if (document.visibilityState === 'hidden' || !web.token()) return;
    // Läuft schon eine Abfrage, nach ihr noch einmal fragen (sonst fällt der Nachlauf nach einem Befehl aus)
    if (polling) { pollAgain = true; return; }
    polling = true;
    const startedAt = Date.now();
    try {
      const s = slot();
      if (s.remoteAt && Date.now() - s.remoteAt < SHARED_POLL) {
        remote = JSON.parse(s.remoteJson || 'null');
        remoteAt = s.remoteAt;
      } else {
        const data = await call('GET', '/v1/me/player', { additional_types: 'track,episode' });
        // Kam während der Abfrage ein Befehl, ist die Antwort schon alt: verwerfen und gleich neu fragen
        if (commandAt > startedAt) { pollAgain = true; return; }
        remote = data && data.device ? data : null;
        remoteAt = Date.now();
        s.remoteJson = JSON.stringify(remote);
        s.remoteAt = remoteAt;
      }
      // Spielt ein anderes Gerät, ist der SDK-Zustand veraltet
      if (remote && remote.device.id !== slot().deviceId) local = null;
      pollOkAt = Date.now();
      emit('state');
      report(false);
    } catch (e) { /* nächster Versuch */ } finally {
      polling = false;
    }
  }
  let pollTimer = 0;
  function nextPoll() {
    // Nachlauf nach einem Befehl, der während einer laufenden Abfrage kam (poll setzt pollAgain)
    if (pollAgain) { pollAgain = false; return 300; }
    // 10 s nur, solange ein anderes Gerät spielt; spielt nichts (oder die Kachel selbst), ändert sich von
    // allein wenig: 30 s schonen das Kontingent, das alle Installationen der Symcon-App teilen
    if (local || !remote || !remote.is_playing || !remote.item) return 30000;
    const every = 10000;
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
    const id = current.deviceId || ownDeviceId();
    return id ? { device_id: id } : {};
  }
  async function perform(command, args) {
    if (command === 'noop') return Promise.resolve();
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
      case 'transfer': {
        const id = args.id === TILE_ID ? await ensureTilePlayer() : args.id;
        if (!id) { const e = new Error(T('Spotify could not be loaded')); e.status = 0; throw e; }
        action('Device', id);
        const put = () => call('PUT', '/v1/me/player', {}, { device_ids: [id], play: args.play !== false });
        return args.id === TILE_ID ? retry404(put) : put();
      }
    }
    return Promise.resolve();
  }

  // Liefert true bei Erfolg; Fehler zeigt die Kachel als Hinweis.
  const STARTS = ['play', 'playItem', 'playUris'];
  function run(command, args, retried) {
    return Promise.resolve().then(async () => {
      // Nirgends ein Gerät aktiv: auf dieser Kachel abspielen (Player bei Bedarf anlegen, Befehl nachsetzen)
      if (lazyTile && !retried && STARTS.indexOf(command) >= 0 && !state().deviceId && !ownDeviceId()) {
        emit('notice', T('Connecting this tile…'));
        if (await ensureTilePlayer()) return retry404(() => perform(command, args || {}));
      }
      return perform(command, args || {});
    }).then(() => {
      // Zustand bald nachziehen (die Web API meldet Änderungen nicht von selbst); das geteilte Ergebnis ist jetzt alt
      slot().remoteAt = 0;
      commandAt = Date.now();
      schedulePoll(command === 'volume' ? 1500 : 600);
      return true;
    }, async e => {
      const noDevice = e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404;
      // Das gemerkte Gerät gibt es nicht mehr (andere Ansicht weg): eigenen Player anlegen und nachsetzen
      if (noDevice && lazyTile && !retried && STARTS.indexOf(command) >= 0) {
        if (!player && sharedDevice()) forgetShared();
        // Das Gerät ist womöglich nur noch nicht registriert: nachsetzen, bis Spotify es annimmt
        if (await ensureTilePlayer()) return retry404(() => perform(command, args || {})).then(() => run('noop'), () => run(command, args, true));
      }
      if (noDevice) emit('error', T('No device available: open the tile in a browser or start Spotify on a device'));
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
      resetSlot(msg.signedIn === false);
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
    resetSlot(true);
    action('Logout', '');
  }
  // Konto gewechselt oder abgemeldet: nichts vom alten Konto im Hauptfenster stehen lassen (Zwischenspeicher,
  // gestarteter Kontext, abgefragter Zustand); abgemeldet auch den Player trennen, damit eine neue Anmeldung
  // einen frischen verbindet statt den getrennten weiterzureichen.
  function resetSlot(signedOut) {
    const s = slot();
    s.cache = new win.Object();
    s.context = '';
    s.remoteJson = '';
    s.remoteAt = 0;
    if (!signedOut) return;
    const p = s.player || player;
    if (p) { try { p.disconnect(); } catch (e) { /* egal */ } }
    s.player = null;
    s.deviceId = '';
    s.accountError = false;
    s.state = 'new'; // inject() erkennt ein schon geladenes SDK
  }

  // Bild passender Größe aus Spotifys images-Liste (absteigend sortiert)
  function artwork(images, size) {
    if (!Array.isArray(images) || !images.length) return '';
    let best = images[0];
    images.forEach(img => { if (img && img.width && img.width >= size && img.width < (best.width || Infinity)) best = img; });
    return (best && best.url) || '';
  }

  // ── Player in der Kachel (iOS-App: Hauptfenster nicht erreichbar) ──
  // Jeder verbundene SDK-Player ist bei Spotify ein Gerät; ohne Abmeldung bleibt er dort als Geist
  // („Symcon · iPhone“) stundenlang stehen (gemessen 13./14.10.2026). Deshalb: nur die älteste lebende
  // Ansicht (die normale Kachel, nicht die vergrößerte) legt den Player an, gleich beim Öffnen, damit Play
  // sofort geht; die anderen Ansichten steuern ihn über seine Geräte-ID. Abgemeldet wird er beim Verlassen
  // der Seite und wenn die App pausiert in den Hintergrund geht. Eine Sperre je Instanz verhindert, dass
  // zwei Ansichten gleichzeitig einen Player bauen.
  const TILE_ID = 'tile'; // Platzhalter in der Geräteauswahl, solange es den Player noch nicht gibt
  const TILE_LOCK = SLOT + '_tilePlayer';
  const VIEWS_KEY = SLOT + '_views';
  const HOST_KEY = SLOT + '_host';
  const SHARED_TTL = 90000;
  let lazyTile = false; // Player erst auf Wunsch (Kachelfenster ohne Hauptfenster)
  let releaseLock = null;
  const viewId = randomId();
  const startedAt = Date.now();
  // Geräte-ID des Players einer anderen Ansicht; sie bestätigt sie alle 2 s, sonst gilt sie als tot
  function sharedDevice() {
    try {
      const [id, at] = String(localStorage.getItem(TILE_LOCK) || '').split('|');
      return id && Date.now() - Number(at || 0) < SHARED_TTL ? id : '';
    } catch (e) { return ''; }
  }
  const forgetShared = () => { try { localStorage.removeItem(TILE_LOCK); } catch (e) { /* egal */ } };
  const ownDeviceId = () => slot().deviceId || (!player ? sharedDevice() : '');
  // Welche Ansichten dieser Instanz leben? Jede trägt sich alle 2 s ein. Die älteste (die normale Kachel,
  // nicht die später geöffnete vergrößerte) soll den Player halten: so läuft die Musik weiter, wenn die
  // vergrößerte Ansicht geschlossen wird.
  function views() {
    try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function heartbeat() {
    const now = Date.now();
    const all = views();
    Object.keys(all).forEach(k => { if (now - (all[k].seen || 0) > 15000) delete all[k]; });
    all[viewId] = { t: startedAt, seen: now };
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(all));
      if (player && slot().deviceId) localStorage.setItem(TILE_LOCK, slot().deviceId + '|' + now);
    } catch (e) { /* egal */ }
    hostIfAsked();
  }
  // Bitte einer anderen Ansicht (HOST_KEY) annehmen: über das storage-Ereignis und zur Sicherheit alle 2 s
  let hosting = null;
  function hostIfAsked() {
    if (!lazyTile || hosting) return;
    let to = '', at = 0;
    try { [to, at] = String(localStorage.getItem(HOST_KEY) || '').split('|'); } catch (e) { return; }
    if (to !== viewId || Date.now() - Number(at) > 30000) return;
    try { localStorage.removeItem(HOST_KEY); } catch (e) { /* egal */ }
    // Player schon da: nur die Geräte-ID gleich wieder bekanntgeben (die andere Ansicht hatte sie verworfen)
    hosting = ensureTilePlayer().catch(() => '').then(() => { hosting = null; });
  }
  // Lebt eine andere Ansicht wirklich? Die App entlädt die kleine Kachel beim Vergrößern und die vergrößerte
  // beim Schließen (gemessen 14.10.2026); ihr Eintrag bleibt bis 15 s stehen. Als lebend gilt nur, wer seit
  // unserem Start weitergezählt hat.
  const seenAtStart = {};
  function aliveOthers() {
    const all = views();
    return Object.keys(all).filter(k => k !== viewId && Date.now() - (all[k].seen || 0) < 4000 && (seenAtStart[k] === undefined || all[k].seen > seenAtStart[k]));
  }
  function oldestView() {
    const all = views();
    const t = k => (all[k] ? all[k].t : startedAt);
    return aliveOthers().concat([viewId]).sort((a, b) => t(a) - t(b))[0];
  }
  // Eine ältere Ansicht bitten, den Player anzulegen; die Antwort ist ihre Geräte-ID (sharedDevice)
  async function requestHost(to) {
    try { localStorage.setItem(HOST_KEY, to + '|' + Date.now()); } catch (e) { return ''; }
    for (let i = 0; i < 60 && !sharedDevice() && aliveOthers().indexOf(to) >= 0; i++) await sleep(200);
    return sharedDevice();
  }
  window.addEventListener('storage', ev => { if (ev.key === HOST_KEY && ev.newValue) hostIfAsked(); });
  async function adoptPlayer(p) {
    player = p;
    bindPlayer();
    try { local = await player.getCurrentState(); } catch (e) { local = null; }
    if (slot().accountError) premiumMissing = true;
  }
  async function waitDeviceId() {
    for (let i = 0; i < 100 && !slot().deviceId; i++) await sleep(100);
    return slot().deviceId;
  }
  // Spotify kennt ein neues Gerät erst ein paar Sekunden nach dem ready-Ereignis und antwortet bis dahin
  // mit 404: Befehle an ein frisch angelegtes Gerät so lange nachsetzen (höchstens 8 s)
  async function retry404(fn) {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); } catch (e) {
        if (attempt >= 11 || e.status !== 404) throw e;
        await sleep(700);
      }
    }
  }
  // Sperre holen und Player bauen; null, wenn eine andere Ansicht sie hält (dann wird deren Player ferngesteuert)
  function acquireTilePlayer() {
    if (!navigator.locks) return loadPlayer().then(p => p, () => null);
    return new Promise(resolve => {
      navigator.locks.request(TILE_LOCK, { ifAvailable: true }, lock => {
        if (!lock) { resolve(null); return null; }
        return new Promise(release => {
          releaseLock = release;
          loadPlayer().then(resolve, () => { resolve(null); release(); });
        });
      });
    });
  }
  // Geräte-ID des Players dieser Ansicht, bei Bedarf angelegt; sonst die einer anderen Ansicht; '' ohne Player
  let ensuring = null;
  function ensureTilePlayer() {
    if (!ensuring) ensuring = ensureTilePlayerNow().finally(() => { ensuring = null; });
    return ensuring;
  }
  async function ensureTilePlayerNow() {
    let id = !player ? sharedDevice() : '';
    let created = false;
    if (!id && !player) {
      const host = oldestView();
      if (host !== viewId) id = await requestHost(host);
    }
    if (!id && !player) {
      const p = await acquireTilePlayer();
      if (!p) {
        for (let i = 0; i < 50 && !sharedDevice(); i++) await sleep(100);
        id = sharedDevice();
      } else {
        await adoptPlayer(p);
        created = true;
        emit('state');
      }
    }
    if (player) { id = await waitDeviceId(); heartbeat(); }
    if (created) resumeHandover(id).catch(() => {});
    return id;
  }
  // Die älteste Ansicht legt den Player gleich an (Play soll sofort gehen); die anderen nutzen ihren
  function eagerTilePlayer() {
    if (!lazyTile || player || sharedDevice()) return;
    // Ob die anderen Ansichten noch leben, zeigt sich erst nach ein paar Sekunden: dann noch einmal prüfen
    if (!freshHandover() && oldestView() !== viewId) { setTimeout(eagerTilePlayer, 3000); return; }
    ensureTilePlayer().catch(() => {});
  }
  // Wiedergabe über das Entladen der Seite retten: Stand hinterlegen, die nächste Seite setzt ihn fort
  const HANDOVER_KEY = SLOT + '_handover';
  function freshHandover() {
    try {
      const note = JSON.parse(localStorage.getItem(HANDOVER_KEY) || 'null');
      return note && Date.now() - (note.at || 0) < 20000 ? note : null;
    } catch (e) { return null; }
  }
  function noteHandover() {
    if (!player || !local || local.paused || !local.track_window || !local.track_window.current_track) return;
    const t = local.track_window.current_track;
    try {
      localStorage.setItem(HANDOVER_KEY, JSON.stringify({ context: (local.context && local.context.uri) || '', uri: t.uri, position: local.position || 0, at: Date.now() }));
    } catch (e) { /* egal */ }
  }
  async function resumeHandover(id) {
    const note = freshHandover();
    try { localStorage.removeItem(HANDOVER_KEY); } catch (e) { /* egal */ }
    if (!note || !id || !/^spotify:track:[A-Za-z0-9]{22}$/.test(String(note.uri))) return;
    const body = /^spotify:(album|playlist):[A-Za-z0-9]{22}$/.test(String(note.context)) ? { context_uri: note.context, offset: { uri: note.uri } } : { uris: [note.uri] };
    body.position_ms = Math.max(0, Math.round((note.position || 0) + (Date.now() - note.at)));
    try { await retry404(() => call('PUT', '/v1/me/player/play', { device_id: id }, body)); } catch (e) { debug('Weiterspielen: ' + errText(e)); }
  }
  // Player dieser Ansicht abmelden: pausiert im Hintergrund (force=false) oder beim Verlassen der Seite
  function dropTilePlayer(force) {
    if (!player || !lazyTile) return;
    if (!force && local && !local.paused) return;
    for (let i = bound.length - 1; i >= 0; i--) {
      if (bound[i][0] === player) { try { player.removeListener(bound[i][1], bound[i][2]); } catch (e) { /* egal */ } bound.splice(i, 1); }
    }
    try { player.disconnect(); } catch (e) { /* egal */ }
    player = null;
    local = null;
    const s = slot();
    s.player = null;
    s.deviceId = '';
    s.state = 'new';
    forgetShared();
    if (releaseLock) { releaseLock(); releaseLock = null; }
    emit('state');
  }

  async function start() {
    if (cfg.mode !== 'player') { emit('ready'); return; }
    slot().token = web.token();
    // SDK-Player: im Hauptfenster gleich beim Laden (überlebt Kategoriewechsel), in der Kachel erst auf
    // Wunsch (siehe oben); ohne SDK nur Fernsteuerung
    if (host) {
      try {
        await adoptPlayer(await loadPlayer());
      } catch (e) {
        debug('sdk host: ' + errText(e));
        host = null;
        win = window;
      }
    }
    lazyTile = !host;
    if (lazyTile) {
      const all = views();
      Object.keys(all).forEach(k => { seenAtStart[k] = all[k].seen || 0; });
      heartbeat();
      setInterval(heartbeat, 2000);
      setInterval(hostIfAsked, 300);
      eagerTilePlayer();
    }
    // Chrome & Co. geben den Kopierschutz (Widevine) nur auf sicheren Seiten frei (https, localhost)
    if (!player && !window.isSecureContext && !/iPhone|iPad|iPod/.test(navigator.userAgent)) emit('notice', T('Playback needs a secure connection (https). Open the visualization via the Connect address.'));
    emit('ready');
    await poll();
    loadLastPlayed();
    schedulePoll(nextPoll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { schedulePoll(0); eagerTilePlayer(); return; }
      // Verdeckt eine andere Ansicht (vergrößerte Kachel) diese nur, läuft die App weiter: Player behalten.
      // Im Hintergrund schweigen auch die anderen Ansichten, dann abmelden (sofern pausiert).
      setTimeout(() => {
        if (document.visibilityState !== 'hidden') return;
        const all = views();
        if (!aliveOthers().length) dropTilePlayer(false);
      }, 2500);
    });
    // Die App entlädt die Seite beim Vergrößern und Schließen: Stand hinterlegen, die nächste Seite spielt weiter
    window.addEventListener('pagehide', () => { noteHandover(); dropTilePlayer(true); });
    report(true);
    // Lebenszeichen fürs Modul (es fragt dann selbst nicht ab): nur mit frischem Zustand, also sichtbar mit
    // gelungener eigener Abfrage oder mit spielendem SDK-Player (Ereignisse). Schlagen die Abfragen fehl
    // (429, gesperrt), schweigt die Kachel, und das Modul fragt wieder selbst.
    setInterval(() => { if ((document.visibilityState === 'visible' && Date.now() - pollOkAt < 75000) || local) report(true); }, 30000);
  }

  window.AMP = {
    cfg, T, start, run, api, apiAll, call, clearCache, login, logout, state, artwork, debug,
    devices: listDevices,
    onChange: fn => listeners.push(fn),
    notify: text => emit('notice', text),
    hasPlayer: () => !!player && !premiumMissing,
    sdkDevice: ownDeviceId,
    // Kann diese Kachel selbst abspielen (Player da oder auf Wunsch anlegbar)?
    canPlayHere: () => !!player || lazyTile,
    TILE_ID,
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
