const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('tsx/cjs');
const { createSelfHostApp } = require('./selfhost.ts');
const { JsonStore } = require('./store.ts');
const { LocalLibrary } = require('./local-library.ts');

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veedeeoh-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const staticRoot = path.join(dir, 'static');
  fs.mkdirSync(staticRoot);
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<html>Self-host app</html>');
  const providers = {
    getCatalog: async region => ({ rails: [{ name: region, items: [] }], stats: { totalTitles: 3 } }),
    archiveMovies: async () => [], getSeries: async (id, region) => [{ id, region }],
    plutoStream: async (path, region) => `${region}:${path}`,
  };
  const app = createSelfHostApp({ dataDir: dir, staticRoot, providers, ...options });
  const request = (url, body, method = body ? 'POST' : 'GET') => app.request('http://localhost' + url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { dir, staticRoot, app, providers, request };
}

test('known application paths survive refresh; missing assets and unknown routes stay 404', async t => {
  const h = fixture(t);
  for (const url of ['/', '/home', '/home/', '/settings', '/settings/playback', '/movies', '/shows', '/list', '/search?q=sample', '/search/space%20opera']) {
    const res = await h.request(url);
    assert.equal(res.status, 200, url); assert.match(await res.text(), /Self-host app/);
  }
  assert.equal((await h.request('/assets/missing.js')).status, 404);
  assert.equal((await h.request('/unknown')).status, 404);
  assert.equal((await h.request('/api/account')).status, 501);
  assert.equal((await h.request('/api/health')).status, 200);
});

test('catalogue, episodes and playback honor the requested region independently', async t => {
  const h = fixture(t);
  const res = await (await h.request('/api/vod?region=gb')).json();
  assert.equal(res.rails[0].name, 'GB'); assert.equal(res.stats.totalTitles, 3);
  assert.equal((await (await h.request('/api/vod?region=DE')).json()).rails[0].name, 'DE');
  assert.equal((await (await h.request('/api/vod/series/example?region=GB')).json()).episodes[0].region, 'GB');
  assert.equal((await (await h.request('/api/vod/pluto?path=/stitch/example&region=GB')).json()).url, 'GB:/stitch/example');
  assert.equal((await (await h.request('/api/vod?region=invalid')).json()).rails[0].name, 'US');
});

test('favorites, exact resume and watched status survive restart and remain per local profile', async t => {
  const h = fixture(t);
  await h.request('/api/favorites?profileId=default_main', { content_id: 'movie:1', title: 'A movie', poster: null });
  await h.request('/api/progress?profileId=default_main', { content_id: 'movie:1', title: 'A movie', position_secs: 127, duration_secs: 1000, stream_idx: 3, episode_title: 'Episode four' });
  await h.request('/api/watched?profileId=profile_kids', { contentId: 'episode:2', completed: true });
  const restarted = createSelfHostApp({ dataDir: h.dir, staticRoot: h.staticRoot, providers: h.providers });
  const get = async url => (await restarted.request('http://localhost' + url)).json();
  assert.equal((await get('/api/favorites')).favorites[0].content_id, 'movie:1');
  const row = (await get('/api/progress')).progress[0];
  assert.equal(row.position_secs, 127); assert.equal(row.stream_idx, 3); assert.equal(row.episode_title, 'Episode four');
  assert.equal((await get('/api/favorites?profileId=profile_kids')).favorites.length, 0);
  assert.equal((await get('/api/watched')).watched.length, 0);
  assert.equal((await get('/api/watched?profileId=profile_kids')).watched[0].content_id, 'episode:2');
  await h.request('/api/favorites/movie%3A1', null, 'DELETE');
  assert.equal((await (await h.request('/api/favorites')).json()).favorites.length, 0);
});

test('legacy JSON sets migrate without modifying the original files', t => {
  const h = fixture(t);
  fs.writeFileSync(path.join(h.dir, 'favorites.json'), '["old-favorite"]');
  fs.writeFileSync(path.join(h.dir, 'watched.json'), '["old-episode"]');
  const library = new LocalLibrary(h.dir);
  assert.equal(library.read().favorites[0].content_id, 'old-favorite');
  assert.equal(library.read().progress[0].completed, true);
  library.favorite(undefined, { content_id: 'new', title: null, poster: null });
  assert.equal(fs.readFileSync(path.join(h.dir, 'favorites.json'), 'utf8'), '["old-favorite"]');
  assert.equal(new LocalLibrary(h.dir).read().favorites.length, 2);
});

