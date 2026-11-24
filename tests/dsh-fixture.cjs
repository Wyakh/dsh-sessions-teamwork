'use strict';
// Test-only composition; no profile loader, sockets, external models, or live sessions.
const { createRequire, syncBuiltinESMExports } = require('node:module');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { root, runtime, ownedMutation } = require('./paths.cjs');
if (!process.env.DSH_INSTALL_DIR || !process.versions.electron) throw Error('Use scripts/test.ps1 with a compatible DSH Desktop runtime.');
const load = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
const audit = { fileMutations: [], networkAttempts: [] };
const faults = { failNextCoordRename: false, failCoordRenames: false, holdNextCoordRename: null, renameFailures: 0 };
function inside(file) {
  if (typeof file !== 'string') throw Error('Test mutation requires a path string.');
  const absolute = path.resolve(file), relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !ownedMutation(relative)) throw Error('Outside-workspace mutation refused: ' + absolute);
  let existing = absolute;
  while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
  const actual = fs.realpathSync(existing), actualRoot = fs.realpathSync(root), realRelative = path.relative(actualRoot, actual);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !ownedMutation(realRelative)) throw Error('Mutation through outside-workspace alias refused: ' + absolute);
  audit.fileMutations.push(relative); return absolute;
}
// Covers JS filesystem calls used here and by mounted backends, not native Win32 APIs.
for (const [syncName, asyncName, indexes] of [
  ['writeFileSync', 'writeFile', [0]], ['appendFileSync', 'appendFile', [0]],
  ['mkdirSync', 'mkdir', [0]], ['renameSync', 'rename', [0, 1]], ['linkSync', 'link', [0, 1]],
  ['unlinkSync', 'unlink', [0]], ['rmSync', 'rm', [0]], ['truncateSync', 'truncate', [0]],
]) {
  const sync = fs[syncName];
  fs[syncName] = function (...args) { indexes.forEach(i => inside(args[i])); return sync.apply(this, args); };
  const asynchronous = fs.promises[asyncName];
  fs.promises[asyncName] = async function (...args) {
    indexes.forEach(i => inside(args[i]));
    if (asyncName === 'rename' && String(args[1]).includes('session_teams')) {
      if (faults.failNextCoordRename || faults.failCoordRenames) { faults.failNextCoordRename = false; faults.renameFailures++; throw Object.assign(Error('10-injected pre-publish failure'), { code: 'EIO' }); }
      if (faults.holdNextCoordRename) {
        const barrier = faults.holdNextCoordRename; faults.holdNextCoordRename = null;
        barrier.entered.resolve(); await timeout(barrier.release.promise, 'coordination publish barrier');
      }
    }
    return asynchronous.apply(this, args);
  };
}
for (const [owner, name] of [[fs, 'openSync'], [fs.promises, 'open']]) {
  const open = owner[name];
  owner[name] = function (file, flags, ...args) { if (typeof flags !== 'string' || /[wa+]/.test(flags)) inside(file); return open.call(this, file, flags, ...args); };
}
const rejectNetwork = (...args) => { audit.networkAttempts.push(String(args[0] ?? 'unknown')); throw Error('Network disabled in patch-2 fixtures.'); };
globalThis.fetch = rejectNetwork;
require('node:net').Socket.prototype.connect = rejectNetwork;
require('node:http').request = rejectNetwork;
require('node:https').request = rejectNetwork;
syncBuiltinESMExports();
const { Context } = load('@deepseek-ai/cordis');
const { LlmAdapter, createUserMessage } = load('@deepseek-ai/dsh-llm');
const { Peer } = load('@deepseek-ai/dsh-client-connection');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function timeout(promise, label, ms = 7000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Timed out: ' + label)), ms); })]).finally(() => clearTimeout(timer));
}
async function drain() { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); }
class ScriptedAdapter extends LlmAdapter {
  calls = []; script = [];
  async *stream(options) {
    assert.equal(options.provider, '10-scripted'); assert.equal(options.model, '10-fixture');
    this.calls.push({ sessionId: options.sessionId, messages: structuredClone(options.messages), tools: structuredClone(options.tools ?? []) });
    let action = this.script.shift(); if (typeof action === 'function') action = await action(options); if (!action) throw Error('Unexpected scripted model request.');
    if (action.entered) action.entered.resolve(); if (action.wait) await timeout(action.wait, 'model barrier');
    const block = action.tool ? { type: 'tool-call', ...action.tool } : { type: 'text', text: action.text ?? 'Fixture response.' };
    yield { type: 'block-start', index: 0, blockType: block.type };
    if (action.tool) yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments };
    else yield { type: 'text-delta', index: 0, text: block.text };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'finish', reason: { kind: action.tool ? 'tool-calls' : 'stop' } };
  }
}
async function mount(ctx, name, config) { const mod = load('@deepseek-ai/' + name); return await ctx.plugin(mod.default ?? mod, config); }
async function createWorld(storageRoot, { coordination = true, autoReview = false } = {}) {
  const ctx = new Context(), adapter = new ScriptedAdapter();
  try {
    for (const name of ['dsh-session', 'dsh-session-projection', 'dsh-agent', 'dsh-llm', 'dsh-system-prompt', 'dsh-tools', 'dsh-tool-executor-native']) await mount(ctx, name);
    await mount(ctx, 'dsh-agent-loop', { agents: [], maxParallelToolCalls: 1 });
    ctx.llm.registerAdapter(['10-scripted'], adapter);
    await mount(ctx, 'dsh-storage');
    await mount(ctx, 'dsh-storage-json', { root: path.join(storageRoot, '10-domains') });
    await mount(ctx, 'dsh-storage-domain', { backend: 'json', routes: {} });
    await mount(ctx, 'dsh-session-persistence-jsonl', { root: path.join(storageRoot, '10-sessions'), compression: 'none' });
    await ctx.plugin(load('@deepseek-ai/dsh-session-query').SessionQueryEngine, {});
    await mount(ctx, 'dsh-session-title', { fallbackMaxWords: 12, fallbackMaxBytes: 120, maxTitleBytes: 1024 });
    await mount(ctx, 'dsh-workspace');
    await mount(ctx, 'dsh-typert-registry');
    await mount(ctx, 'dsh-api-remote-access');
    await mount(ctx, 'dsh-api-gateway');
    const world = { ctx, adapter, storageRoot, autoReview,
      owner: new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'none' }),
      outsider: new Peer(ctx, { principal: { kind: '10-guest' }, interactions: 'none' }),
      async mountCoordination() {
        const { pathToFileURL } = require('node:url');
        const plugin = (await import(pathToFileURL(path.join(root, 'index.js')).href)).default;
        world.coordinationFiber = await ctx.plugin(plugin);
        // Baseline regression setup only: explicitly confirm through the real owner RPC.
        if (world.autoReview) await reviewIfRequired(world);
      },
      async unmountCoordination() { if (world.coordinationFiber) { await world.coordinationFiber.dispose(); world.coordinationFiber = null; } },
      dispose: () => ctx.fiber.dispose() };
    if (coordination) await world.mountCoordination();
    return world;
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
async function createAgent(world, id) {
  const handle = await world.ctx.agents.create({ sessionId: id, meta: { cwd: root }, agentOptions: { provider: '10-scripted', model: '10-fixture' } });
  return { agent: handle.agent, handle };
}
function message(text) { return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }); }
let callNumber = 0;
async function resolveTool(world, agent, signal = new AbortController().signal) {
  return world.ctx.tools.resolve({ agent, modelSelection: { provider: '10-scripted', model: '10-fixture' }, signal });
}
async function rawTool(world, agent, request, toolSet, signal = new AbortController().signal) {
  const batch = await world.ctx.tools.execute({ calls: [{ type: 'tool-call', id: '10-call-' + (++callNumber), name: 'session_teams', arguments: JSON.stringify(request) }],
    signal, ...(agent ? { agent } : {}), ...(toolSet ? { toolSet } : {}) });
  return batch.results[0].result;
}
async function tool(world, agent, request, signal = new AbortController().signal) {
  const toolSet = agent ? await resolveTool(world, agent, signal) : null;
  try { return await rawTool(world, agent, request, toolSet, signal); } finally { toolSet?.dispose(); }
}
function nativeDenied(result, code = 'UNKNOWN_TOOL') {
  assert.equal(result.isError, true, JSON.stringify(result)); assert.equal(result.error.info?.code, code, JSON.stringify(result));
}
function ok(result) { assert.equal(result.isError, false, JSON.stringify(result)); return result.value; }
function denied(result, code) { assert.equal(result.isError, true, JSON.stringify(result)); assert.equal(result.error.info?.code, 'TEAMS_' + code, JSON.stringify(result)); }
async function remote(world, method, args, peer = world.owner, signal) {
  return world.ctx.typertGateway.invoke({ namespace: 'sessionTeams', method, args, peer, ...(signal ? { signal } : {}) });
}
async function ownerView(world) { return remote(world, 'inspect', { query: { type: 'snapshot' } }); }
function reviewOf(view) { return { type: 'review-startup', expectedRevision: view.state.revision, expectedGeneration: view.state.generation, reviewToken: view.reviewToken }; }
async function reviewIfRequired(world) {
  const view = await ownerView(world);
  return view.state.reviewRequired ? remote(world, 'administer', { command: reviewOf(view) }) : view;
}
async function inspect(world) { return (await ownerView(world)).state; }
async function admin(world, command) { const state = await inspect(world); return remote(world, 'administer', { command: { expectedRevision: state.revision, ...command } }); }
async function persistedSession(world, id) {
  const { SESSION_FORMAT_VERSION } = load('@deepseek-ai/dsh-session');
  const handle = await world.ctx.sessionPersistence.create({ id, version: SESSION_FORMAT_VERSION, createdAt: Date.now(), isSeeded: false, cwd: root });
  try { await handle.flush(); } finally { await handle.close(); }
}
function archiveFiles(dataRoot) {
  const absoluteRoot = fs.realpathSync(dataRoot);
  { const relative = path.relative(fs.realpathSync(runtime), absoluteRoot); assert(!relative.startsWith('..') && !path.isAbsolute(relative)); }
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'No symlinks allowed in owned test artifacts.');
      const source = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(source);
      else if (entry.isFile() && !entry.name.startsWith('10-')) {
        const target = path.join(dir, '10-' + entry.name);
        assert.equal(path.dirname(fs.realpathSync(source)), fs.realpathSync(dir)); assert(!fs.existsSync(target));
        inside(source); inside(target); fs.renameSync(source, target);
      }
    }
  }
  visit(absoluteRoot);
}
module.exports = { root, runtime, load, fs, path, assert, audit, faults, Context, deferred, timeout, drain,
  mount, createWorld, createAgent, message, tool, rawTool, resolveTool, nativeDenied, ok, denied, remote, inspect,
  ownerView, reviewOf, reviewIfRequired, admin, persistedSession, archiveFiles };
