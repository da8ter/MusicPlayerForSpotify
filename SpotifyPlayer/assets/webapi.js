/* Musikplayer für Spotify – Access-Token, Web API und Zwischenspeicher. core.js erzeugt das Objekt mit
   window.AMPWebApi(ctx); ctx liefert Konfiguration, Texte, den Slot im Player-Fenster und Meldewege. */
(function () {
  'use strict';
  const API = 'https://api.spotify.com';
  // Spotify zählt Abrufe je App (gleitendes 30-s-Fenster); bei HTTP 429 pausieren alle Kacheln des Fensters
  const RATE_LIMIT_MIN = 30000;
  // Lesende Abfragen 5 Minuten vorhalten, höchstens so viele Einträge (Wandpanels laufen tagelang)
  const CACHE_TTL = 5 * 60 * 1000;
  const CACHE_MAX = 150;

  window.AMPWebApi = function (ctx) {
    const { cfg, T, slot, action, debug, emit } = ctx;
    let token = cfg.accessToken || '';
    let expiresAt = cfg.expiresAt || 0;

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

    // Nur eine bestehende Anmeldung kann ablaufen, und nur einmal je Seite melden.
    let expiredSent = false;
    function loginExpired() {
      if (expiredSent || cfg.mode !== 'player' || token) return;
      expiredSent = true;
      emit('error', T('Sign-in expired. Please sign in again.'));
    }

    function rateLimitError() {
      const e = new Error('HTTP 429');
      e.status = 429;
      return e;
    }
    async function call(method, path, query, body) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if ((slot().rateLimitUntil || 0) > Date.now()) throw rateLimitError();
        const t = await ensureToken();
        // Kein Token zu bekommen: die Anmeldung ist abgelaufen oder widerrufen (einmal je Seite melden)
        if (!t) { loginExpired(); const e = new Error(T('Not signed in to Spotify')); e.status = 401; throw e; }
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

    // Der Zwischenspeicher hängt am Slot des Player-Fensters und übersteht im Browser damit auch das
    // Neuladen der Kachel. Er hält nur Text (JSON) und Objekte des Player-Fensters, nie Objekte der Kachel:
    // die hielten sonst jede verworfene Kachel samt Dokument im Speicher fest.
    function cache() {
      const s = slot();
      if (!s.cache) s.cache = new (ctx.win().Object)();
      return s.cache;
    }
    function clearCache(prefix) {
      const c = cache();
      // Folgeseiten liegen unter Spotifys absoluter next-Adresse: für den Vergleich ohne API-Präfix
      Object.keys(c).forEach(key => {
        const path = key.indexOf(API) === 0 ? key.slice(API.length) : key;
        if (!prefix || path.indexOf(prefix) === 0) delete c[key];
      });
    }
    // Abgelaufene Einträge verwerfen; sind es dann noch zu viele, die ältesten
    function pruneCache(c) {
      const now = Date.now();
      const keys = Object.keys(c);
      keys.forEach(key => { if (now - c[key].time >= CACHE_TTL) delete c[key]; });
      const left = Object.keys(c);
      if (left.length < CACHE_MAX) return;
      left.sort((a, b) => c[a].time - c[b].time).slice(0, left.length - CACHE_MAX + 1).forEach(key => { delete c[key]; });
    }
    async function api(path, params) {
      const key = path + '?' + JSON.stringify(params || {});
      const hit = cache()[key];
      if (hit && Date.now() - hit.time < CACHE_TTL) return JSON.parse(hit.json);
      const data = await call('GET', path, params);
      const c = cache();
      pruneCache(c);
      const entry = new (ctx.win().Object)();
      entry.time = Date.now();
      entry.json = JSON.stringify(data);
      c[key] = entry;
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

    return {
      call, api, apiAll, clearCache, requestToken, setToken,
      token: () => token,
      dropToken: () => { token = ''; },
    };
  };
})();