test('invalid updates are rejected and do not replace saved data', async t => {
  const h = fixture(t);
  for (const row of [{ content_id: 'x', position_secs: -1 }, { content_id: 'x', position_secs: 10, duration_secs: 'bad' }, { position_secs: 5 }]) {
    assert.equal((await h.request('/api/progress', row)).status, 400);
  }
  assert.equal((await h.request('/api/favorites?profileId=../../bad', { content_id: 'x' })).status, 400);
  assert.equal((await h.app.request('http://localhost/api/favorites', { method: 'POST', body: '{bad' })).status, 400);
  assert.equal(fs.existsSync(path.join(h.dir, 'library.json')), false);
});

test('a write failure returns an error and does not pretend the in-memory shelf was saved', async t => {
  const h = fixture(t);
  fs.mkdirSync(path.join(h.dir, 'library.json'));
  const response = await h.request('/api/favorites', { content_id: 'not-saved' });
  assert.equal(response.status, 500);
  assert.equal((await (await h.request('/api/favorites')).json()).favorites.length, 0);
});

test('atomic store keeps a recoverable previous snapshot and reports unrecoverable corruption', t => {
  const h = fixture(t), file = path.join(h.dir, 'sample.json');
  const store = new JsonStore(file, { saved: 0 });
  store.save({ saved: 1 }); store.save({ saved: 2 });
  assert.deepEqual(store.load(), { saved: 2 });
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(store.load(), { saved: 1 });
  store.save({ saved: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), { saved: 1 });
  assert.deepEqual(store.load(), { saved: 3 });
  fs.unlinkSync(file + '.bak'); fs.writeFileSync(file, '{broken');
  assert.throws(() => store.load(), /Could not read local data/);
});

test('media proxy forwards byte ranges, preserves 206 and streams without buffering', async t => {
  let sent;
  const h = fixture(t, { fetch: async (url, init) => {
    sent = init;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('part')); controller.close(); } }), {
      status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/100', 'Content-Length': '4', 'Accept-Ranges': 'bytes' },
    });
  } });
  const response = await h.app.request('http://localhost/proxy?url=https://example.com/movie.mp4', { headers: { Range: 'bytes=0-3' } });
  assert.equal(sent.headers.Range, 'bytes=0-3'); assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100'); assert.equal(await response.text(), 'part');
  assert.equal((await h.app.request('http://localhost/proxy', { method: 'OPTIONS' })).status, 204);
});

test('proxy HEAD, upstream failures and rewritten relative HLS URLs retain correct semantics', async t => {
  let mode = 'head', sent;
  const h = fixture(t, { fetch: async (url, init) => {
    sent = init;
    if (mode === 'head') return new Response(null, { headers: { 'Content-Length': '100', 'Accept-Ranges': 'bytes' } });
    if (mode === 'error') return new Response('range unavailable', { status: 416, headers: { 'Content-Range': 'bytes */100' } });
    return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  } });
  const head = await h.app.request('http://localhost/proxy?url=https://example.com/a.mp4', { method: 'HEAD' });
  assert.equal(sent.method, 'HEAD'); assert.equal(head.headers.get('content-length'), '100'); assert.equal(await head.text(), '');
  mode = 'error'; const error = await h.request('/proxy?url=https://example.com/a.mp4');
  assert.equal(error.status, 416); assert.equal(error.headers.get('content-range'), 'bytes */100');
  mode = 'playlist'; const text = await (await h.request('/proxy?url=https://example.com/path/a.m3u8')).text();
  assert.ok(text.includes(Buffer.from('https://example.com/path/key.bin').toString('hex')));
  assert.ok(text.includes(Buffer.from('https://example.com/path/segment.ts').toString('hex')));
});

test('a missing primary file recovers its backup instead of returning an empty library', t => {
  const h = fixture(t), file = path.join(h.dir, 'recover.json');
  fs.writeFileSync(file + '.bak', '{"saved":1}');
  assert.deepEqual(new JsonStore(file, { saved: 0 }).load(), { saved: 1 });
});

test('an unsupported local-library schema is reported without overwriting it', t => {
  const h = fixture(t), file = path.join(h.dir, 'library.json');
  const contents = '{"version":999,"profiles":{}}'; fs.writeFileSync(file, contents);
  assert.throws(() => new LocalLibrary(h.dir), /Unsupported local library format/);
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
});


test('compressed upstream encryption keys reach the browser with the decoded body length', async t => {
  const http = require('node:http'), { gzipSync } = require('node:zlib');
  const key = Buffer.alloc(16, 7), compressed = gzipSync(key);
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) });
    res.end(compressed);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const h = fixture(t);
  const response = await h.request('/proxy?url=' + encodeURIComponent(`http://127.0.0.1:${upstream.address().port}/key`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), key);
});
