'use strict';
// Reusable actual installed public SessionController + real Native preset composition.
// Isolated F.createWorld only. Memory Loader, no Include/config/profile reader or HTTP server.
const F = require('./dsh-fixture.cjs');
const { pathToFileURL } = require('node:url');
const { load, path, assert } = F;
async function mountNativeController(world, { defaultPreset = '10-manager-default-preset', presets = ['10-worker-selected-preset'] } = {}) {
  const { ctx } = world;
  assert(!ctx.get('sessionController'), 'Mount this isolated Native composition only once.');
  assert(!ctx.get('loader') && !ctx.get('agentPresets'), 'Do not use fixture helper against a pre-existing profile Loader or preset registry.');
  await F.mount(ctx, 'cordis-plugin-loader', { baseUrl: pathToFileURL(__filename).href });
  await F.mount(ctx, 'dsh-agent-preset-registry', { default: defaultPreset });
  const disposers = [];
  for (const id of new Set([defaultPreset, ...presets])) disposers.push(await ctx.agentPresets.register({ id, plugins: [] }));
  ctx.effect(() => async () => { for (const dispose of disposers.reverse()) await dispose(); }, '10-native-proof-preset-registrations');
  await F.mount(ctx, 'dsh-agent-default-model', { provider: '10-scripted', model: '10-fixture' });
  await F.mount(ctx, 'dsh-fs-local', { cwd: world.storageRoot });
  await F.mount(ctx, 'dsh-attachment-local', { dshHome: path.join(world.storageRoot, '10-attachment-home') });
  await F.mount(ctx, 'dsh-commands');
  const { HostConnectionService } = load('@deepseek-ai/dsh-client-connection');
  // Real carrier registry, no browser admission calls/HTTP listener/authentication under test.
  await ctx.plugin({ name: '10-native-proof-memory-connection', apply(child) { new HostConnectionService(child, [], undefined); } });
  await F.mount(ctx, 'dsh-client-file-upload');
  await F.mount(ctx, 'dsh-api-session-controller', { nativeOpen: false });
  return { controller: ctx.sessionController, defaultPreset, presets: [...new Set([defaultPreset, ...presets])] };
}
async function persistColdOrdinarySession(world, id, { cwd = world.storageRoot, preset = '10-worker-selected-preset', headerPreset = preset, events = [] } = {}) {
  const { SESSION_FORMAT_VERSION } = load('@deepseek-ai/dsh-session');
  const header = { id, version: SESSION_FORMAT_VERSION, createdAt: Date.now(), isSeeded: false, cwd, ...(headerPreset === undefined ? {} : { agentPreset: headerPreset }) };
  const entries = [...(preset === undefined ? [] : [['agent-preset/selected', { agentPreset: preset }]]), ...events];
  const records = entries.map(([type, data], seq) => ({ type, data, seq, time: Date.now() }));
  const writer = await world.ctx.sessionPersistence.create(header);
  try { if (records.length) await writer.append(records); await writer.flush(); } finally { await writer.close(); }
  assert.equal(world.ctx.agents.get(id), undefined); assert.equal(world.ctx.sessions.get(id), undefined);
  return { header, events: records };
}
module.exports = { mountNativeController, persistColdOrdinarySession };
