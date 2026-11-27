/* Musikplayer für Spotify – Player ohne Kachel (nur mit der Browser-Erweiterung „Visu-Erweiterung für Symcon“).
   Die Erweiterung lädt dieses Skript bei jedem Laden der Visualisierung ins Hauptfenster. Es verbindet den
   SDK-Player gleich im selben Slot wie die Kachel (sdkhost.js): Der Browser steht damit als Spotify-Connect-
   Gerät bereit, auch wenn noch nie eine Player-Kachel angezeigt wurde. Eine später geöffnete Kachel übernimmt
   den Player. Befehle aus Symcon gehen über die Web API direkt an das Gerät; dieses Skript meldet nur das
   Lebenszeichen (sonst gilt der Player als Geist) und den Zustand, solange keine Kachel sichtbar ist.
   Optional der Mini-Player (mini.js), sobald die Seite mit der Kachel verlassen ist. */
(function () {
  'use strict';
  const C = /*SPM_AGENT*/null;
  const w = window;
  if (!C || w.top !== w) return;
  const FLAG = '__symconSpotifyAgent_' + C.instance;
  if (w[FLAG]) return; // doppelt geladen
  w[FLAG] = true;
  const SLOT = '__symconSpotifyPlayer_' + C.instance;
  const NAME_KEY = 'symconSpotifyDeviceName'; // derselbe Name wie in der Kachel (player.js), gleicher Ursprung
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const errText = e => (e && (e.reason || e.message || e.name)) || String(e);
  let ext = null, player = null, local = null, volume = 50, starting = null, mini = null;
  let token = C.accessToken || '', expiresAt = Number(C.expiresAt) || 0, lastReport = '';
  let shown = C.state || null; // zuletzt bekannter Zustand für den Mini-Player

  function slot() {
    let s = w[SLOT];
    if (!s) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      s = { state: 'new', error: '', deviceId: '', token: '', playerId: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
      w[SLOT] = s;
    }
    return s;
  }
  function send(ident, value) { if (ext) ext.send(C.instance, { a: ident, v: value }); }
  function tileVisible() { const s = w[SLOT]; return !!(s && s.tileAt && Date.now() - s.tileAt < 2500); }
  // Seite der Kachel aus einem früheren Laden der Visualisierung (core.js merkt sie sich), falls sie seither nicht offen war
  function storedPage() { try { return String(w.localStorage.getItem('symconSpotifyTilePage_' + C.instance) || ''); } catch (e) { return ''; } }
  function deviceName() {
    let stored = '';
    try { stored = String(w.localStorage.getItem(NAME_KEY) || '').trim(); } catch (e) { /* ohne Speicher */ }
    const base = C.playerName || 'Symcon';
    return Promise.resolve((stored || (ext && ext.device.name ? base + ' · ' + ext.device.name : base)).slice(0, 64));
  }

  const sdk = w.AMPSdkHost({
    win: () => w, slotName: SLOT, slot, token: () => token, deviceName, sleep, errText,
    on: (target, name, fn) => (target.addListener || target.addEventListener).call(target, name, fn),
  });

  // Zustand des eigenen SDK-Players im Format der Kachel (core.js state())
  function snapshot(st) {
    const track = st && st.track_window && st.track_window.current_track;
    if (!track) return null;
    const images = (track.album && track.album.images) || [];
    return {
      playing: !st.paused, title: track.name || '', artist: (track.artists || []).map(a => a.name).filter(Boolean).join(', '),
      album: (track.album && track.album.name) || '', cover: images[0] ? images[0].url : '', volume, shuffle: !!st.shuffle,
      repeat: Number(st.repeat_mode) || 0, device: slot().deviceName || '', deviceId: slot().deviceId || '', local: true,
    };
  }
  function report() {
    const state = snapshot(local);
    if (!state) return;
    if (mini) mini.update(state);
    if (tileVisible()) return; // eine sichtbare Kachel meldet selbst
    const json = JSON.stringify(state);
    if (json === lastReport) return;
    lastReport = json;
    send('State', json);
  }

  async function start() {
    if (player || starting || !token) return;
    starting = (async () => {
      // Abgelaufen (Visu lange offen, Token aus dem Skript): erst einen frischen holen
      if (expiresAt * 1000 - Date.now() < 60000) { send('RefreshToken', ''); for (let i = 0; i < 80 && expiresAt * 1000 - Date.now() < 60000; i++) await sleep(100); }
      try { player = await sdk.loadPlayer(); } catch (e) { player = null; return; }
      player.addListener('player_state_changed', st => {
        local = st || null;
        if (local) player.getVolume().then(v => { volume = Math.round(v * 100); }).catch(() => {});
        report();
      });
      player.addListener('authentication_error', () => send('RefreshToken', ''));
      for (let i = 0; i < 100 && !slot().deviceId; i++) await sleep(100);
      alive();
    })().finally(() => { starting = null; });
  }
  function alive() {
    const s = w[SLOT];
    if (s && s.state === 'ready' && s.deviceId) send('Player', s.deviceId);
  }
  // Abgemeldet: Player trennen, damit eine neue Anmeldung einen frischen verbindet
  function reset() {
    const s = slot();
    const p = s.player || player;
    if (p) { try { p.disconnect(); } catch (e) { /* egal */ } }
    s.player = null;
    s.deviceId = '';
    s.state = 'new';
    player = null;
    local = null;
    token = '';
  }

  function receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'token' && typeof msg.accessToken === 'string') {
      token = msg.accessToken;
      expiresAt = Number(msg.expiresAt) || 0;
      slot().token = token;
      start();
    } else if (msg.type === 'auth' && msg.signedIn === false) {
      reset();
    } else if (msg.type === 'state') {
      shown = msg;
      if (mini) mini.update(msg);
    }
  }

  if (C.mini && w.SymconMiniPlayer) {
    mini = w.SymconMiniPlayer({
      key: 'spotify.' + C.instance,
      texts: C.texts,
      tile: () => { const s = w[SLOT] || {}; return { at: s.tileAt || 0, page: s.tilePage || storedPage() }; },
      send: command => {
        const playing = !!(shown && shown.playing);
        send('Playback', command === 'previous' ? 0 : command === 'next' ? 4 : playing ? 3 : 2);
        if (command === 'toggle' && shown) shown = Object.assign({}, shown, { playing: !playing });
      },
    });
    if (shown) mini.update(shown);
  }

  (w.visuExtReady = w.visuExtReady || []).push(api => {
    ext = api;
    ext.on(C.instance, receive);
    ext.onState(on => { if (on) { alive(); start(); } });
    start();
  });
  setInterval(alive, 30000);
  w.addEventListener('pagehide', () => { const s = w[SLOT]; if (s && s.player) { try { s.player.disconnect(); } catch (e) { /* egal */ } } });
})();
