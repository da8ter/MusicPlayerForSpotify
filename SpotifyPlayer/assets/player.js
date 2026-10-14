/* Musikplayer für Spotify – Player wie in den Musik-Apps: Mini-Player über den Reitern bzw. unten
   im Inhalt; ein Tipp öffnet „Läuft gerade“ mit großem Cover, Steuerung, Lautstärke, Geräteauswahl
   (Spotify Connect) und der Warteschlange. Breit steht die Warteschlange daneben. */
(function () {
  'use strict';
  const AMP = window.AMP;
  const ui = window.AMPUI;
  const { $, T, esc, fmt, notice } = ui;
  const svg = window.AMPIcons.svg;
  // Gefüllter Teil der eigenen Schieberegler (CSS: --fill)
  const setFill = el => el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
  const DEVICE_ICONS = { Computer: 'laptop', Smartphone: 'mobile', Tablet: 'tablet', Speaker: 'speaker', TV: 'tv', AVR: 'speaker', STB: 'tv', AudioDongle: 'speaker', GameConsole: 'gamepad', CastVideo: 'tv', CastAudio: 'speaker', Automobile: 'car', tile: 'house' };
  let seeking = false;
  let queueShown = false;

  // ── Name der Kachel als Spotify-Connect-Gerät: selbst vergeben (je Browser bzw. App gespeichert)
  // oder Instanzname plus Gerätetyp („Symcon · iPhone“); den echten Gerätenamen geben Browser nicht heraus ──
  const NAME_KEY = 'symconSpotifyDeviceName';
  const storedName = () => { try { return String(localStorage.getItem(NAME_KEY) || '').trim(); } catch (e) { return ''; } };
  function platform() {
    const ua = navigator.userAgent || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone|iPod/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux';
    return '';
  }
  async function autoName() {
    let kind = platform();
    // Android: Chrome und Edge nennen auf Nachfrage das Modell („Pixel 8“)
    if (kind === 'Android' && navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try { kind = (await navigator.userAgentData.getHighEntropyValues(['model'])).model || kind; } catch (e) { /* Typ genügt */ }
    }
    const base = AMP.cfg.playerName || 'Symcon';
    return kind ? base + ' · ' + kind : base;
  }
  async function deviceName() { return (storedName() || await autoName()).slice(0, 64); }

  // Spotify übernimmt den Namen nur beim Verbinden des Players, also beim nächsten Laden der Visualisierung
  async function renameDevice() {
    const sheet = $('sheet');
    sheet.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sheet-box';
    box.innerHTML = '<div class="sheet-title">' + esc(T('Name this device')) + '</div>';
    const form = document.createElement('div');
    form.className = 'sheet-new';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 64;
    input.value = storedName();
    input.placeholder = await autoName();
    form.appendChild(input);
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = T('Save');
    save.onclick = () => {
      try {
        if (input.value.trim()) localStorage.setItem(NAME_KEY, input.value.trim());
        else localStorage.removeItem(NAME_KEY);
        notice(T('The new name applies after reloading the visualization'));
      } catch (e) { notice(T('Could not save')); }
      sheet.hidden = true;
    };
    form.appendChild(save);
    box.appendChild(form);
    box.insertAdjacentHTML('beforeend', '<p class="empty">' + esc(T('Leave empty for the automatic name')) + '</p>');
    const cancel = document.createElement('button');
    cancel.className = 'sheet-item sheet-cancel';
    cancel.textContent = T('Cancel');
    cancel.onclick = () => { sheet.hidden = true; };
    box.appendChild(cancel);
    sheet.appendChild(box);
    if (window.AMPScroll) window.AMPScroll.bind(box);
    sheet.onclick = e => { if (e.target === sheet) sheet.hidden = true; };
    sheet.hidden = false;
    input.focus();
  }

  // ── Öffnen und Schließen ──
  function openPlayer() {
    $('np').classList.add('open');
    $('np').setAttribute('aria-hidden', 'false');
    renderQueue();
  }
  function closePlayer() {
    $('np').classList.remove('open');
    $('np').setAttribute('aria-hidden', 'true');
  }
  function showQueue(on) {
    queueShown = on;
    $('np').classList.toggle('show-queue', on);
    $('bQueue').classList.toggle('on', on);
    renderQueue();
  }

  // ── Gefällt mir (gespeicherter Titel) für den laufenden Titel ──
  let loveFor = '';
  let loved = false;
  function renderLove() {
    $('bLove').classList.toggle('on', loved);
    $('bLove').setAttribute('aria-pressed', loved ? 'true' : 'false');
  }
  function updateLove(id) {
    $('bLove').hidden = !id;
    $('bMore').hidden = !id;
    if (id === loveFor) return;
    loveFor = id;
    loved = false;
    renderLove();
    if (id) window.AMPActions.inLibrary({ type: 'track', id, uri: 'spotify:track:' + id }).then(value => { if (loveFor === id) { loved = value === true; renderLove(); } });
  }

  // ── Zustand zeichnen ──
  let coverShown = null;
  let lastState = AMP.state();
  function renderState() {
    const s = AMP.state();
    lastState = s;
    const item = s.item;
    const title = item ? item.name || '' : T('Nothing playing');
    const sub = item ? [item.artist, item.album].filter(Boolean).join(' · ') : '';
    $('title').textContent = title;
    $('subtitle').textContent = sub;
    $('miniTitle').textContent = title;
    $('miniSub').textContent = item ? item.artist || '' : '';
    // Ohne Titel kein Mini-Player (wie in der App)
    document.documentElement.classList.toggle('no-mini', !item);
    const art = AMP.artwork(item && item.images, 640);
    if (art !== coverShown) {
      coverShown = art;
      const css = art ? 'url("' + art.replace(/"/g, '%22') + '")' : '';
      $('cover').style.backgroundImage = css;
      $('npBackdrop').style.backgroundImage = css;
      $('miniCover').style.backgroundImage = art ? 'url("' + AMP.artwork(item.images, 96).replace(/"/g, '%22') + '")' : '';
      ui.coverColor(item && item.images).then(color => {
        if (coverShown !== art) return;
        if (color) document.documentElement.style.setProperty('--np-color', color);
        else document.documentElement.style.removeProperty('--np-color');
      });
    }
    const playIcon = svg(s.playing ? 'pause' : 'play');
    $('bPlay').innerHTML = playIcon;
    $('miniPlay').innerHTML = playIcon;
    $('bPlay').title = $('miniPlay').title = T(s.playing ? 'Pause' : 'Play');
    $('np').classList.toggle('playing', s.playing);
    // Lautstärke nur, wenn das Gerät eine meldet (iPhone und iPad lassen Webseiten nicht an die eigene)
    document.documentElement.classList.toggle('no-volume', s.volume === null);
    if (s.volume !== null && document.activeElement !== $('volume')) $('volume').value = s.volume;
    setFill($('volume'));
    // Geräteknopf mit dem üblichen Streaming-Symbol, daneben der Name des Geräts (eigene Kachel ohne Namen)
    $('deviceIcon').innerHTML = svg('stream');
    $('deviceName').textContent = s.deviceId && !s.local ? s.deviceName : '';
    $('bDevices').classList.toggle('on', !!s.deviceId && !s.local);
    // Seitenleiste: wo es gerade spielt (eigene Kachel als „Diese Kachel“)
    $('sideDevicesLabel').textContent = s.deviceId && !s.local ? s.deviceName : s.local ? T('This tile') : T('Devices');
    $('sideDevices').classList.toggle('on', !!s.deviceId && !s.local);
    $('topDevices').classList.toggle('on', !!s.deviceId && !s.local);
    $('topDevices').title = $('sideDevicesLabel').textContent;
    updateLove(item && item.type === 'track' ? item.id : '');
    renderTime();
  }

  // Fortschritt aus dem letzten Zustand plus verstrichener Zeit
  function renderTime() {
    if (seeking) return;
    const s = lastState;
    const position = Math.min(s.duration, s.position + (s.playing ? Date.now() - s.at : 0));
    $('tCur').textContent = fmt(position / 1000);
    $('tDur').textContent = '-' + fmt(Math.max(0, s.duration - position) / 1000);
    $('seek').value = s.duration ? Math.round(position / s.duration * 1000) : 0;
    setFill($('seek'));
  }

  // ── Warteschlange: „Als Nächstes“ mit Zufall und Wiederholen im Kopf (Spotify liefert sie nur lesend) ──
  let queueBusy = false;
  async function renderQueue() {
    const head = $('queueHead');
    const list = $('queueList');
    if (!$('np').classList.contains('open') || queueBusy || !ui.signedIn()) return;
    const s = AMP.state();
    head.innerHTML = '<b>' + esc(T('Up Next')) + '</b>';
    const shuffle = document.createElement('button');
    shuffle.className = 'queue-toggle' + (s.shuffle ? ' on' : '');
    shuffle.title = T('Shuffle');
    shuffle.innerHTML = svg('shuffle');
    shuffle.onclick = () => AMP.run('shuffle', { value: !AMP.state().shuffle });
    const repeat = document.createElement('button');
    repeat.className = 'queue-toggle' + (s.repeat !== 0 ? ' on' : '');
    repeat.title = T('Repeat');
    repeat.innerHTML = svg(s.repeat === 2 ? 'repeatOne' : 'repeat');
    // aus → alle → Titel → aus (Symcon-Werte 0, 1, 2)
    repeat.onclick = () => AMP.run('repeat', { value: (AMP.state().repeat + 1) % 3 });
    head.appendChild(shuffle);
    head.appendChild(repeat);
    queueBusy = true;
    try {
      const data = await AMP.call('GET', '/v1/me/player/queue');
      const scroll = list.scrollTop;
      list.innerHTML = '';
      const now = AMP.state();
      const nowId = now.item && now.repeat !== 2 ? now.item.id : '';
      ui.renderList((data.queue || []).filter(t => t && t.id && t.id !== nowId).map(t => ({
        name: t.name || '', sub: (t.artists || []).map(a => a.name).join(', '), art: ui.imagesOf(t),
        ref: { type: 'track', id: String(t.id), uri: t.uri, name: t.name || '' },
        onClick: e => { if (e.target instanceof Element && e.target.closest('.more')) window.AMPActions.menu({ type: 'track', id: String(t.id), uri: t.uri, name: t.name || '' }); },
      })), T('The queue is empty'), list);
      list.scrollTop = scroll;
    } catch (e) {
      list.innerHTML = '<p class="empty">' + esc(T('The queue is empty')) + '</p>';
    }
    queueBusy = false;
  }

  // ── Geräte (Spotify Connect): Liste mit Symbol, Tipp holt die Wiedergabe dorthin ──
  async function pickDevice() {
    const sheet = document.getElementById('sheet');
    const [devices, ghosts] = await Promise.all([AMP.devices(), AMP.ghosts()]);
    const sdk = AMP.sdkDevice();
    const current = AMP.state();
    sheet.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sheet-box';
    const head = document.createElement('div');
    head.className = 'sheet-title';
    head.textContent = T('Devices');
    box.appendChild(head);
    // Getrennte eigene Player (Geister) ausblenden, außer Spotify hält eins für aktiv
    const list = devices.filter(d => d && d.id && !d.is_restricted && (d.is_active || d.id === sdk || ghosts.indexOf(d.id) < 0));
    if (sdk && !list.some(d => d.id === sdk)) list.unshift({ id: sdk, name: T('This tile'), type: 'tile' });
    list.forEach(d => {
      const b = document.createElement('button');
      const active = d.is_active || d.id === current.deviceId;
      b.className = 'sheet-item device' + (active ? ' active' : '');
      b.innerHTML = svg(DEVICE_ICONS[d.type] || 'speaker') + '<span>' + esc(d.id === sdk ? T('This tile') : d.name) + (d.id === sdk && d.name && d.name !== T('This tile') ? '<small>' + esc(d.name) + '</small>' : '') + '</span>' + (active ? svg('check', 'check') : '');
      b.onclick = async () => {
        sheet.hidden = true;
        if (active) return;
        if (!(await AMP.run('transfer', { id: d.id, play: current.playing || !current.item }))) notice(T('Could not switch the device'));
        else notice(T('Playing on') + ' ' + (d.id === sdk ? T('This tile') : d.name));
      };
      box.appendChild(b);
    });
    if (!list.length) box.insertAdjacentHTML('beforeend', '<p class="empty">' + esc(T('No device available: open the tile in a browser or start Spotify on a device')) + '</p>');
    if (AMP.hasPlayer()) {
      const rename = document.createElement('button');
      rename.className = 'sheet-item';
      rename.textContent = T('Name this device') + ' …';
      rename.onclick = renameDevice;
      box.appendChild(rename);
    }
    const cancel = document.createElement('button');
    cancel.className = 'sheet-item sheet-cancel';
    cancel.textContent = T('Cancel');
    cancel.onclick = () => { sheet.hidden = true; };
    box.appendChild(cancel);
    sheet.appendChild(box);
    if (window.AMPScroll) window.AMPScroll.bind(box);
    sheet.onclick = e => { if (e.target === sheet) sheet.hidden = true; };
    sheet.hidden = false;
  }

  // ── Bedienung ──
  function bind() {
    $('bPrev').innerHTML = svg('previous');
    $('bNext').innerHTML = svg('next');
    $('miniNext').innerHTML = svg('next');
    $('volIcon').innerHTML = svg('volume');
    $('bLove').innerHTML = svg('heart');
    $('bMore').innerHTML = svg('more');
    $('bQueue').innerHTML = svg('queue');
    $('npClose').innerHTML = svg('down');
    $('bLove').title = T('Like');
    $('bQueue').title = T('Up Next');
    $('bDevices').title = T('Devices');
    $('npClose').title = T('Close');
    $('miniNext').title = T('Next');
    $('bLove').onclick = () => {
      const id = loveFor;
      if (!id) return;
      const next = !loved;
      loved = next;
      renderLove();
      window.AMPActions.setLibrary({ type: 'track', id, uri: 'spotify:track:' + id }, next).catch(() => {
        if (loveFor === id) { loved = !next; renderLove(); }
        notice(T('Could not save'));
      });
    };
    $('bMore').onclick = () => {
      const item = AMP.state().item;
      if (item && loveFor) window.AMPActions.menu({ type: 'track', id: loveFor, uri: item.uri, name: item.name || '' });
    };
    const toggle = () => AMP.run(AMP.state().playing ? 'pause' : 'play');
    $('bPlay').onclick = toggle;
    $('bPrev').onclick = () => AMP.run('previous');
    $('bNext').onclick = () => AMP.run('next');
    $('miniPlay').onclick = e => { e.stopPropagation(); toggle(); };
    $('miniNext').onclick = e => { e.stopPropagation(); AMP.run('next'); };
    $('mini').onclick = openPlayer;
    $('npClose').onclick = closePlayer;
    $('bQueue').onclick = () => showQueue(!queueShown);
    $('bDevices').onclick = pickDevice;
    $('sideDevices').insertAdjacentHTML('afterbegin', svg('stream', 'side-icon'));
    $('sideDevices').title = T('Devices');
    $('sideDevices').onclick = pickDevice;
    $('topDevices').innerHTML = svg('stream');
    $('topDevices').onclick = pickDevice;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('np').classList.contains('open') && $('sheet').hidden) closePlayer(); });
    // Titel und Interpret öffnen das Album des laufenden Titels
    ['title', 'subtitle'].forEach(id => { $(id).onclick = () => { closePlayer(); window.AMPDetails.openNowPlayingAlbum(); }; });
    // Beim Ziehen nur alle 150 ms setzen, sonst geht je Pixel ein Aufruf an Spotify
    let volumeTimer = 0;
    const applyVolume = () => { clearTimeout(volumeTimer); volumeTimer = 0; AMP.run('volume', { value: Number($('volume').value) }); };
    $('volume').oninput = () => { setFill($('volume')); if (!volumeTimer) volumeTimer = setTimeout(applyVolume, 150); };
    $('volume').onchange = applyVolume;
    $('seek').oninput = () => {
      seeking = true;
      setFill($('seek'));
      const duration = lastState.duration || 0;
      const at = Number($('seek').value) / 1000 * duration;
      $('tCur').textContent = fmt(at / 1000);
      $('tDur').textContent = '-' + fmt(Math.max(0, duration - at) / 1000);
    };
    $('seek').onchange = () => {
      seeking = false;
      const duration = lastState.duration || 0;
      if (duration) AMP.run('seek', { value: Number($('seek').value) / 1000 * duration });
    };
  }

  AMP.onChange(kind => {
    if (kind === 'state' || kind === 'ready') { renderState(); renderQueue(); }
  });
  setInterval(renderTime, 1000);

  bind();
  window.AMPPlayer = { open: openPlayer, close: closePlayer, deviceName };
})();
