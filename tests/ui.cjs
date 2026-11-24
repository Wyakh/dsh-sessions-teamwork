'use strict';
// Pure controller/catalog/native adapters + actual lazy loader VM branch. No React/DOM emulation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const sourcePath = path.join(require('./paths.cjs').root, 'client.cjs'), source = fs.readFileSync(sourcePath, 'utf8');
const ui = require(sourcePath)(name => { throw Error('Pure factory must not import UI: ' + name); });
const results = { patch: 10, area: 'v0.5.2-reused-v0.5.1-client', tests: [], browserRendered: false, domEmulated: false, profileLoaded: false, installationAttempted: false, actualHostTestedHere: false };
async function test(name, body) { try { const evidence = await body(); results.tests.push({ name, status: 'passed', evidence: evidence ?? {} }); console.log('PASS ' + name); } catch (error) { results.tests.push({ name, status: 'failed', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); } }
const view = (revision = 0, reviewRequired = false, generation = 1) => ({ state: { schemaVersion: 6, revision, generation, reviewRequired, sessions: [], teams: [], reports: [], proposals: [], comments: [], attention: [], messages: [], alerts: [], wakeups: [], dispatches: [], nextSequence: 1 }, reviewToken: String(revision % 10).repeat(64) });
const draft = () => ({ teamId: 'team-native', title: 'Research', description: 'Independent native Sessions coordinate research.', managerId: 'native-manager', memberIds: ['native-worker'] });
const cmd = () => ui.prepareCommand('save-team', draft());
const error = code => Object.assign(new Error(code), { code });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const sessionList = (values, extra = {}) => ({ ids: values.map(value => value.id), byId: Object.fromEntries(values.map(value => [value.id, value])), phase: 'ready', projectionsBySession: {}, ...extra });
const workspaces = (items = [], extra = {}) => ({ items, archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', ...extra });
function navigationHarness(options = {}) {
  let mountedId = options.mountedId, next = 0;
  const observers = new Set(), frames = new Map(), timers = new Map(), trace = [];
  const mount = sessionId => { mountedId = sessionId; for (const observer of [...observers]) observer(); };
  const native = {
    mounted: { getSnapshot: () => mountedId, subscribe(listener) { trace.push('subscribe'); observers.add(listener); return () => { trace.push('unsubscribe'); observers.delete(listener); }; } },
    openSession(sessionId) { trace.push(['openSession', sessionId]); if (options.openSessionError) throw options.openSessionError; if (options.mount !== false) mount(sessionId); },
    openResource(address, params) { trace.push(['openResource', address, params]); if (options.openResourceError) throw options.openResourceError; },
    openTab(name) { trace.push(['openTab', name]); }, returnToPanel() { trace.push('returnToPanel'); }
  };
  const scheduler = { requestFrame(callback) { const id = ++next; frames.set(id, callback); return id; }, cancelFrame(id) { frames.delete(id); }, setTimer(callback) { const id = ++next; timers.set(id, callback); return id; }, clearTimer(id) { timers.delete(id); } };
  return { navigator: ui.createResourceNavigator(native, scheduler), trace, frames, timers, observers, mount,
    flushFrames() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    timeout() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); } };
}
(async () => {
  await test('Node exports are lazy, pure, and use only the declared native Client injections', () => {
    for (const name of ['createController', 'createTransport', 'buildCatalog', 'prepareCommand', 'verifyView', 'apply']) assert.equal(typeof ui[name], 'function');
    assert.deepEqual(ui.inject, ['slots', 'locale', 'connection', 'layout', 'uiWorkspace', 'sidebarRight']); assert.equal(globalThis.window, undefined);
  });
  await test('Browser ModuleLoader branch registers exact package factory without importing React or emulating DOM', () => {
    let registration; vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value; } } } }, { timeout: 1000 });
    assert.equal(registration.id, '@local/session-coordination');
    const definition = registration.factory(() => { throw Error('No eager React imports'); });
    assert.equal(typeof definition.apply, 'function'); assert.deepEqual(Array.from(definition.inject), ui.inject);
    return { factoryEvaluated: true, renderingAttempted: false };
  });
  await test('Transport uses exact sessionTeams authenticated named-args RPC and signal', async () => {
    const calls = [], signal = new AbortController().signal;
    const call = ui.createTransport({ rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: view() }; } } });
    assert.deepEqual(await call('inspect', { query: { type: 'snapshot' } }, signal), view());
    assert.deepEqual(calls[0], ['/api', 'sessionTeams/inspect', { args: { query: { type: 'snapshot' } } }, signal]);
    await assert.rejects(call('revalidate', {}), e => e.code === 'INPUT_INVALID'); assert.equal(calls.length, 1);
  });
  await test('Transport distinguishes explicit Remote error, carrier failure and malformed response', async () => {
    for (const [response, code] of [[{ ok: false, error: { code: 'OWNER_REQUIRED', message: 'Owner required' } }, 'OWNER_REQUIRED'], [{ value: view() }, 'INVALID_RESPONSE']]) {
      const call = ui.createTransport({ rpc: { call: async () => response } }); await assert.rejects(call('inspect', {}), e => e.code === code);
    }
    const call = ui.createTransport({ rpc: { call: async () => { throw error('CARRIER_FAILURE'); } } }); await assert.rejects(call('inspect', {}), e => e.code === 'CARRIER_FAILURE');
  });
  await test('Catalog enumerates ids only; workspace membership, not cwd, determines grouping', () => {
    const sessions = sessionList([{ id: 'a', displayTitle: 'Alpha', cwd: 'C:/same' }, { id: 'b', displayTitle: 'Beta', cwd: 'C:/same' }, { id: 'c', title: 'Gamma', cwd: 'C:/other' }]);
    sessions.byId.retained = { id: 'retained', title: 'Not in global list' };
    const catalog = ui.buildCatalog(sessions, workspaces([{ workspaceId: 'ws', title: 'Native workspace', path: 'C:/other', sessionIds: ['b'] }]));
    assert.deepEqual(catalog.groups.map(group => [group.id, group.entries.map(entry => entry.id)]), [['ws', ['b']], ['__ungrouped', ['a', 'c']]]);
    assert.equal(catalog.byId.has('retained'), false); assert.equal(catalog.byId.get('a').title, 'Alpha'); assert.equal(catalog.ready, true);
    assert.equal(ui.buildCatalog({ ids: ['constructor'], byId: {}, phase: 'ready' }, workspaces()).byId.has('constructor'), false);
  });
  await test('Catalog excludes archived, subagents, and migration-required from new choices but retains saved roster', () => {
    const list = sessionList([{ id: 'ok', displayTitle: 'OK' }, { id: 'arch', title: 'Archived' }, { id: 'child', title: 'Child', origin: 'subagent' }, { id: 'old', title: 'Old', formatStatus: 'migration-required' }]);
    const ws = workspaces([], { archivedSessionIds: ['arch'] });
    const fresh = ui.buildCatalog(list, ws); assert.deepEqual(fresh.groups.flatMap(group => group.entries.map(entry => entry.id)), ['ok']);
    const retained = ui.buildCatalog(list, ws, ['arch', 'child', 'old', 'missing']);
    assert.deepEqual(retained.groups.flatMap(group => group.entries.map(entry => entry.id)), ['ok', 'arch', 'child', 'old', 'missing']);
    assert.equal(retained.byId.get('arch').reason, 'archived'); assert.equal(retained.byId.get('child').reason, 'subagent'); assert.equal(retained.byId.get('old').reason, 'incompatible'); assert.equal(retained.byId.get('missing').reason, 'missing');
  });
  await test('Pending empty native lists are not a confirmed empty roster; saved selections stay visible', () => {
    const catalog = ui.buildCatalog(sessionList([], { phase: 'pending' }), workspaces([], { phase: 'pending', state: 'loading' }), ['saved-manager']);
    assert.equal(catalog.ready, false); assert.equal(catalog.byId.get('saved-manager').reason, 'pending'); assert.equal(catalog.groups[0].entries[0].id, 'saved-manager');
    assert.equal(ui.buildCatalog(sessionList([]), workspaces([], { state: 'error' })).ready, false);
  });
  await test('Duplicate native human labels receive automatic collision-free short-id suffixes', () => {
    const catalog = ui.buildCatalog(sessionList([{ id: 'first-abcdef', title: 'Same' }, { id: 'other-abcdef', title: 'Same' }, { id: 'third-unique', title: 'Different' }]), workspaces());
    const labels = catalog.entries.map(entry => entry.label); assert.equal(new Set(labels).size, 3); assert(labels[0].startsWith('Same · ')); assert.equal(labels[2], 'Different');
    return { disambiguated: labels };
  });
  await test('Snapshot validation rejects malformed data instead of fabricating a usable empty state', async () => {
    const malformed = [null, {}, { state: {} }, { ...view(), reviewToken: 'no' }, { state: { ...view().state, reports: null }, reviewToken: '0'.repeat(64) }, { state: { ...view().state, teams: [{ id: 'broken' }] }, reviewToken: '0'.repeat(64) }, { state: { ...view().state, reports: [null] }, reviewToken: '0'.repeat(64) }, { state: { ...view().state, reports: [{ id: 'report', teamId: 'team', authorId: 'author', versions: {} }] }, reviewToken: '0'.repeat(64) }];
    for (const input of malformed) { const model = ui.createController(async () => input); assert.equal(await model.load(), false); assert.equal(model.getSnapshot().view, null); assert.equal(model.getSnapshot().fresh, false); assert.equal(model.getSnapshot().error.phase, 'read'); model.dispose(); }
    const wire = view(3, true), clean = ui.verifyView(wire); wire.state.revision = 99; assert.equal(clean.state.revision, 3); assert(Object.isFrozen(clean.state));
  });
  await test('Setup builders have no scopes, grants, identity or owner-claims; one manager and distinct members', () => {
    assert.deepEqual(cmd(), { type: 'save-team', ...draft() });
    assert.deepEqual(ui.prepareCommand('retire-team', { teamId: 'opaque-saved-team', owner: true }), { type: 'retire-team', teamId: 'opaque-saved-team' });
    for (const invalid of [{ ...draft(), memberIds: ['native-manager'] }, { ...draft(), memberIds: ['same', 'same'] }, { ...draft(), managerId: '' }, { ...draft(), title: '' }, { ...draft(), description: 'two\nlines' }, { ...draft(), title: 'two\nlines' }, { ...draft(), teamId: '../path' }]) assert.throws(() => ui.prepareCommand('save-team', invalid), e => e.code === 'INPUT_INVALID');
    assert.throws(() => ui.prepareCommand('identity', {}), e => e.code === 'INPUT_INVALID');
  });
  await test('Staging is immutable, sends no write, and binds exact full-snapshot revision/generation/token', async () => {
    const calls = [], model = ui.createController(async (method, args) => { calls.push({ method, args }); return method === 'inspect' ? view(7, true, 3) : { revision: 8, generation: 3 }; });
    await model.load(); const command = cmd(); command.expectedRevision = 99; assert(model.stage(command)); command.memberIds.push('later'); command.title = 'Later';
    const staged = model.getSnapshot().pending; assert.equal(calls.length, 1); assert.equal(staged.command.title, 'Research'); assert.deepEqual(staged.command.memberIds, ['native-worker']); assert.equal(staged.command.expectedRevision, 7);
    assert.deepEqual(staged.precondition, ui.reviewOf(view(7, true, 3))); assert(Object.isFrozen(staged.command.memberIds)); assert.throws(() => { staged.command.title = 'Tampered'; }, TypeError);
    assert(await model.apply()); assert.deepEqual(calls.map(call => call.method), ['inspect', 'administer', 'inspect']); assert.deepEqual(calls[1].args, staged); model.dispose();
  });
  await test('Freshness is required and refresh/cancel clear previews and startup acknowledgment', async () => {
    const model = ui.createController(async () => view(0, true)); assert.equal(model.stage(cmd()), false); await model.load(); model.acknowledge(true); assert.equal(model.getSnapshot().acknowledged, true);
    model.stage(cmd()); assert.equal(model.getSnapshot().acknowledged, false); model.cancelStage(); assert.equal(model.getSnapshot().pending, null);
    model.acknowledge(true); await model.load(); assert.equal(model.getSnapshot().acknowledged, false); assert.equal(model.getSnapshot().pending, null); model.dispose();
  });
  await test('Busy exclusion is synchronous across refresh/stage/review/apply without clobbering state', async () => {
    const hold = deferred(), calls = [], model = ui.createController(async method => { calls.push(method); return method === 'inspect' ? view() : hold.promise; });
    await model.load(); model.stage(cmd()); const writing = model.apply(); assert.equal(await model.apply(), false); assert.equal(await model.load(), false); assert.equal(model.stage(cmd()), false); assert.equal(model.confirm(), false); assert.equal(model.getSnapshot().error, null); assert.equal(model.getSnapshot().fresh, false);
    hold.resolve({ revision: 1, version: 1 }); assert(await writing); assert.deepEqual(calls, ['inspect', 'administer', 'inspect']); model.dispose();
  });
  await test('Startup review is unchecked and requires exact explicit checkbox plus staged preview before any write', async () => {
    const calls = [], model = ui.createController(async (method, args) => { calls.push({ method, args }); return method === 'inspect' ? view(5, true, 8) : { revision: 6, generation: 8 }; });
    await model.load(); assert.equal(model.getSnapshot().acknowledged, false); assert.equal(model.confirm(), false); model.acknowledge(true); assert(model.confirm()); assert.equal(calls.length, 1);
    assert.deepEqual(model.getSnapshot().pending, { command: { type: 'review-startup', expectedRevision: 5, expectedGeneration: 8, reviewToken: '5'.repeat(64) }, precondition: ui.reviewOf(view(5, true, 8)) });
    assert.equal(model.getSnapshot().acknowledged, false); assert(await model.apply()); assert.equal(model.getSnapshot().notice, 'reviewCommitted'); assert.equal(calls.length, 3); model.dispose();
  });
  await test('Setup remains available during hold but does not automatically release or acknowledge it', async () => {
    const calls = [], model = ui.createController(async (method, args) => { calls.push({ method, args }); return method === 'inspect' ? view(1, true) : { revision: 2 }; });
    await model.load(); assert(model.stage(cmd())); model.acknowledge(true); assert.equal(model.getSnapshot().acknowledged, false); assert.equal(model.confirm(), false);
    assert.equal(calls.length, 1); assert.equal(model.getSnapshot().view.state.reviewRequired, true); model.dispose();
  });
  await test('Rejected mutation becomes stale with no automatic read/retry/rebase', async () => {
    const calls = [], model = ui.createController(async method => { calls.push(method); if (method === 'inspect') return view(2); throw error('REVISION_CONFLICT'); });
    await model.load(); model.stage(cmd()); assert.equal(await model.apply(), false); assert.equal(model.getSnapshot().error.phase, 'mutation'); assert.equal(model.getSnapshot().fresh, false); assert.equal(model.getSnapshot().pending, null); assert.equal(await model.apply(), false); assert.deepEqual(calls, ['inspect', 'administer']); model.dispose();
  });
  await test('Acknowledged success survives failed follow-up read and later reset without contradictory unknown outcome', async () => {
    let reads = 0; const calls = [], model = ui.createController(async method => { calls.push(method); if (method === 'inspect') { if (reads++) throw error('READ_DOWN'); return view(); } return { revision: 1 }; });
    await model.load(); model.stage(cmd()); assert.equal(await model.apply(), false); assert.equal(model.getSnapshot().notice, 'ownerCommitted'); assert.equal(model.getSnapshot().error.phase, 'postCommit'); assert.equal(model.getSnapshot().fresh, false);
    model.invalidate(); assert.equal(model.getSnapshot().notice, 'ownerCommitted'); assert.deepEqual(calls, ['inspect', 'administer', 'inspect']); model.dispose();
  });
  await test('Reset aborts/discards late old-generation read while new generation can load', async () => {
    const late = deferred(); let calls = 0, oldSignal; const model = ui.createController(async (_method, _args, signal) => { if (!calls++) { oldSignal = signal; return late.promise; } return view(9, true, 4); });
    const pending = model.load(); model.invalidate(); assert.equal(oldSignal.aborted, true); assert(await model.load()); late.resolve(view(1, false, 1)); assert.equal(await pending, false); assert.equal(model.getSnapshot().view.state.generation, 4); assert.equal(model.getSnapshot().view.state.revision, 9); model.dispose();
  });
  await test('Reset during write is uncertain; reset during acknowledged follow-up is postCommit success', async () => {
    const write = deferred(), model = ui.createController(async method => method === 'inspect' ? view() : write.promise); await model.load(); model.stage(cmd()); const pending = model.apply(); model.invalidate(); assert.equal(model.getSnapshot().error.phase, 'mutation'); write.resolve({ revision: 1 }); assert.equal(await pending, false); model.dispose();
    const read = deferred(); let reads = 0; const model2 = ui.createController(async method => method !== 'inspect' ? { revision: 1 } : reads++ ? read.promise : view());
    await model2.load(); model2.stage(cmd()); const pending2 = model2.apply(); await turn(); model2.invalidate(); assert.equal(model2.getSnapshot().error.phase, 'postCommit'); assert.equal(model2.getSnapshot().notice, 'ownerCommitted'); read.resolve(view(1)); assert.equal(await pending2, false); model2.dispose();
  });
  await test('Dispose aborts pending operation and prevents late publication/listener leaks', async () => {
    const late = deferred(); let signal, notifications = 0; const model = ui.createController(async (_method, _args, value) => { signal = value; return late.promise; }); model.subscribe(() => notifications++);
    const pending = model.load(), count = notifications; model.dispose(); assert(signal.aborted); late.resolve(view()); assert.equal(await pending, false); assert.equal(notifications, count); assert.equal(await model.load(), false); assert.equal(model.stage(cmd()), false);
  });
  await test('Latest report follows newest corrected version, with collision-safe native anchors', () => {
    const oldCorrected = { id: 'old', versions: [{ at: '2026-01-01' }, { at: '2026-03-01' }] }, laterCreated = { id: 'new', versions: [{ at: '2026-02-01' }] };
    assert.equal(ui.latestReport([oldCorrected, laterCreated]), oldCorrected); assert.equal(ui.latestReport([]), null);
    const first = ui.reportAnchor('a:b', 'c'), second = ui.reportAnchor('a', 'b:c'); assert.notEqual(first, second); assert(/^[a-z0-9-]+$/.test(first)); assert.equal(ui.reportAnchor('a:b', 'c'), first);
  });
  await test('Native reference grammar accepts literal author-relative paths/lines and rejects protocols/control characters', () => {
    const reference = ui.nativeReference('C:\\repo\\file name.md#L24', 'native:author');
    assert.deepEqual(reference, { sourceSessionId: 'native:author', path: 'C:/repo/file name.md', kind: 'file', line: 24, address: 'dsh-resource://file/session/native:author/C:/repo/file%20name.md' });
    assert.equal(ui.nativeReference('./src/example.ts', 'native-author').address, 'dsh-resource://file/session/native-author/src/example.ts');
    assert.equal(ui.nativeReference('src\\folder\\', 'native-author').kind, 'directory');
    assert.equal(ui.nativeReference('../docs/readme.md', 'native-author').path, '../docs/readme.md');
    for (const value of ['javascript:alert(1)', 'data:text/html,x', 'https://example.test/a', 'file:///C:/repo/file.txt', '//server/share/file', '\\\\server\\share\\file', 'bad\u0000path', 'bad\npath', 'C:/file:stream', 'docs/#L4', 'file.md#L0', 'file.md#L99999999999999999999']) assert.equal(ui.nativeReference(value, 'native-author'), null, value);
    assert.equal(ui.nativeReference('file.md', undefined), null); assert.equal(ui.nativeReference('bad\uD800.md', 'native-author'), null); assert(!source.includes('dangerouslySetInnerHTML')); assert(!source.includes('readFile('));
  });
  await test('Minimal Markdown reference parsing keeps unsafe/unknown-origin content text and carries exact record author through versions', () => {
    const text = 'Read [source](<C:\\repo\\file name.md#L24>) and [directory](./src/) plus [web](https://example.test/) and ![image](image.png).';
    const parsed = ui.markdownReferences(text, 'native-author'), refs = parsed.filter(part => part.reference);
    assert.equal(refs.length, 2); assert.equal(refs[0].reference.line, 24); assert.equal(refs[1].reference.kind, 'directory'); assert(parsed.some(part => part.text.includes('[web](https://example.test/)')));
    assert.deepEqual(ui.markdownReferences(text, undefined), [{ text }]);
    const sources = new Map([['native-author', { missing: false }], ['missing-author', { missing: true }]]);
    const author = ui.recordSource({ authorId: 'native-author' }, undefined, sources); assert.equal(author, 'native-author');
    assert.equal(ui.recordSource({ versions: [] }, author, sources), author); assert.equal(ui.recordSource({ text: 'version text' }, author, sources), author);
    assert.equal(ui.recordSource({ authorId: 'unknown' }, author, sources), undefined); assert.equal(ui.recordSource({ authorId: 'missing-author' }, author, sources), undefined);
    assert.equal(ui.recordSource({ managerId: 'native-author' }, undefined, sources), undefined); assert.equal(ui.recordSource({ sessionId: 'native-author' }, undefined, sources), undefined);
  });
  await test('Source containment, native roots/controls, scoped dictionaries and theme-only styling pass static checks', () => {
    const allowed = new Set(['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary', '--dsw-alias-brand-primary']);
    const tokens = [...ui.css.matchAll(/var\((--dsw-[^) ,]+)/g)].map(match => match[1]); assert(tokens.length); assert(tokens.every(token => allowed.has(token))); assert(!/#(?:[0-9a-f]{3}){1,2}\b|rgba?\(|hsla?\(/i.test(ui.css));
    assert(!source.includes("require('@deepseek-ai/")); assert(!source.includes('setInterval')); assert(!source.includes('Object.values(sessionState.byId)')); assert(source.includes("name: 'main', key: PANEL")); assert(source.includes("name: 'sidebar.panellist', id: PANEL")); assert(source.includes("ctx.locale.register(NS, 'en', EN)")); assert(source.includes("ctx.locale.register(NS, 'zh', ZH)")); assert(source.includes("type: 'checkbox'")); assert(source.includes("h('select'"));
    assert(source.includes('origin.current.focus()')); assert(source.includes('ctx.uiWorkspace.openSession(sessionId)')); assert(source.includes('props.useSessions(state => state)')); assert(source.includes('props.useWorkspaces(state => state)'));
    assert.deepEqual(Object.keys(ui.dictionaries.en).sort(), Object.keys(ui.dictionaries.zh).sort()); assert.equal(ui.dictionaries.en.responseNeededBy, 'Response requested from'); assert(!source.includes('Object.entries(value)'));
    return { tokens: [...new Set(tokens)], actualVisualVerification: false, visualLimitation: 'Live Client inspection timed out; no installation or browser/DOM emulation attempted.' };
  });
  await test('Manager change retains the former manager by default and preview delta makes explicit removals visible', () => {
    const team = { id: 'team-a', title: 'A', description: '', managerId: 'manager', memberIds: ['worker', 'another'] };
    const original = ui.setupFrom(team, 4), changed = ui.changeSetup(original, 'managerId', 'worker');
    assert.equal(changed.draft.managerId, 'worker'); assert.deepEqual(changed.draft.memberIds, ['another', 'manager']); assert.equal(original.draft.managerId, 'manager'); assert.equal(changed.dirty, true);
    const promoted = { type: 'save-team', ...changed.draft }; assert.deepEqual(ui.rosterDelta(team, promoted), { added: [], removed: [], previousManagerId: 'manager', managerId: 'worker' });
    const removed = ui.changeSetup(changed, 'memberIds', ['another']); assert.deepEqual(ui.rosterDelta(team, removed.draft).removed, ['manager']);
    assert(source.includes("t('managerChange')")); assert(source.includes("t('removed')"));
  });
  await test('Dirty setup and selected team survive observation/work/refresh revisions with an explicit stale-draft marker', () => {
    const team = { id: 'team-a', title: 'Saved title', description: 'Saved', managerId: 'manager', memberIds: ['worker'] };
    const start = ui.setupFrom(team, 4), dirty = ui.changeSetup(start, 'title', 'Unsaved title'), refreshed = view(7); refreshed.state.teams = [{ ...team, title: 'Concurrent title' }];
    const retained = ui.refreshSetup(dirty, refreshed); assert.equal(retained.teamId, team.id); assert.equal(retained.draft.title, 'Unsaved title'); assert.equal(retained.stale, true); assert.equal(retained.baseRevision, 4);
    const clean = ui.refreshSetup(start, refreshed); assert.equal(clean.teamId, team.id); assert.equal(clean.draft.title, 'Concurrent title'); assert.equal(clean.baseRevision, 7);
    const unsavedNew = ui.changeSetup(ui.setupFrom(null, 4), 'description', 'Preserve new draft'); assert.equal(ui.refreshSetup(unsavedNew, refreshed).draft.description, 'Preserve new draft');
    assert(!source.includes('key: view.state.revision')); assert(source.includes("t('draftStale')"));
  });
  await test('Acknowledged team save publishes exact saved-team hydration metadata instead of blank New-team reset', async () => {
    const model = ui.createController(async method => method === 'inspect' ? view() : { revision: 1 }); await model.load(); model.stage(cmd()); assert(await model.apply());
    const commit = model.getSnapshot().lastCommit; assert.equal(commit.command.teamId, 'team-native'); assert.equal(commit.revision, 1); assert(Object.isFrozen(commit.command));
    const hydrated = ui.setupFrom({ ...commit.command, id: commit.command.teamId }, commit.revision); assert.equal(hydrated.teamId, 'team-native'); assert.equal(hydrated.draft.title, 'Research'); assert.equal(hydrated.dirty, false); model.dispose();
  });
  await test('Retired-team activation and duplicate team titles are explicit, latest report version precedes history', () => {
    const teams = [{ id: 'first-abcdef', title: 'Same', status: 'idle' }, { id: 'other-abcdef', title: 'Same', status: 'active' }];
    assert.notEqual(ui.teamLabel(teams, teams[0].id), ui.teamLabel(teams, teams[1].id)); assert(ui.teamLabel(teams, teams[0].id).startsWith('Same · '));
    assert(source.includes("previous?.status === 'idle' ? 'reactivateAction'")); assert(source.includes("team.status === 'idle' ? ' · ' + t('retired')")); assert(source.includes('renderVersion(latest(report.versions))')); assert(source.includes('report.versions.slice(0, -1).reverse()'));
    for (const code of ['STALE', 'STALE_REVIEW', 'INVALID_TOPOLOGY', 'ARCHIVED', 'FORBIDDEN', 'OWNER_REQUIRED']) { assert(ui.dictionaries.en[code]); assert(ui.dictionaries.zh[code]); }
    assert(source.includes("state.error.message.slice(0, 600)")); assert(source.includes("state.error.code : 'hostFailure'"));
  });
  await test('Native resource navigation subscribes before Session open and waits for source mount plus next frame', () => {
    const h = navigationHarness(), reference = ui.nativeReference('./src/file.ts#L24', 'native-author');
    assert.equal(h.navigator.getSnapshot(), null); assert.equal(h.trace.length, 0); assert(h.navigator.navigate(reference));
    assert.deepEqual(h.trace.slice(0, 2), ['subscribe', ['openSession', 'native-author']]); assert.equal(h.trace.some(call => Array.isArray(call) && call[0] === 'openResource'), false);
    assert.equal(h.frames.size, 1); h.flushFrames();
    assert.deepEqual(h.trace.find(call => Array.isArray(call) && call[0] === 'openResource'), ['openResource', 'dsh-resource://file/session/native-author/src/file.ts', { params: { line: 24 }, destination: 'sidebar' }]);
    assert.equal(h.observers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.navigator.getSnapshot(), null); h.navigator.dispose();
  });
  await test('Directory reference opens only source Session Files navigator, never an exact-folder or file-preview claim', () => {
    const h = navigationHarness({ mount: false }); h.navigator.navigate(ui.nativeReference('src/folder/', 'native-author'));
    assert.equal(h.frames.size, 0); h.mount('unrelated'); assert.equal(h.frames.size, 0); h.mount('native-author'); assert.equal(h.frames.size, 1); h.flushFrames();
    assert(h.trace.some(call => Array.isArray(call) && call[0] === 'openTab' && call[1] === 'files')); assert.equal(h.trace.some(call => Array.isArray(call) && call[0] === 'openResource'), false);
    assert(ui.dictionaries.en.openSessionFiles.includes('path shown')); assert(source.includes("ctx.effect(() => () => resourceNavigator.dispose())")); h.navigator.dispose();
  });
  await test('New resource click and plugin unload cancel subscriptions, timers, frames and late old callbacks', () => {
    const h = navigationHarness(); h.navigator.navigate(ui.nativeReference('old.md', 'native-old')); const stale = [...h.frames.values()][0];
    h.navigator.navigate(ui.nativeReference('new.md', 'native-new')); stale(); h.flushFrames();
    const opened = h.trace.filter(call => Array.isArray(call) && call[0] === 'openResource'); assert.equal(opened.length, 1); assert(opened[0][1].includes('/native-new/new.md'));
    h.navigator.navigate(ui.nativeReference('dispose.md', 'native-author')); const afterDispose = [...h.frames.values()][0]; h.navigator.dispose(); afterDispose();
    assert.equal(h.observers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.trace.filter(call => Array.isArray(call) && call[0] === 'openResource').length, 1); assert.equal(h.navigator.navigate(ui.nativeReference('never.md', 'native-author')), false);
    const h2 = navigationHarness(); h2.navigator.navigate(ui.nativeReference('old.md', 'native-author')); const old = [...h2.frames.values()][0]; h2.navigator.navigate(ui.nativeReference('new.md', 'native-author')); old(); h2.navigator.dispose(); assert.equal(h2.frames.size, 0); assert.equal(h2.timers.size, 0);
  });
  await test('Navigation failures survive panel unsubscribe, return to global panel, and remain bounded plain error state', () => {
    for (const options of [{ openSessionError: new Error('Session unavailable') }, { openResourceError: new Error('<unsafe> '.repeat(200)) }, { mount: false }]) {
      const h = navigationHarness(options); let notices = 0; const unsubscribePanel = h.navigator.subscribe(() => notices++);
      h.navigator.navigate(ui.nativeReference('file.md', 'native-author')); unsubscribePanel(); h.flushFrames(); if (options.mount === false) h.timeout();
      const snapshot = h.navigator.getSnapshot(); assert(snapshot); assert(snapshot.message.length <= 600); assert(h.trace.includes('returnToPanel')); assert.equal(h.observers.size, 0); assert.equal(h.timers.size, 0);
      const newPanelRead = h.navigator.getSnapshot(); assert.equal(newPanelRead, snapshot); h.navigator.dismiss(); assert.equal(h.navigator.getSnapshot(), null); h.navigator.dispose();
    }
    const h = navigationHarness(); h.navigator.navigate(ui.nativeReference('file.md', 'native-author')); h.mount('different-before-frame'); h.flushFrames();
    assert.equal(h.navigator.getSnapshot().message, 'SESSION_MOUNT_CHANGED'); assert.equal(h.trace.some(call => Array.isArray(call) && call[0] === 'openResource'), false); h.navigator.dispose();
  });
  const available = execution => ({ availability: 'available', execution, archived: false });
  const assignment = workStatus => ({ targetId: 'worker', generation: 3, tenure: 2, status: 'current', workStatus, waitingReason: '', statusHistory: [], text: 'Inspect the next unit.', revision: 1, version: 1 });
  const profileFixture = () => ({ schemaVersion: 6, generation: 3, reports: [], proposals: [], sessions: [{ id: 'worker', identity: 'LEGACY GLOBAL ROLE MUST NOT DISPLAY', observation: available('unloaded'), focus: { withUser: false, userMessageId: null } }, { id: 'manager', identity: 'Legacy manager', observation: available('idle'), focus: { withUser: false, userMessageId: null } }], teams: [] });
  const teamFixture = () => ({ planVersion: 1, epoch: 1, automation: true, id: 'team-a', title: 'Team A', description: 'A concise description.', status: 'active', managerId: 'manager', memberIds: ['worker'], tenures: { manager: 1, worker: 2 }, brief: [], history: [], identities: [{ targetId: 'worker', tenure: 1, text: 'Former role' }, { targetId: 'worker', tenure: 2, text: 'Reviewer' }], responsibilities: [{ targetId: 'worker', text: 'Old overall work.' }, { targetId: 'worker', text: 'Review integration correctness.' }], assignments: [assignment('ready')] });
  await test('Unavailable takes priority over running or completed work for archived/missing/unknown native availability', () => {
    for (const observation of [{ ...available('running'), archived: true }, { ...available('running'), availability: 'missing' }, { ...available('running'), availability: 'unknown' }, undefined]) {
      for (const status of ['ready', 'waiting', 'in-progress', 'complete']) assert.equal(ui.visibleState(observation, assignment(status)), 'Unavailable');
    }
  });
  await test('Running means actual native running, not declared in-progress, and wins over waiting/complete', () => {
    for (const status of ['ready', 'waiting', 'in-progress', 'complete']) assert.equal(ui.visibleState(available('running'), assignment(status)), 'Running');
    assert.equal(ui.visibleState(available('idle'), assignment('in-progress')), 'Idle');
  });
  await test('Waiting derives only from current valid waiting work after native-running priority', () => {
    assert.equal(ui.visibleState(available('idle'), assignment('waiting')), 'Waiting');
    assert.equal(ui.visibleState(available('unloaded'), assignment('waiting')), 'Waiting');
    assert.equal(ui.visibleState(available('idle'), { ...assignment('waiting'), status: 'needs-review' }), 'Idle');
  });
  await test('Complete derives only from explicit current completed work, never report status or historical work', () => {
    assert.equal(ui.visibleState(available('idle'), assignment('complete')), 'Complete');
    assert.equal(ui.visibleState(available('idle'), { ...assignment('complete'), status: 'needs-review' }), 'Idle');
    const state = profileFixture(), team = teamFixture(); state.reports.push({ id: 'done-report', teamId: team.id, authorId: 'worker', versions: [{ status: 'complete', text: 'Done', at: '2026-01-01' }] });
    const catalog = ui.buildCatalog(sessionList([{ id: 'worker', title: 'Native worker', running: false }]), workspaces(), ['worker']);
    assert.equal(ui.memberProjection(state, team, 'worker', catalog).state, 'Idle');
  });
  await test('Base work states preserve ready/cold behavior without inventing execution from declared progress', () => {
    const seen = new Set();
    for (const execution of ['idle', 'unloaded', 'unknown', 'running']) for (const status of ['ready', 'waiting', 'in-progress', 'complete']) seen.add(ui.visibleState(available(execution), assignment(status)));
    seen.add(ui.visibleState(undefined)); assert.deepEqual([...seen].sort(), ['Complete', 'Idle', 'Running', 'Unavailable', 'Waiting']);
    assert.equal(ui.visibleState(available('unloaded'), null), 'Idle'); assert.equal(ui.visibleState(available('idle'), assignment('ready')), 'Idle');
  });
  await test('Native global ids+ready boolean running is authoritative; opaque projections and retained byId are not', () => {
    const state = profileFixture(), team = teamFixture(), row = { id: 'worker', title: 'Native worker', running: true };
    const native = sessionList([row], { projectionsBySession: { worker: { running: false } } });
    let catalog = ui.buildCatalog(native, workspaces(), ['worker']); assert.equal(ui.memberProjection(state, team, 'worker', catalog).state, 'Running');
    state.sessions[0].observation = available('running'); row.running = false;
    catalog = ui.buildCatalog(sessionList([row]), workspaces(), ['worker']); assert.equal(ui.memberProjection(state, team, 'worker', catalog).state, 'Idle');
    const retained = sessionList([]); retained.byId.worker = { ...row, running: true };
    catalog = ui.buildCatalog(retained, workspaces(), ['worker']); assert.equal(ui.memberProjection(state, team, 'worker', catalog).state, 'Unavailable');
  });
  await test('Catalog loading falls back to stored observations, not false Unavailable or stale catalog running', () => {
    const state = profileFixture(), team = teamFixture(); state.sessions[0].observation = available('running');
    const pending = ui.buildCatalog(sessionList([], { phase: 'pending' }), workspaces([], { phase: 'pending' }), ['worker']);
    assert.equal(ui.memberProjection(state, team, 'worker', pending).state, 'Running');
    state.sessions[0].observation = available('unloaded'); assert.equal(ui.memberProjection(state, team, 'worker', pending).state, 'Idle');
    const staleRows = ui.buildCatalog(sessionList([{ id: 'worker', title: 'Worker', running: true }], { phase: 'pending' }), workspaces(), ['worker']);
    assert.equal(ui.memberProjection(state, team, 'worker', staleRows).state, 'Idle');
    const readyRows = ui.buildCatalog(sessionList([{ id: 'worker', title: 'Worker', running: true }]), workspaces([], { phase: 'pending' }), ['worker']);
    state.sessions[0].observation = { ...available('unknown'), availability: 'unknown' }; assert.equal(ui.memberProjection(state, team, 'worker', readyRows).state, 'Running');
  });
  await test('Member projection is native name + current team-tenure identity + latest overall work; Manager is fixed', () => {
    const state = profileFixture(), team = teamFixture(), catalog = ui.buildCatalog(sessionList([{ id: 'worker', displayTitle: 'Native worker', running: false }, { id: 'manager', title: 'Native manager', running: false }]), workspaces());
    const member = ui.memberProjection(state, team, 'worker', catalog); assert.equal(member.name, 'Native worker'); assert.equal(member.identity, 'Reviewer'); assert.equal(member.overallAssignment, 'Review integration correctness.');
    const other = { ...team, id: 'team-b', identities: [{ targetId: 'worker', tenure: 2, text: 'Writer' }] }; assert.equal(ui.memberProjection(state, other, 'worker', catalog).identity, 'Writer');
    assert.equal(ui.memberProjection(state, { ...team, identities: [] }, 'worker', catalog).identity, '');
    team.identities.push({ targetId: 'manager', tenure: 1, text: 'Not Manager' }); assert.equal(ui.memberProjection(state, team, 'manager', catalog).identity, 'Manager');
    assert(!JSON.stringify(member).includes('LEGACY GLOBAL ROLE'));
  });
  await test('Current work rejects prior generation, tenure, retired team, removed member and needs-review assignments', () => {
    const state = profileFixture(), team = teamFixture(); assert.equal(ui.currentAssignment(state, team, 'worker').text, 'Inspect the next unit.');
    for (const item of [{ ...assignment('waiting'), generation: 2 }, { ...assignment('waiting'), tenure: 1 }, { ...assignment('waiting'), status: 'needs-review' }]) assert.equal(ui.currentAssignment(state, { ...team, assignments: [item] }, 'worker'), null);
    assert.equal(ui.currentAssignment(state, { ...team, status: 'idle' }, 'worker'), null); assert.equal(ui.currentAssignment(state, { ...team, memberIds: [] }, 'worker'), null);
  });
  await test('Team/profile/member/report navigation survives ledger reads and reset without persisting drafts or restoring previews', async () => {
    const route = ui.createNavigation(), calls = [], model = ui.createController(async method => { calls.push(method); return view(4, true, 3); });
    assert.equal(route.getSnapshot().teamId, null); route.select('team-a'); route.detail('profile', 'worker'); const selected = route.getSnapshot();
    await model.load(); model.stage(cmd()); model.invalidate(); await model.load(); assert.equal(route.getSnapshot(), selected); assert.equal(model.getSnapshot().pending, null); assert.equal(model.getSnapshot().acknowledged, false);
    route.detail('history', 'worker', 'report-a', 2); assert.equal(route.getSnapshot().teamId, 'team-a'); assert.equal(route.getSnapshot().reportId, 'report-a'); assert.equal(route.getSnapshot().reportVersion, 2);
    const unmountRoute = route.getSnapshot(), off = route.subscribe(() => {}); off(); assert.equal(route.getSnapshot(), unmountRoute);
    route.back(); assert.equal(route.getSnapshot().teamId, null); route.select('team-b'); assert.equal(route.getSnapshot().memberId, null); assert.equal(route.getSnapshot().reportId, null); model.dispose();
    assert(!source.includes('localStorage')); return { readsNeverAcknowledge: calls.every(method => method === 'inspect'), browserReloadPersistenceClaimed: false };
  });
  await test('Recent proposals are bounded and team/member-relevant, include typed identity targets and decisions', () => {
    const state = profileFixture(); state.proposals = Array.from({ length: 7 }, (_, index) => ({ id: 'p' + index, teamId: 'team-a', origin: { authorId: 'other' }, revisions: [{ text: 'Proposal', at: '2026-01-0' + (index + 1), concerned: [], ...(index % 2 === 0 ? { identityChange: { targetId: 'worker', identity: 'Reviewer' } } : {}) }], decisions: [] }));
    state.proposals.push({ id: 'foreign', teamId: 'other-team', origin: { authorId: 'worker' }, revisions: [{ at: '9999', concerned: [] }], decisions: [] });
    assert.deepEqual(ui.recentProposals(state, 'team-a', 'worker').map(item => item.id), ['p6', 'p4', 'p2']); assert.equal(ui.recentProposals(state, 'team-a').length, 3);
    assert.equal(ui.shortSummary('x'.repeat(1000)).length, 238); assert.equal(ui.shortSummary('Short.'), 'Short.');
  });
  await test('Revised proposal never inherits a prior escalation outcome; history retains every attributed old decision', () => {
    const old = { proposalRevision: 1, outcome: 'escalated', authorId: 'manager', text: 'Prior escalation' }, proposal = { revisions: [{ revision: 1, text: 'Old' }, { revision: 2, text: 'New revised proposal' }], decisions: [old] };
    assert.equal(ui.currentDecision(proposal), null); assert.deepEqual(ui.historicalDecisions(proposal), [old]);
    const accepted = { proposalRevision: 2, outcome: 'accepted', authorId: 'manager', text: 'Accepted current revision' }; proposal.decisions.push(accepted);
    assert.equal(ui.currentDecision(proposal), accepted); assert.deepEqual(ui.historicalDecisions(proposal), [old]);
    const historySource = source.slice(source.indexOf('    function History('), source.indexOf('    function Profile('));
    assert(historySource.includes('compact: false')); assert(historySource.includes('proposal.decisions.filter')); assert(historySource.includes('value: decision')); assert(historySource.includes('names(decision.authorId)'));
  });
  await test('V0.5.1 snapshot validation accepts compact fields, rejects legacy schema and malformed new projection data', () => {
    const wire = view(); wire.state.sessions = profileFixture().sessions; wire.state.teams = [teamFixture()]; wire.state.generation = 3;
    assert.equal(ui.verifyView(wire).state.schemaVersion, 6);
    for (const mutate of [value => { value.state.schemaVersion = 2; }, value => { delete value.state.teams[0].identities; }, value => { value.state.teams[0].assignments[0].workStatus = 'generated'; }, value => { value.state.teams[0].tenures.worker = 0; }]) { const malformed = structuredClone(wire); mutate(malformed); assert.throws(() => ui.verifyView(malformed), e => e.code === 'INVALID_RESPONSE'); }
  });
  await test('Native blank metadata hides provisional phantom rows without deleting named workers or saved selections', () => {
    const rows = sessionList([{ id: 'phantom', blank: true, displayTitle: 'Native workspace' }, { id: 'named', blank: true, title: 'Real researcher', displayTitle: 'Native workspace' }, { id: 'same-title', blank: false, title: 'Native workspace' }, { id: 'selected-blank', blank: true, displayTitle: 'Native workspace', retainedBy: { mainView: 1 } }]);
    const catalog = ui.buildCatalog(rows, workspaces());
    assert.deepEqual(catalog.groups.flatMap(group => group.entries.map(entry => entry.id)), ['named', 'same-title', 'selected-blank']);
    assert.equal(catalog.byId.get('phantom').reason, 'blank'); assert.equal(catalog.byId.get('named').eligible, true); assert.equal(catalog.byId.get('selected-blank').title, 'selected-blank');
    const retained = ui.buildCatalog(rows, workspaces(), ['phantom', 'saved-missing']); assert(retained.groups[0].entries.some(entry => entry.id === 'phantom')); assert(retained.groups[0].entries.some(entry => entry.id === 'saved-missing'));
    return { exactReportedEntryIdentified: false, ruleBasedOnPublicBlankMetadata: true, noNativeDeletion: true };
  });
  await test('Workspace hierarchy mirrors Native canonical case-sensitive nearest-component ancestry and retains empty ancestors', () => {
    const groups = [ { id: 'child', path: 'C:\\Repo\\child\\deeper', title: 'Deeper', entries: [{ id: 'deep' }] }, { id: 'root', path: 'C:/Repo/', title: 'Root', entries: [] }, { id: 'middle', path: 'C:/Repo/child', title: 'Child', entries: [] }, { id: 'prefix', path: 'C:/Repository', entries: [{ id: 'other' }] }, { id: 'case', path: 'C:/repo/case', entries: [{ id: 'case-worker' }] }, { id: 'posix', path: '/project', entries: [] }, { id: 'posix-backslash', path: '/project\\folder', entries: [{ id: 'literal' }] } ];
    const tree = ui.workspaceTree(groups), root = tree.find(group => group.id === 'root');
    assert.equal(root.children[0].id, 'middle'); assert.equal(root.children[0].children[0].id, 'child'); assert.deepEqual(root.entries, []);
    for (const id of ['prefix', 'case', 'posix-backslash']) assert(tree.some(group => group.id === id)); assert(!tree.some(group => group.id === 'posix'));
    assert.equal(groups[0].children, undefined); return { noInventedParentIds: true, noFilesystemScan: true };
  });
  await test('Workspace select-all is binary over direct eligible Sessions only, excludes manager and never changes child Sessions', () => {
    const group = { entries: [{ id: 'a', eligible: true }, { id: 'b', eligible: true }, { id: 'manager', eligible: true }, { id: 'saved-unavailable', eligible: false }], children: [{ entries: [{ id: 'child', eligible: true }] }] };
    assert.deepEqual(ui.directSelection(group, ['a', 'child'], 'manager'), { ids: ['a', 'b'], checked: false });
    assert.deepEqual(ui.toggleDirect(group, ['a', 'child', 'saved-unavailable'], 'manager'), ['a', 'child', 'saved-unavailable', 'b']);
    assert.deepEqual(ui.toggleDirect(group, ['a', 'b', 'child', 'saved-unavailable'], 'manager'), ['child']);
    assert.deepEqual(ui.directSelection(group, ['a', 'b', 'saved-unavailable'], 'manager'), { ids: ['a', 'b', 'saved-unavailable'], checked: true });
    assert.deepEqual(ui.toggleDirect({ entries: [{ id: 'saved-unavailable', eligible: false }] }, ['saved-unavailable', 'child']), ['child']);
    assert.deepEqual(ui.toggleDirect({ entries: [{ id: 'saved-unavailable', eligible: false }] }, []), []); // Never selects a new unavailable endpoint.
    assert.deepEqual(ui.directSelection({ entries: [], children: group.children }, ['child']), { ids: [], checked: false });
    assert(source.includes('selection.ids.length > 0')); assert(!source.includes('indeterminate')); assert(!source.includes('applyToChildren'));
  });
  const historyView = (teamId = 'team-a', generation = 1) => { const value = view(8, false, generation); value.state.snapshotKind = 'history'; value.state.teams = [{ ...teamFixture(), id: teamId }]; return value; };
  await test('History is lazy, uses SAME owner inspect query, immutable separate state, and never changes snapshot token or writes', async () => {
    const calls = [], model = ui.createController(async (method, args, signal) => { calls.push({ method, args, signal }); return args.query.type === 'history' ? historyView() : view(7); });
    await model.load(); model.selectHistoryTeam('team-a'); assert.equal(calls.length, 1); const current = model.getSnapshot().view;
    assert(await model.loadHistory('team-a')); assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, { query: { type: 'history', teamId: 'team-a' } }); assert(calls.every(call => call.method === 'inspect'));
    assert.equal(model.getSnapshot().view, current); assert.equal(current.reviewToken, '7'.repeat(64)); assert(Object.isFrozen(model.getSnapshot().history.view.state.teams)); model.dispose();
  });
  await test('History abort and selected-team guard discard late prior-team responses', async () => {
    const late = deferred(); let oldSignal;
    const model = ui.createController(async (_method, args, signal) => args.query.type === 'snapshot' ? view() : args.query.teamId === 'team-a' ? (oldSignal = signal, late.promise) : historyView('team-b'));
    await model.load(); model.selectHistoryTeam('team-a'); const old = model.loadHistory('team-a'); model.selectHistoryTeam('team-b'); assert(oldSignal.aborted); assert(await model.loadHistory('team-b'));
    late.resolve(historyView()); assert.equal(await old, false); assert.equal(model.getSnapshot().history.teamId, 'team-b'); model.dispose();
  });
  await test('History late responses cannot survive refresh, reset, close, disposal or wrong-generation/team payloads', async () => {
    for (const operation of ['refresh', 'reset', 'close', 'dispose']) {
      const late = deferred(); let signal; const model = ui.createController(async (_method, args, nativeSignal) => args.query.type === 'history' ? (signal = nativeSignal, late.promise) : view());
      await model.load(); model.selectHistoryTeam('team-a'); const old = model.loadHistory('team-a');
      if (operation === 'refresh') await model.load(); else if (operation === 'reset') model.invalidate(); else if (operation === 'close') model.selectHistoryTeam(null); else model.dispose();
      assert(signal.aborted, operation); late.resolve(historyView()); assert.equal(await old, false, operation); if (operation !== 'dispose') assert.equal(model.getSnapshot().history, null); model.dispose();
    }
    for (const payload of [historyView('team-b'), historyView('team-a', 99), { ...historyView(), state: { ...historyView().state, snapshotKind: 'current' } }]) {
      const model = ui.createController(async (_method, args) => args.query.type === 'history' ? payload : view()); await model.load(); model.selectHistoryTeam('team-a'); assert.equal(await model.loadHistory('team-a'), false); assert.equal(model.getSnapshot().history.error.code, 'INVALID_RESPONSE'); assert.equal(model.getSnapshot().view.state.generation, 1); model.dispose();
    }
  });
  await test('Current reports bind exact current worker assignment and cited history never substitutes latest text', () => {
    const state = profileFixture(), team = teamFixture(); state.reports = [ { id: 'old-task', teamId: team.id, authorId: 'worker', versions: [{ version: 8, assignmentRevision: 90, text: 'Old task' }] }, { id: 'current-task', teamId: team.id, authorId: 'worker', versions: [{ version: 2, assignmentRevision: 1, text: 'Exact citation' }, { version: 7, assignmentRevision: 1, text: 'New correction' }] }, { id: 'manager-review', teamId: team.id, authorId: 'manager', versions: [{ version: 1, text: 'Unassigned review' }] } ];
    assert.deepEqual(ui.currentWorkerReports(state, team).map(report => report.id), ['current-task']); assert.equal(ui.exactReport(state, team.id, 'current-task', 2).version.text, 'Exact citation'); assert.equal(ui.exactReport(state, team.id, 'current-task', 3), null); assert.equal(ui.exactReport(state, 'wrong-team', 'current-task', 7), null);
    assert.deepEqual(ui.currentWorkerReports(state, { ...team, assignments: [] }), []);
  });
  await test('Compact v5 preserves exact non-contiguous latest numbers and rejects absent plan or assignment versions', () => {
    const value = view(); value.state.teams = [{ ...teamFixture(), planVersion: 8, assignments: [{ ...assignment('ready'), version: 12 }] }]; value.state.reports = [{ id: 'report', teamId: 'team-a', authorId: 'worker', versions: [{ version: 7, text: 'Latest only', at: '2026-01-01' }] }];
    const clean = ui.verifyView(value); assert.equal(clean.state.teams[0].planVersion, 8); assert.equal(clean.state.teams[0].assignments[0].version, 12); assert.equal(clean.state.reports[0].versions[0].version, 7);
    for (const mutate of [value => delete value.state.teams[0].planVersion, value => delete value.state.teams[0].assignments[0].version]) { const bad = structuredClone(value); mutate(bad); assert.throws(() => ui.verifyView(bad), e => e.code === 'INVALID_RESPONSE'); }
  });
  await test('Landing-only setup draft survives hidden-profile unmount semantics without native rename dependencies', async () => {
    const model = ui.createController(async () => view()); const setup = ui.changeSetup(ui.setupFrom(null, 1), 'title', 'Unsaved'); model.setSetup(setup); setup.draft.title = 'Changed externally'; assert.equal(model.getSetup().draft.title, 'Unsaved'); assert(Object.isFrozen(model.getSetup())); assert(model.claimSetupCommit(9)); assert(!model.claimSetupCommit(9));
    assert.throws(() => ui.prepareCommand('rename-session', { sessionId: 'worker', title: 'No' }), e => e.code === 'INPUT_INVALID'); assert.equal(ui.renameNative, undefined); assert(!ui.inject.includes('sessions')); assert(!source.includes('ref.binding.session.rename')); assert(!source.includes("command.type === 'rename-session'")); model.dispose();
  });
  await test('Quiet profile has objective, one-badge cards, proposals, all current reports and one history entry with no top tabs or member report links', () => {
    const profile = source.slice(source.indexOf('    function Profile('), source.indexOf('    function OwnerForm(')); const contents = source.slice(source.indexOf('    function Contents('), source.indexOf('    function Panel('));
    const mainProfile = profile.slice(profile.indexOf("h('header', { className: 'sc9-row' }", profile.indexOf("if (route.view === 'history')") + 1));
    assert(profile.indexOf("t('objective')") < profile.indexOf("className: 'sc9-members'")); assert(profile.indexOf("className: 'sc9-members'") < profile.indexOf("t('recentProposals')")); assert(profile.indexOf("t('recentProposals')") < profile.indexOf('h(Reports,')); assert(profile.indexOf('h(Reports,') < profile.lastIndexOf("t('detailsHistory')"));
    assert.equal((profile.match(/className: 'sc9-badge'/g) ?? []).length, 1); assert.equal((profile.match(/navigation.detail\('history'\)/g) ?? []).length, 1); assert(!profile.includes("t('viewReport')")); assert(!profile.includes("t('responsibilities')")); assert(!profile.includes("navigation.detail('reports'")); assert(!profile.includes("t('profile')"));
    assert(contents.includes("view && !route.teamId && h('details', { className: 'sc9-setup', open: route.setupOpen || undefined }")); assert(ui.css.includes('font-size:18px;font-weight:700')); assert(ui.css.includes('font-size:15px;font-weight:700')); assert(source.includes("navigation.detail('history', proposal.origin.authorId, proposal.origin.reportId, proposal.origin.version)"));
    assert(!source.includes('JSON.stringify(value)')); for (const key of ['generation', 'revision', 'at', 'version']) assert(!profile.includes("t('" + key + "')")); return { staticSourceAssertionsOnly: true, rendered: false };
  });
  const statusWire = (statusVersion = 0, patch = {}) => ({ state: { statusVersion, statuses: { worker: { withUser: false, needsIntervention: false, waiting: false, complete: false, reason: '', pendingCount: 0, ...patch } } } });
  await test('V5 primary state precedence uses genuine native approval, distinct user focus and actual blocking work', () => {
    const running = available('running'), idle = available('idle'), waiting = assignment('waiting');
    assert.equal(ui.visibleState(running, waiting, { intervention: true, nativeStatus: { pendingInteraction: { kind: 'approval' } }, focus: { withUser: true } }), 'NeedsIntervention');
    assert.equal(ui.visibleState(running, waiting, { nativeStatus: { pendingInteraction: { kind: 'approval' } }, focus: { withUser: true } }), 'ApprovalNeeded');
    assert.equal(ui.visibleState(running, waiting, { focus: { withUser: true } }), 'WithUser');
    assert.equal(ui.visibleState(idle, waiting, { nativeStatus: { running: true } }), 'Running');
    assert.equal(ui.visibleState(idle, assignment('ready'), { nativeStatus: { pendingInteraction: { kind: 'question' } } }), 'NeedsIntervention');
    assert.equal(ui.visibleState(idle, waiting, { waiting: false, complete: true }), 'Complete');
    assert.equal(ui.visibleState(idle, assignment('ready'), { approvalPolicy: 'ask' }), 'Idle');
    assert.equal(ui.visibleState({ ...idle, availability: 'missing' }, waiting, { intervention: true }), 'Unavailable');
  });
  await test('Status contract validates boolean facts and detached immutable objects, without owner ledger/token assumptions', () => {
    const wire = statusWire(3, { withUser: true }), checked = ui.verifyStatuses(wire); wire.state.statuses.worker.withUser = false;
    assert.equal(checked.statuses.worker.withUser, true); assert(Object.isFrozen(checked.statuses.worker)); assert.equal(checked.statusVersion, 3);
    for (const mutate of [value => value.state.statusVersion = -1, value => value.state.statuses.worker.waiting = 'yes', value => value.state.statuses.worker.pendingCount = 1.5, value => delete value.state.statuses.worker.reason]) { const bad = statusWire(); mutate(bad); assert.throws(() => ui.verifyStatuses(bad), e => e.code === 'INVALID_RESPONSE'); }
  });
  await test('One shared status watcher long-polls existing owner Remote, resets safely and discards late disposed responses', async () => {
    const calls = [], store = ui.createStatusStore((method, args, signal) => { const response = deferred(); calls.push({ method, args, signal, response }); return response.promise; });
    store.start(); store.start(); assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, { query: { type: 'status' } });
    calls[0].response.resolve(statusWire(3, { withUser: true })); await turn(); assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, { query: { type: 'status', after: 3 } });
    assert.equal(store.getSnapshot().statuses.worker.withUser, true); store.reset(); assert(calls[1].signal.aborted); assert.equal(calls.length, 3); assert.equal(store.getSnapshot().ready, false);
    calls[1].response.resolve(statusWire(99, { needsIntervention: true })); await turn(); assert.equal(store.getSnapshot().ready, false);
    calls[2].response.resolve(statusWire(1, { waiting: true })); await turn(); assert.equal(store.getSnapshot().statusVersion, 1); assert.equal(calls.length, 4);
    store.dispose(); assert(calls[3].signal.aborted); const last = store.getSnapshot(); calls[3].response.resolve(statusWire(2)); await turn(); assert.equal(store.getSnapshot(), last); assert.equal(calls.length, 4);
  });
  await test('Host-local status cursor can reset lower without a browser reset or permanent false error', async () => {
    const calls = [], store = ui.createStatusStore((method, args, signal) => { const response = deferred(); calls.push({ args, signal, response }); return response.promise; });
    store.start(); calls[0].response.resolve(statusWire(12, { withUser: true })); await turn(); assert.equal(calls[1].args.query.after, 12);
    // Same browser connection; new Host service incarnation starts its cheap fact counter again.
    calls[1].response.resolve(statusWire(1, { waiting: true })); await turn();
    assert.equal(store.getSnapshot().ready, true); assert.equal(store.getSnapshot().error, null); assert.equal(store.getSnapshot().statusVersion, 1);
    assert.equal(store.getSnapshot().statuses.worker.withUser, false); assert.equal(store.getSnapshot().statuses.worker.waiting, true); assert.equal(calls[2].args.query.after, 1);
    calls[2].response.resolve(statusWire(0, { complete: true })); await turn(); assert.equal(store.getSnapshot().statusVersion, 0); assert.equal(store.getSnapshot().statuses.worker.complete, true); assert.equal(calls[3].args.query.after, 0);
    store.dispose(); assert(calls[3].signal.aborted);
  });
  await test('Status watcher errors back off, clear stale facts and cannot retry after disposal', async () => {
    const calls = [], timers = new Map(); let next = 0;
    const store = ui.createStatusStore((method, args, signal) => { const response = deferred(); calls.push({ response, signal }); return response.promise; }, { setTimer(callback, delay) { const key = ++next; timers.set(key, { callback, delay }); return key; }, clearTimer(key) { timers.delete(key); } });
    store.start(); calls[0].response.reject(error('CARRIER_FAILURE')); await turn(); assert.equal(store.getSnapshot().ready, false); assert.equal([...timers.values()][0].delay, 1000);
    const retry = [...timers.values()][0]; timers.clear(); retry.callback(); await turn(); assert.equal(calls.length, 2); calls[1].response.reject(error('CARRIER_FAILURE')); await turn(); assert.equal([...timers.values()][0].delay, 2000);
    const late = [...timers.values()][0]; store.dispose(); assert.equal(timers.size, 0); late.callback(); await turn(); assert.equal(calls.length, 2);
  });
  await test('Sidebar status uses authoritative ids, native pending request and cheap facts, not retained history or report claims', () => {
    const sessions = sessionList([{ id: 'worker', running: false }]), status = { ready: true, ...ui.verifyStatuses(statusWire(1, { withUser: true })) };
    assert.equal(ui.sidebarProjection(status, sessions, 'worker', { running: true }).state, 'WithUser');
    assert.equal(ui.sidebarProjection(status, sessions, 'worker', { pendingInteraction: { kind: 'approval' } }).state, 'ApprovalNeeded');
    assert.equal(ui.sidebarProjection(status, sessions, 'worker', {}, true).state, 'Unavailable');
    assert.equal(ui.sidebarProjection({ ...status, ready: false }, sessions, 'worker', {}), null);
    const retained = sessionList([]); retained.byId.worker = { running: true }; assert.equal(ui.sidebarProjection(status, retained, 'worker', {}).state, 'Unavailable');
    assert.equal(ui.sidebarProjection({ ready: true, statuses: {} }, sessions, 'worker', { running: false, completionUnread: true }), null);
  });
  await test('Membership facts alone gate unrelated, retired-only and unknown rows before native attention states', () => {
    const sessions = sessionList([{ id: 'worker', running: true }, { id: 'other', running: true }]);
    for (const native of [{ running: true }, { pendingInteraction: { kind: 'approval' } }, { pendingInteraction: { kind: 'question' } }, { completionUnread: true }]) {
      for (const status of [undefined, { ready: false, statuses: statusWire().state.statuses }, { ready: true, statuses: {} }]) assert.equal(ui.sidebarProjection(status, sessions, 'worker', native), null);
    }
    const ready = { ready: true, ...ui.verifyStatuses(statusWire()) };
    assert.equal(ui.sidebarProjection(ready, sessions, 'other', { running: true }), null);
    assert.equal(ui.sidebarProjection(ready, sessions, 'worker', { running: true }).state, 'Running');
    const sidebar = source.slice(source.indexOf('    function SidebarStatus('), source.indexOf('    function Icon('));
    assert(sidebar.includes('return projected ? h(StatusDot,')); assert(sidebar.includes('if (!projected) return null;'));
    assert(!sidebar.includes("props.t('statusUnknown')"));
    return { noDotDashOrLabelWithoutMembership: true, activeOtherTeamIndependentOfSelectedProfile: true };
  });
  await test('Retirement removes only absent facts and reset removes all indicators until new ready membership arrives', async () => {
    const calls = [], store = ui.createStatusStore((_method, _args, signal) => { const response = deferred(); calls.push({ response, signal }); return response.promise; });
    const sessions = sessionList([{ id: 'worker', running: false }, { id: 'other', running: false }]);
    const project = who => ui.sidebarProjection(store.getSnapshot(), sessions, who, {});
    store.start(); assert.equal(project('worker'), null);
    calls[0].response.resolve({ state: { statusVersion: 1, statuses: { ...statusWire().state.statuses, other: statusWire(0, { waiting: true }).state.statuses.worker } } }); await turn();
    assert.equal(project('worker').state, 'Idle'); assert.equal(project('other').state, 'Waiting');
    calls[1].response.resolve({ state: { statusVersion: 2, statuses: { other: statusWire(0, { waiting: true }).state.statuses.worker } } }); await turn();
    assert.equal(project('worker'), null); assert.equal(project('other').state, 'Waiting');
    store.reset(); assert.equal(project('worker'), null); assert.equal(project('other'), null);
    calls[2].response.resolve(statusWire(99)); await turn(); assert.equal(project('worker'), null);
    calls[3].response.resolve(statusWire(0, { complete: true })); await turn(); assert.equal(project('worker').state, 'Complete'); assert.equal(project('other'), null); store.dispose();
  });
  await test('Same-shape seven-pixel dots use native palette, deep red both schemes, dash fallback and no focus switch or DOM patching', () => {
    for (const state of ui.PRIMARY_STATES) assert(ui.STATE_COLORS[state]); assert(ui.STATE_COLORS.NeedsIntervention.includes('light-dark')); assert.notEqual(ui.STATE_COLORS.ApprovalNeeded, ui.STATE_COLORS.NeedsIntervention);
    assert(source.includes("height: missing ? 2 : 7")); assert(source.includes("borderRadius: missing ? 1 : '50%'")); assert(source.includes("cornerShape: 'round'"));
    assert(source.includes("name: 'sidebar.session.row.trailing'")); assert(source.includes("name: 'sidebar.session.row.hover'")); assert(!source.includes("name: 'sidebar.session.row.leading'"));
    assert(source.includes('props.useSessionStatus(value => value.get(props.sessionId))')); assert(!/querySelector|MutationObserver|document\.|retainAgentScope|sessions\.bind|approval\/request/.test(source));
    assert(!source.includes('set-user-focus')); assert(!source.includes('focusToggle')); return { oneAddedDot: true, nativeLeadingMarkerUnchanged: true, rendered: false };
  });
  await test('Retired teams collapse separately; reopen routes preserved roster through existing exact setup rather than resuming work', () => {
    const active = { ...teamFixture(), id: 'active' }, retired = { ...teamFixture(), id: 'retired', status: 'idle' };
    assert.deepEqual(ui.partitionTeams([retired, active]), { active: [active], retired: [retired] }); const setup = ui.setupFrom(retired, 8); assert.equal(setup.teamId, retired.id); assert.deepEqual(setup.draft.memberIds, retired.memberIds);
    const route = ui.createNavigation(); route.select(retired.id); route.setup(); assert.equal(route.getSnapshot().teamId, null); assert.equal(route.getSnapshot().setupOpen, true); route.select(active.id); assert.equal(route.getSnapshot().setupOpen, false);
    assert(source.includes("className: 'sc9-retired'")); assert(!source.includes("className: 'sc9-retired', open")); assert(source.includes("t('retireExplanation')")); assert(!source.includes('resume-assignment'));
  });
  await test('Automation pause/resume uses exact existing owner preview and never grants Session permissions', async () => {
    const calls = [], model = ui.createController(async (method, args) => { calls.push({ method, args }); return method === 'inspect' ? view(8) : { revision: 9 }; }); await model.load();
    const command = ui.prepareCommand('set-automation', { teamId: 'team-a', enabled: false }); assert.deepEqual(command, { type: 'set-automation', teamId: 'team-a', enabled: false });
    assert.throws(() => ui.prepareCommand('set-automation', { teamId: 'team-a', enabled: 'yes' })); model.stage(command); const pending = model.getSnapshot().pending; assert.equal(pending.command.expectedRevision, 8); assert.equal(pending.precondition.reviewToken, view(8).reviewToken);
    await model.apply(); assert.equal(calls[1].method, 'administer'); assert.deepEqual(calls[1].args, pending); model.dispose();
  });
  await test('Actual schema6 Core current/history projections fit Client validation with full-ledger owner token', () => {
    const Core = require('../lib/core.cjs'); let state = Core.initialState();
    state = Core.transition(state, { kind: 'owner' }, { type: 'save-team', expectedRevision: state.revision, teamId: 'wire-team', title: 'Wire team', description: 'Actual schema proof', managerId: 'wire-manager', memberIds: ['wire-worker'] }, '2026-01-01T00:00:00.000Z').state;
    state = Core.transition(state, { kind: 'host' }, { type: 'user-input', sessionId: 'wire-manager', userMessageId: 'wire-discussion' }, '2026-01-01T00:00:01.000Z').state;
    state = Core.transition(state, { kind: 'session', id: 'wire-manager' }, { type: 'prepare-dispatch', teamId: 'wire-team', dispatchId: 'wire-dispatch', expectedPlanVersion: state.teams[0].planVersion, expectedUserMessageId: 'wire-discussion', summary: 'Exact UI wire proof', permissionExpectations: 'No native permission granted', plan: { assignments: [{ targetId: 'wire-worker', text: 'Exact task', expectedAssignment: null }] } }, '2026-01-01T00:00:02.000Z').state;
    const token = Core.token(state), current = ui.verifyView({ state: Core.read(state, { kind: 'owner' }, { type: 'snapshot' }), reviewToken: token });
    assert.equal(current.state.schemaVersion, 6); assert.equal(current.state.teams[0].automation, true); assert.equal(current.state.sessions[0].focus.withUser, true); assert.equal(current.state.dispatches[0].assignmentCount, 1); assert.equal(current.state.dispatches[0].plan, undefined);
    const history = ui.verifyView({ state: Core.read(state, { kind: 'owner' }, { type: 'history', teamId: 'wire-team' }), reviewToken: token }); assert.equal(history.state.snapshotKind, 'history'); assert.equal(history.state.dispatches[0].plan.assignments[0].text, 'Exact task');
    const delivery = ui.verifyDelivery({ state: Core.read(state, { kind: 'owner' }, { type: 'delivery', teamId: 'wire-team' }) }, 'wire-team', state.generation); assert.deepEqual(delivery.continuations, []);
    assert.equal(current.reviewToken, Core.token(state)); assert.deepEqual(history.state.messages, []); return { actualCoreWireNotHandwrittenProjection: true, nativeHost: false };
  });
  await test('Resolved or superseded-scope alerts do not raise intervention and forwarded exact reports preserve their actual author', () => {
    const state = profileFixture(), team = teamFixture(); state.teams = [team]; const alert = { teamId: team.id, targetId: 'worker', targetTenure: team.tenures.worker, generation: state.generation, epoch: team.epoch, needsUser: true, resolved: false, text: 'Needs a decision' };
    state.alerts = [alert]; assert.equal(ui.openIntervention(state, 'worker'), alert); alert.resolved = true; assert.equal(ui.openIntervention(state, 'worker'), undefined); alert.resolved = false; alert.epoch = 0; assert.equal(ui.openIntervention(state, 'worker'), undefined);
    state.reports = [{ id: 'a-report', teamId: team.id, authorId: 'creator', versions: [{ version: 2, text: 'Exact evidence' }] }]; assert.equal(ui.messageReportSource(state, { teamId: team.id, authorId: 'editor', reportId: 'a-report' }), 'creator');
  });
  await test('General unresolved alerts survive restart; work-scoped alerts require exact unfinished current work', () => {
    const state = profileFixture(), team = teamFixture(); state.teams = [team];
    const alert = { teamId: team.id, targetId: 'worker', targetTenure: team.tenures.worker, generation: state.generation - 1, epoch: team.epoch, needsUser: true, resolved: false, text: 'User decision still required' }; state.alerts = [alert];
    assert.equal(ui.openIntervention(state, 'worker'), alert);
    const work = team.assignments[0]; alert.assignmentRevision = work.revision; assert.equal(ui.openIntervention(state, 'worker'), alert);
    alert.assignmentRevision++; assert.equal(ui.openIntervention(state, 'worker'), undefined); alert.assignmentRevision = work.revision;
    work.status = 'needs-review'; assert.equal(ui.openIntervention(state, 'worker'), undefined); work.status = 'current';
    work.workStatus = 'complete'; assert.equal(ui.openIntervention(state, 'worker'), undefined); work.workStatus = 'ready';
    state.generation++; assert.equal(ui.openIntervention(state, 'worker'), undefined); delete alert.assignmentRevision; assert.equal(ui.openIntervention(state, 'worker'), alert);
    team.status = 'idle'; assert.equal(ui.openIntervention(state, 'worker'), undefined); team.status = 'active';
    team.epoch++; assert.equal(ui.openIntervention(state, 'worker'), undefined); team.epoch--;
    team.tenures.worker++; assert.equal(ui.openIntervention(state, 'worker'), undefined);
    const Core = require('../lib/core.cjs'); let actual = Core.initialState();
    actual = Core.transition(actual, { kind: 'owner' }, { type: 'save-team', expectedRevision: actual.revision, teamId: 'alert-team', title: 'Alert scope', description: '', managerId: 'alert-manager', memberIds: ['alert-worker'] }, '2026-01-01T00:00:00.000Z').state;
    actual = Core.transition(actual, { kind: 'session', id: 'alert-manager' }, { type: 'raise-alert', teamId: 'alert-team', alertId: 'general-alert', targetId: 'alert-worker', needsUser: true, text: 'Still needs a user decision' }, '2026-01-01T00:00:01.000Z').state;
    actual = Core.start(actual, '2026-01-01T00:00:02.000Z'); const projected = Core.read(actual, { kind: 'owner' }, { type: 'snapshot' });
    assert.equal(ui.openIntervention(projected, 'alert-worker')?.id, 'general-alert'); assert(actual.wakeups.every(wake => wake.status === 'cancelled'));
  });
  const dispatchFixture = () => ({ id: 'dispatch-a', teamId: 'team-a', generation: 1, epoch: 1, managerId: 'manager', managerTenure: 1, planVersion: 7, discussionUserMessageId: 'native-discussion', summary: 'Exact dispatch preview', permissionExpectations: 'Native approval remains required.', hash: 'a'.repeat(64), at: '2026-01-01T00:00:00.000Z', status: 'prepared', assignmentTargets: ['worker'], assignmentCount: 1 });
  const deliveryWire = (teamId = 'team-a', generation = 1) => ({ state: { teamId, generation, revision: 4, reviewRequired: false, wakeups: [{ id: 'wake-a', teamId, sessionId: 'worker', reason: 'continuation', status: 'pending', applicable: true, heldReason: 'native-busy' }], continuations: [{ proposalId: 'proposal-a', proposalRevision: 2, status: 'recorded', recordOnly: false, continueAssignments: [{ sessionId: 'worker', assignmentRevision: 9, assignmentVersion: 4 }], wakeIds: ['wake-a'] }] }, reviewToken: 'a'.repeat(64) });
  await test('Schema6 accepts frozen compact/full dispatch fields and rejects malformed or legacy dispatch projections', () => {
    const wire = view(); wire.state.dispatches = [dispatchFixture()]; assert.equal(ui.verifyView(wire).state.dispatches[0].assignmentCount, 1);
    const full = structuredClone(wire), dispatch = full.state.dispatches[0]; delete dispatch.assignmentTargets; delete dispatch.assignmentCount;
    dispatch.plan = { assignments: [{ targetId: 'worker', text: 'Exact immutable task', expectedAssignment: null }], statuses: [], responsibilities: [], identities: [] };
    dispatch.status = 'confirmed'; dispatch.confirmation = { userMessageId: 'native-new-user', at: '2026-01-01T00:01:00.000Z', returnToCoordination: false };
    const checked = ui.verifyView(full); assert(Object.isFrozen(checked.state.dispatches[0].plan.assignments)); assert.equal(checked.state.dispatches[0].confirmation.returnToCoordination, false);
    for (const mutate of [v => v.state.schemaVersion = 5, v => delete v.state.dispatches, v => v.state.dispatches[0].status = 'processed', v => v.state.dispatches[0].hash = 'bad', v => delete v.state.dispatches[0].permissionExpectations, v => v.state.dispatches[0].assignmentCount = -1]) { const bad = structuredClone(wire); mutate(bad); assert.throws(() => ui.verifyView(bad), e => e.code === 'INVALID_RESPONSE'); }
    const history = source.slice(source.indexOf('    function DispatchHistory('), source.indexOf('    function WorkerSetup('));
    for (const field of ['dispatch.plan', 'dispatch.permissionExpectations', 'dispatch.hash', 'dispatch.discussionUserMessageId', 'dispatch.confirmation.userMessageId', 'dispatch.confirmation.returnToCoordination']) assert(history.includes(field));
    for (const command of ['prepare-dispatch', 'confirm-dispatch']) assert.throws(() => ui.prepareCommand(command, { teamId: 'team-a' }), e => e.code === 'INPUT_INVALID');
    return { noOwnerDispatchConfirmationUI: true, existingHistoryOnly: true };
  });
  await test('Delivery diagnostics are lazy read-only detached facts, distinguish recorded/claimed/sent and preserve held reason', async () => {
    const calls = [], model = ui.createController(async (method, args) => { calls.push({ method, args }); return args.query.type === 'delivery' ? deliveryWire() : view(7); });
    await model.load(); model.selectHistoryTeam('team-a'); assert.equal(calls.length, 1); const current = model.getSnapshot().view;
    assert(await model.loadDelivery('team-a')); assert.deepEqual(calls[1], { method: 'inspect', args: { query: { type: 'delivery', teamId: 'team-a' } } });
    assert.equal(model.getSnapshot().view, current); assert.equal(model.getSnapshot().delivery.view.wakeups[0].heldReason, 'native-busy'); assert(Object.isFrozen(model.getSnapshot().delivery.view.continuations));
    for (const status of ['pending', 'claimed', 'sent', 'cancelled', 'failed']) { const wire = deliveryWire(); wire.state.wakeups[0].status = status; assert.equal(ui.verifyDelivery(wire, 'team-a', 1).wakeups[0].status, status); }
    const wire = deliveryWire(); wire.state.wakeups[0].heldReason = null; assert.equal(ui.verifyDelivery(wire, 'team-a', 1).wakeups[0].heldReason, null);
    for (const mutate of [v => v.state.teamId = 'wrong', v => v.state.generation = 99, v => v.state.wakeups[0].status = 'processed', v => v.state.continuations[0].status = 'continued', v => v.state.wakeups[0].heldReason = {}]) { const bad = deliveryWire(); mutate(bad); assert.throws(() => ui.verifyDelivery(bad, 'team-a', 1), e => e.code === 'INVALID_RESPONSE'); }
    assert(ui.dictionaries.en.deliveryMeaning.includes('None proves understanding or processing')); assert(ui.dictionaries.en.deliveryclaimed.includes('Claimed')); assert(ui.dictionaries.en.deliverysent.includes('native input admitted')); assert(source.includes('item.wakeIds.length')); model.dispose();
  });
  await test('Delivery diagnostics cannot survive selected-team change, refresh, reset, close or disposal', async () => {
    for (const operation of ['team', 'refresh', 'reset', 'close', 'history', 'dispose']) {
      const late = deferred(); let signal; const model = ui.createController(async (_method, args, nativeSignal) => args.query.type === 'delivery' ? (signal = nativeSignal, late.promise) : args.query.type === 'history' ? historyView() : view());
      await model.load(); model.selectHistoryTeam('team-a'); const old = model.loadDelivery('team-a'); assert.equal(await model.loadDelivery('team-a'), false);
      if (operation === 'team') model.selectHistoryTeam('team-b'); else if (operation === 'refresh') await model.load(); else if (operation === 'reset') model.invalidate(); else if (operation === 'close') model.selectHistoryTeam(null); else if (operation === 'history') await model.loadHistory('team-a'); else model.dispose();
      assert(signal.aborted, operation); late.resolve(deliveryWire()); assert.equal(await old, false, operation); if (operation !== 'dispose') assert.equal(model.getSnapshot().delivery, null); model.dispose();
    }
  });
  results.passed = results.tests.filter(test => test.status === 'passed').length; results.failed = results.tests.filter(test => test.status === 'failed').length;
  results.sourceHash = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  fs.writeFileSync(require('./paths.cjs').resultPath('ui'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.passed, failed: results.failed, browserRendered: false })); if (results.failed) process.exitCode = 1;
})();


