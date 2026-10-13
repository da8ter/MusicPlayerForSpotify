// Prüfstand für assets/webapi.js (ohne Browser): node tests/webapi_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } console.log('PASS: ' + name); };

global.window = {};
let calls = [];
let reply = () => ({ status: 200, body: { items: [1] } });
global.fetch = async (url, opts) => {
  calls.push({ url, method: opts.method });
  const r = reply(url);
  return { status: r.status, ok: r.status < 300, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
};
eval(fs.readFileSync(path.join(__dirname, '../SpotifyPlayer/assets/webapi.js'), 'utf8'));

const host = { Object };
const theSlot = {};
const web = window.AMPWebApi({
  cfg: { accessToken: 'tok', expiresAt: Date.now() / 1000 + 3600, mode: 'player' },
  T: k => k, slot: () => theSlot, win: () => host, action: () => {}, debug: () => {}, emit: () => {},
});

(async () => {
  const a = await web.api('/v1/me/playlists', { limit: 50 });
  const b = await web.api('/v1/me/playlists', { limit: 50 });
  assert(calls.length === 1 && a.items[0] === 1 && b.items[0] === 1, 'Zweiter Abruf kommt aus dem Zwischenspeicher');
  assert(a !== b, 'Treffer liefern eigene Objekte (gespeichert ist nur Text)');
  const entry = theSlot.cache['/v1/me/playlists?{"limit":50}'];
  assert(typeof entry.json === 'string' && entry.data === undefined, 'Zwischenspeicher hält nur JSON-Text, keine Objekte der Kachel');

  await web.api('https://api.spotify.com/v1/me/playlists?offset=50&limit=50');
  web.clearCache('/v1/me/');
  assert(Object.keys(theSlot.cache).length === 0, 'clearCache trifft auch Folgeseiten mit absoluter next-Adresse');

  for (let i = 0; i < 200; i++) await web.api('/v1/search', { q: 'x' + i });
  assert(Object.keys(theSlot.cache).length <= 150, 'Zwischenspeicher bleibt bei höchstens 150 Einträgen');
  theSlot.cache['/old?{}'] = { time: Date.now() - 6 * 60 * 1000, json: '{}' };
  await web.api('/v1/search', { q: 'neu' });
  assert(!theSlot.cache['/old?{}'], 'Abgelaufene Einträge werden beim Einfügen verworfen');

  calls = [];
  reply = () => ({ status: 429, body: {} });
  let status = 0;
  try { await web.call('GET', '/v1/me/player'); } catch (e) { status = e.status; }
  assert(status === 429 && theSlot.rateLimitUntil > Date.now() + 25000, 'HTTP 429: Pause mindestens 30 s im Slot');
  try { await web.call('GET', '/v1/me/player'); } catch (e) { status = e.status; }
  assert(calls.length === 1, 'Während der Pause keine weiteren Abrufe');
  console.log('All tests passed');
})();
