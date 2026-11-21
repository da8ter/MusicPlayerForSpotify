/* Musikplayer für Spotify – SDK-Player im Visu-Hauptfenster anlegen. Gemeinsam für die Kachel (core.js) und
   den Player ohne Kachel aus der Browser-Erweiterung (agent.js): beide legen ihn im selben Slot an, wer zuerst
   kommt, verbindet ihn, der andere übernimmt ihn.
     window.AMPSdkHost({ win, slotName, slot, token, deviceName, on, sleep, errText }) → { loadPlayer }
   win(): Player-Fenster; slot(): gemeinsamer Zustand; token(): aktueller Access-Token;
   deviceName(): Promise mit dem Namen als Spotify-Connect-Gerät; on(target, name, fn): Listener, die beim
   Verlassen der Seite wieder abgemeldet werden. */
(function () {
  'use strict';
  if (window.AMPSdkHost) return;
  const SDK_FLAG = '__symconSpotifySdk';
  const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

  window.AMPSdkHost = function (o) {
    const { slot, on, sleep, errText } = o;
    const SLOT = o.slotName;

    // spotify-player.js laden; der Bereit-Rückruf gehört dem Player-Fenster (keine Kachel-Funktion)
    function inject(s) {
      const win = o.win();
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
      const token = o.token();
      if (token) s.token = token;
      if (s.state === 'error') s.state = 'new';
      if (s.state === 'new') inject(s);
      for (let i = 0; i < 300; i++) {
        const win = o.win();
        if (s.state === 'ready') return s.player;
        // Wer den Player einrichtet, kann mitten im Verbinden verworfen werden (Kategoriewechsel): dann
        // läuft seine Fortsetzung nie. Nach 20 s übernimmt ein anderer und trennt den halben Player.
        if (s.state === 'configuring' && Date.now() - (s.configuringSince || 0) > 20000) {
          if (s.pending) { try { s.pending.disconnect(); } catch (e) { /* egal */ } s.pending = null; }
          s.state = 'loading';
        }
        if (s.state === 'error') throw new Error(s.error);
        if (s.state === 'loading' && win[SDK_FLAG] === 'ready' && win.Spotify && win.Spotify.Player) {
          s.state = 'configuring';
          const since = s.configuringSince = Date.now();
          // Von einem anderen übernommen (siehe oben): dieses Ergebnis verwerfen
          const superseded = () => s.state !== 'configuring' || s.configuringSince !== since;
          try {
            const options = new win.Object();
            options.name = await o.deviceName();
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

    return { loadPlayer };
  };
})();
