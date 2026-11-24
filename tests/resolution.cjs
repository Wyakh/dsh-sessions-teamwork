'use strict';
// Actual installed resolver, fresh process, relocated package; NOT a physical profile installation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (process.argv[2] !== '--child') {
  const env = { ...process.env }; delete env.NODE_PATH;
  const child = require('node:child_process').spawnSync(process.execPath, [__filename, '--child'], { env, stdio: 'inherit', timeout: 30000 });
  assert.ifError(child.error); process.exitCode = child.status ?? 1;
} else {
  assert.equal(process.env.NODE_PATH, undefined);
  const F = require('./dsh-fixture.cjs');
  const { pathToFileURL } = require('node:url');
  const { createRuntimeResolution, PluginPackages } = F.load('@deepseek-ai/dsh-app-boot');
  const source = require('./paths.cjs').root;
  const archivePackage = process.env.TEAMWORK_PACKAGE_ROOT;
  const ownedRoot = path.join(F.runtime, '10-resolution-' + require('node:crypto').randomUUID());
  const relocated = archivePackage ? fs.realpathSync(archivePackage) : path.join(ownedRoot, 'relocated-package');
  const files = ['package.json', 'index.js', 'lib/adapter.cjs', 'lib/core.cjs', 'lib/legacy-v2.cjs', 'lib/legacy-v3.cjs', 'lib/legacy-v4.cjs', 'lib/legacy-v5.cjs', 'lib/environment.cjs', 'lib/wake.cjs'];
  if (!archivePackage) for (const file of files) { const target = path.join(relocated, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, fs.readFileSync(path.join(source, file))); }
  (async () => {
    const table = await createRuntimeResolution({ installAnchor: path.join(process.env.DSH_INSTALL_DIR, 'package.json'), home: path.join(ownedRoot, 'unused-home') });
    const resolution = { profilesDir: table.profilesDir, profileDir: undefined, localPackageNames: [], entries: table.entries, linkedRoots: [{ name: '@local/session-coordination', realPath: relocated }] };
    const world = await F.createWorld(path.join(ownedRoot, '10-world'), { coordination: false });
    try {
      await world.ctx.plugin(PluginPackages, { resolution });
      const loadHere = require('node:module').createRequire(path.join(relocated, 'package.json'));
      const manifest = JSON.parse(fs.readFileSync(path.join(relocated, 'package.json'), 'utf8')), resolved = {};
      for (const name of Object.keys(manifest.peerDependencies)) { assert.strictEqual(loadHere(name), F.load(name), 'Must share installed runtime package: ' + name); resolved[name] = path.relative(process.env.DSH_INSTALL_DIR, loadHere.resolve(name)).split(path.sep).join('/'); }
      const plugin = (await import(pathToFileURL(path.join(relocated, 'index.js')).href)).default; await world.ctx.plugin(plugin);
      assert.deepEqual((await F.ownerView(world)).state.sessions, []);
      const manager = (await F.createAgent(world, '10-resolution-manager')).agent, worker = (await F.createAgent(world, '10-resolution-worker')).agent;
      await F.admin(world, { type: 'save-team', teamId: '10-resolution-team', title: 'Resolver proof', description: '', managerId: manager.id, memberIds: [worker.id] });
      const own = F.ok(await F.tool(world, manager, { action: 'read', query: { type: 'own-record' } })); assert.equal(own.session.id, manager.id);
      assert.equal(world.ctx.sessionTeams.runtime.domain.name, 'session_teams_v2'); assert.equal(world.adapter.calls.length, 0); assert.deepEqual(F.audit.networkAttempts, []);
      const proof = { passed: true, nodePathAbsent: true, packageLocation: archivePackage ? 'externally-installed-archive' : 'isolated-relocated-source', archivePackageProvided: Boolean(archivePackage), actualInstalledResolver: true, syntheticLinkedRoot: true,
        physicalProfileReadOrChanged: false, packageDefaultMounted: true, ownerSetup: true, nativeParticipantTool: true, modelRequests: 0, resolved, networkAttempts: F.audit.networkAttempts };
      fs.writeFileSync(require('./paths.cjs').resultPath(archivePackage ? 'resolution-archive' : 'resolution'), JSON.stringify(proof, null, 2) + '\n');
      console.log('PASS relocated v5 Host shares real installed runtime without NODE_PATH; owner setup and native tool work.');
    } finally { await world.dispose(); }
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
