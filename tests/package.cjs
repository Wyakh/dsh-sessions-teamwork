'use strict';
// Distribution/source checks only. Packing/install acceptance is a separate release gate.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { root: pkg, resultPath } = require('./paths.cjs');
const baseline = require('./baseline-hashes.json');
const deny = () => { throw Error('Network is disabled in package checks.'); };
globalThis.fetch = deny; require('node:net').Socket.prototype.connect = deny; require('node:http').request = deny; require('node:https').request = deny; require('node:module').syncBuiltinESMExports();
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const results = { version: manifest.version, tests: [], sourceHashes: {}, installationAttempted: false, actualNpmPackPerformed: false };
const runtimeFiles = ['index.js', 'client.cjs', 'lib/adapter.cjs', 'lib/core.cjs', 'lib/legacy-v2.cjs', 'lib/legacy-v3.cjs', 'lib/legacy-v4.cjs', 'lib/legacy-v5.cjs', 'lib/environment.cjs', 'lib/wake.cjs'];
function test(name, body) { try { body(); results.tests.push({ name, status: 'passed' }); console.log('PASS ' + name); } catch (error) { results.tests.push({ name, status: 'failed', error: error.stack }); console.error(error.stack); } }
function pinned(file) { assert.equal(hash(fs.readFileSync(path.join(pkg, file))), baseline.sourceHashes[file], 'Immutable V0.5.2 runtime baseline: ' + file); }
test('V0.6 manifest, exports and exact optional shared runtime peers', () => {
  assert.equal(manifest.version, '0.6.0'); assert.equal(manifest.type, 'module'); assert.equal(manifest.engines.dsh, baseline.runtime); assert.equal(manifest.license, 'MIT'); assert.equal(manifest.private, true);
  assert.equal(manifest.exports['.'], './index.js'); assert.equal(manifest.exports['./client'], './client.cjs'); assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web'); assert.equal(manifest.dsh.client.immediately, true); assert(!manifest.scripts && !manifest.dependencies && !manifest.optionalDependencies);
  const peers = { '@deepseek-ai/cordis': '4.1.0', '@deepseek-ai/dsh-storage-domain': '0.2.2-rc.5', '@deepseek-ai/dsh-llm': '0.2.2-rc.5', '@deepseek-ai/dsh-typert-protocol': '0.2.2-rc.5', '@deepseek-ai/dsh-workspace': '0.2.2-rc.5', '@deepseek-ai/dsh-session': '0.2.2-rc.5', zod: '4.6.6' };
  assert.deepEqual(manifest.peerDependencies, peers); for (const name of Object.keys(peers)) assert.equal(manifest.peerDependenciesMeta[name].optional, true);
});
test('Production import graph is local/native with one bounded native wake boundary', () => {
  for (const file of runtimeFiles.filter(file => file.startsWith('lib/'))) {
    const source = fs.readFileSync(path.join(pkg, file), 'utf8'); results.sourceHashes[file] = hash(source);
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const request = match[1];
      if (request.startsWith('.')) { const target = path.resolve(pkg, path.dirname(file), request), relative = path.relative(pkg, target); assert(!relative.startsWith('..') && !path.isAbsolute(relative)); assert(fs.statSync(target).isFile()); }
      else if (!request.startsWith('node:')) assert(Object.hasOwn(manifest.peerDependencies, request), 'Undeclared runtime peer: ' + request);
    }
    assert(!source.includes('DSH_INSTALL_DIR') && !source.includes('NODE_PATH')); assert(!/require\([^\n]*(?:1-core|1-contract|3-authority|4-session)/.test(source));
    if (file !== 'lib/wake.cjs') assert(!/\.(?:followup|inject|input)\s*\(/.test(source));
    else { assert(source.includes('runMaintenance')); assert(source.includes('sessions.flush')); assert(!/\.agents\.(?:create|resume)\(/.test(source)); assert(!source.includes('agent.inject(')); }
  }
  const { domainSpec, actionSchema } = require('../lib/adapter.cjs'); assert.equal(domainSpec.name, 'session_teams_v2'); assert.equal(domainSpec.version, 2);
  assert(!/(?:capabilityCeiling|mandateScopes|grantScopes|allowedScopes)/.test(JSON.stringify(actionSchema)));
});
test('Production resources and public guidance are local, explicit and present', () => {
  for (const file of [...runtimeFiles, 'cordis.patch.yml', 'README.md', 'icon.svg', 'LICENSE']) { assert(manifest.files.includes(file) || (file.startsWith('lib/') && manifest.files.includes('lib')), 'Missing distribution entry: ' + file); const target = path.join(pkg, file); assert(fs.statSync(target).isFile()); assert(!fs.lstatSync(target).isSymbolicLink()); results.sourceHashes[file] = hash(fs.readFileSync(target)); }
  for (const file of ['INSTALL.md', 'BEHAVIOR.md', 'VERIFICATION.md']) { assert(fs.statSync(path.join(pkg, 'docs', file)).isFile()); assert(manifest.files.includes('docs') || manifest.files.includes('docs/' + file)); }
  const behavior = fs.readFileSync(path.join(pkg, 'docs/BEHAVIOR.md'), 'utf8'); assert.match(behavior, /After a user interruption, remain With user/); assert.match(behavior, /If intent is unclear, ask once/);
  for (const file of ['producer-contract.json', 'validator-contract.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/contracts', file), 'utf8')).payload.requiredProperty, 'greeting');
  assert(manifest.files.includes('locale/*.json') || manifest.files.includes('locale')); assert.equal(manifest.exports['./locale/*.json'], './locale/*.json'); assert.equal(manifest.exports['./icon'], './icon.svg');
  for (const language of ['en', 'zh']) { const locale = JSON.parse(fs.readFileSync(path.join(pkg, 'locale', language + '.json'), 'utf8')); assert(locale.meta.title.trim()); assert(locale.meta.description.trim()); }
  const svg = fs.readFileSync(path.join(pkg, 'icon.svg'), 'utf8'); assert(Buffer.byteLength(svg) <= 256 * 1024); assert(/<svg\b[^>]*width="36"[^>]*height="36"[^>]*viewBox="0 0 36 36"/.test(svg)); assert(!/<(?:script|image|foreignObject|style|text)\b|\b(?:href|onload|onclick)\s*=|<!DOCTYPE/i.test(svg)); pinned('icon.svg');
});
test('Pinned migration sources retain exact validated legacy bytes without sibling repositories', () => {
  for (const file of ['lib/legacy-v2.cjs', 'lib/legacy-v3.cjs', 'lib/legacy-v4.cjs', 'lib/environment.cjs']) pinned(file);
  assert.equal(baseline.baselineVersion, '0.5.2'); assert.equal(baseline.innerSchema, 6);
});
test('Pinned V5 migration source retains exact validated bytes', () => {
  pinned('lib/legacy-v5.cjs');
  const Core = require('../lib/core.cjs'), Legacy = require('../lib/legacy-v5.cjs'); const old = Legacy.initialState(), before = JSON.stringify(old);
  const upgraded = Core.upgradeV5(old); assert.equal(JSON.stringify(old), before); assert.equal(upgraded.schemaVersion, baseline.innerSchema); assert.deepEqual(upgraded.dispatches, []);
});
test('Bounded accepted-decision excerpts disclose omitted coalesced decisions with exact recovery ID', () => {
  const { WakeDelivery } = require('../lib/wake.cjs'); const delivery = Object.create(WakeDelivery.prototype), candidates = []; delivery.runtime = { snapshot: { proposals: [] } };
  for (let i = 0; i < 12; i++) { const proposalId = 'proposal-' + i; delivery.runtime.snapshot.proposals.push({ id: proposalId, teamId: 't', revisions: [{ revision: 1, text: '😀'.repeat(2000) }] }); candidates.push({ teamId: 't', reason: 'continuation', refs: { proposalId, proposalRevision: 1, assignmentRevision: 1 } }); }
  const text = delivery.continuationContext(candidates, 'exact-native-attempt'); assert(Buffer.byteLength(text, 'utf8') < 6500); assert.match(text, /11 additional accepted/); assert.match(text, /exact-native-attempt/); assert.match(text, /Before acting/); assert.match(text, /delivery for your active teams/); assert.match(text, /cached assignment text alone is NOT sufficient/); assert.equal(delivery.continuationContext([], 'empty'), '');
});
test('V0.6 is a packaging-only release of the pinned V0.5.2 runtime', () => {
  for (const file of ['client.cjs', 'index.js', 'cordis.patch.yml', 'lib/adapter.cjs', 'lib/core.cjs', 'lib/wake.cjs']) pinned(file);
});
test('Combined reassessment evidence stays bounded with explicit omitted evidence recovery', () => {
  const { WakeDelivery } = require('../lib/wake.cjs');
  for (const text of ['😀'.repeat(2000), '"'.repeat(2000), 'x'.repeat(2000), '\\u0001'.repeat(2000)]) {
    const delivery = Object.create(WakeDelivery.prototype), candidates = [], snapshot = { generation: 1, teams: [{ id: 't', status: 'active', managerId: 'm', memberIds: ['w'], epoch: 1, tenures: { m: 1, w: 1 }, assignments: [{ targetId: 'w', status: 'current', generation: 1, epoch: 1, tenure: 1, revision: 1, workStatus: 'waiting' }] }], proposals: [], messages: [] }; delivery.runtime = { snapshot };
    for (let i = 0; i < 12; i++) { const proposalId = 'p' + i, messageId = 'h' + i; snapshot.proposals.push({ id: proposalId, teamId: 't', revisions: [{ revision: 1, text }] }); snapshot.messages.push({ id: messageId, teamId: 't', authorId: 'm', text }); const common = { teamId: 't', sessionId: 'w', generation: 1, epoch: 1, tenure: 1 }; candidates.push({ ...common, reason: 'continuation', refs: { proposalId, proposalRevision: 1, assignmentRevision: 1 } }, { ...common, reason: 'handoff', refs: { messageId, assignmentRevision: 1 } }); }
    const evidence = delivery.eventContext(candidates, 'exact-combined-attempt'); assert(Buffer.byteLength(evidence, 'utf8') < 6500); assert.match(evidence, /REASSESSMENT ONLY/); assert.match(evidence, /exact-combined-attempt/); assert.match(evidence, /handoff\/required-reply excerpt/); assert.match(evidence, /additional accepted/); assert.match(evidence, /Before acting/);
  }
});
test('All production JavaScript passes native syntax checks; Client imports only browser React', () => {
  for (const file of runtimeFiles) { const child = spawnSync(process.execPath, ['--check', path.join(pkg, file)], { env: process.env, stdio: ['ignore', 'ignore', 'inherit'] }); assert.ifError(child.error); assert.equal(child.status, 0, file); }
  const client = fs.readFileSync(path.join(pkg, 'client.cjs'), 'utf8'); assert.deepEqual([...client.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1]), ['react']); assert(!client.includes('dangerouslySetInnerHTML')); assert.equal(typeof require('../client.cjs')(require).apply, 'function');
});
(async () => {
  try { const plugin = (await import(pathToFileURL(path.join(pkg, 'index.js')).href)).default; assert.strictEqual(plugin, require('../lib/adapter.cjs').SessionTeams); results.tests.push({ name: 'Package ESM default is exactly the native-tested Host Service', status: 'passed' }); }
  catch (error) { results.tests.push({ name: 'Package ESM default is exactly the native-tested Host Service', status: 'failed', error: error.stack }); }
  results.passed = results.tests.filter(test => test.status === 'passed').length; results.failed = results.tests.length - results.passed; fs.writeFileSync(resultPath('package'), JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify({ passed: results.passed, failed: results.failed })); if (results.failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
