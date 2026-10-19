const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function moduleApi(file, context) {
  const source = fs.readFileSync(`${__dirname}/../src/${file}.ts`, 'utf8');
  const ctx = { exports: {}, console, encodeURIComponent, ...context };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx.exports;
}

test('local database adapter saves favorites and exact episode progress without initializing Supabase', async () => {
  const calls = [];
  const db = moduleApi('db', {
    require(name) { assert.equal(name, './auth'); return { isCloudMode: () => false, getSupabase() { throw Error('Cloud must not initialize'); } }; },
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true, json: async () => ({ favorites: [{ content_id: 'saved' }], progress: [{ content_id: 'playing', position_secs: 84 }] }) }; },
  });
  await db.addFavorite('default_main', { content_id: 'saved', title: 'Saved' });
  assert.equal(calls[0].url, '/api/favorites?profileId=default_main');
  assert.equal((await db.listFavorites('default_main'))[0].content_id, 'saved');
  await db.saveProgress('profile_local', { content_id: 'playing', position_secs: 84, duration_secs: 900, stream_idx: 2 });
  assert.equal(JSON.parse(calls.at(-1).body).stream_idx, 2);
  assert.equal((await db.getWatchHistory('profile_local'))[0].position_secs, 84);
  await db.removeFavorite('profile_local', 'tubi:123');
  assert.equal(calls.at(-1).url, '/api/favorites/tubi%3A123?profileId=profile_local');
});

test('local write failures propagate so the interface can report unsaved data', async () => {
  const db = moduleApi('db', { require: () => ({ isCloudMode: () => false }), fetch: async () => ({ ok: false }) });
  await assert.rejects(db.addFavorite('default_main', { content_id: 'x' }), /Could not save or load/);
  await assert.rejects(db.saveProgress('default_main', { content_id: 'x', position_secs: 5 }), /Could not save or load/);
});

test('local watched actions use local profile IDs and failed writes restore the prior state', async () => {
  let fail = false;
  const calls = [], state = { watched: new Set() };
  const api = moduleApi('api', {
    require(name) {
      if (name === './auth') return { isCloudMode: () => false, getSession: () => null };
      if (name === './profiles') return { getActiveProfile: () => ({ id: 'default_main' }) };
      if (name === './state') return { state };
      throw Error(name);
    },
    Headers,
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: !fail, json: async () => ({ watched: [{ content_id: 'episode', completed: true }] }) }; },
  });
  assert.deepEqual(Array.from(await api.fetchWatched()), ['episode']);
  await api.toggleWatched('episode', true);
  assert.equal(calls.at(-1).url, '/api/watched?profileId=default_main');
  fail = true;
  await assert.rejects(api.toggleWatched('episode', false), /Could not save watched/);
  assert.equal(state.watched.has('episode'), true);
});

test('creating another local profile keeps Main Profile and its saved-library identity', async () => {
  const file = `${__dirname}/../src/profiles.ts`;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const method = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createProfileEverywhere').getText(source);
  let profiles = [{ id: 'default_main', name: 'Main Profile' }];
  const context = { exports: {}, Date, isCloudMode: () => false, cloudEnabled: () => false,
    getStoredProfiles: () => profiles, saveProfiles: value => { profiles = value; } };
  vm.runInNewContext(ts.transpileModule(method, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  await context.exports.createProfileEverywhere({ name: 'Second', avatar_color: '#abc' });
  assert.equal(profiles.length, 2); assert.equal(profiles[0].id, 'default_main');
});

test('first profile selection preserves a bookmarked list instead of painting Home over it', async () => {
  const file = `${__dirname}/../src/main.ts`;
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const method = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'enterAsProfile').getText(source);
  let rendered = 0, routed = 0, callback;
  const context = { exports: {}, applyProfileChrome() {}, isCloudMode: () => false,
    refreshLocalLibrary: async () => {}, showToast() {}, playIdent(_kids, done) { callback = done(); },
    routeFromPath: () => 'favorites', applyingRoute: false, applyRoute: async () => { routed++; },
    goHome() { throw Error('Must preserve the bookmarked destination'); },
    require: () => ({ getVodRails: async () => [], renderHome: () => { rendered++; } }) };
  vm.runInNewContext(ts.transpileModule(method + '\nexports.enterAsProfile=enterAsProfile;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.exports.enterAsProfile({}, Promise.resolve(), true); await callback;
  assert.equal(routed, 1); assert.equal(rendered, 0);
});


test('Pluto playback resolution uses the selected catalogue region', async () => {
  let requested;
  const api = moduleApi('api', {
    require(name) {
      if (name === './auth') return { isCloudMode: () => false, getSession: () => null };
      if (name === './profiles') return { getActiveProfile: () => ({ id: 'default_main' }) };
      if (name === './state') return { state: {} };
      throw Error(name);
    },
    Headers, localStorage: { getItem: () => 'UK' },
    fetch: async url => { requested = url; return { ok: true, json: async () => ({ url: 'stream' }) }; },
  });
  assert.equal(await api.fetchPlutoStream('/stitch/movie'), 'stream');
  assert.equal(new URL(requested, 'http://localhost').searchParams.get('region'), 'UK');
});
