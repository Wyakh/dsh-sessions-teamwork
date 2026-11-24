'use strict';
// Actual installed Native Agent loop/JSONL; thin proposed admission protocol, not v5 adapter end-to-end.
const F = require('./dsh-fixture.cjs');
const { assert, fs, path, root, runtime, load } = F;
const { freezeMessage } = load('@deepseek-ai/dsh-llm');
const dataRoot = fs.mkdtempSync(path.join(runtime, '10-wake-native-'));
const results = { suite: '10-wake-native', scope: 'Actual installed Agent loop, identified inbox, maintenance and JSONL. Proposed admission wrapper only; production adapter is not exercised.', tests: [] };
function own(id, text = 'Review current recorded team work.') {
  return freezeMessage({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'session-teams', form: 'notice', summary: 'Recorded team work is ready', wakeIds: [id] } });
}
async function check(name, fn) {
  try { const evidence = await fn(); results.tests.push({ name, status: 'passed', evidence }); console.log('PASS ' + name); }
  catch (error) { results.tests.push({ name, status: 'failed', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
async function flush(w, agent) { assert.equal(await w.ctx.sessions.flush(agent.session), true); }
function surfaceText(messages) { return messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n'); }
(async () => {
  const w = await F.createWorld(dataRoot, { coordination: false });
  try {
    await check('Native non-user producer source and stable message identity survive actual committed JSONL reopen', async () => {
      const { agent, handle } = await F.createAgent(w, '10-wake-source'); const message = own('session-teams-10-stable-source');
      let humans = 0; const off = w.ctx.on('agent/inbox/inserted', event => { if (event.agent === agent && event.message.source.kind === 'user') humans++; }, { global: true });
      const before = w.adapter.calls.length; w.adapter.script.push({ text: 'Native custom-source receipt.' }); agent.followup(message);
      await F.timeout(agent.whenIdle(), 'custom source turn'); await flush(w, agent); off(); assert.equal(humans, 0);
      assert.equal(w.adapter.calls.length - before, 1); assert.equal(agent.session.deriveMessages().find(m => m.id === message.id).source.kind, 'session-teams');
      await handle.dispose(); const reader = await w.ctx.sessionPersistence.open(agent.id, 'read');
      let stored; try { stored = await reader.read(0); } finally { await reader.close(); }
      const insertion = stored.events.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.id === message.id));
      const visible = stored.events.find(event => event.type === 'user/message' && event.data.id === message.id);
      assert.deepEqual(insertion.data.inserted.find(m => m.id === message.id), message); assert.deepEqual(visible.data, message);
      return { stableId: message.id, sourceKind: visible.data.source.kind, committedInsertionAndSurface: true, humanFocusTriggers: humans, intentionalScriptedRequests: 1 };
    });
    await check('Native maintenance holds followup through real flush and acknowledgment before allowing a model request', async () => {
      const { agent } = await F.createAgent(w, '10-wake-admit'); const entered = F.deferred(), release = F.deferred(), before = w.adapter.calls.length;
      w.adapter.script.push({ text: 'Admitted only after maintenance.' });
      const task = agent.runMaintenance(async () => {
        agent.followup(own('session-teams-10-admit')); assert.equal(agent.status, 'idle'); assert.equal(w.adapter.calls.length, before);
        await flush(w, agent); entered.resolve(); await release.promise; assert.equal(w.adapter.calls.length, before);
      });
      try { await F.timeout(entered.promise, 'maintenance flushed'); assert.equal(agent.inbox.nextTurn.length, 1); assert.throws(() => agent.runMaintenance(async () => {}), /active work/); }
      finally { release.resolve(); }
      await F.timeout(task, 'maintenance admission'); await F.timeout(agent.whenIdle(), 'admitted turn');
      assert.equal(w.adapter.calls.length - before, 1); return { noModelBeforeDurableFlushAndAdmission: true, maintenanceCannotReenterDespiteIdleStatus: true, intentionalScriptedRequests: 1 };
    });
    await check('Human input arriving during a held flush removes only own queued wake and runs untouched human input', async () => {
      const { agent } = await F.createAgent(w, '10-wake-human-race'); const entered = F.deferred(), release = F.deferred(), before = w.adapter.calls.length;
      const nativeFlush = w.ctx.sessions.flush; let intercept = true, focus = false, focusMessage;
      const off = w.ctx.on('agent/inbox/inserted', event => { if (event.agent === agent && event.message.source.kind === 'user') { focus = true; focusMessage = event.message.id; } }, { global: true });
      w.ctx.sessions.flush = async function(session) { if (session === agent.session && intercept) { intercept = false; entered.resolve(); await release.promise; } return nativeFlush.call(this, session); };
      const message = own('session-teams-10-held-by-human'); w.adapter.script.push({ text: 'Answering only the human discussion.' });
      const task = agent.runMaintenance(async () => {
        assert.equal(focus, false); agent.followup(message); await flush(w, agent);
        if (focus) { assert.equal(agent.inbox.remove(message.id), true); await flush(w, agent); }
      });
      let human;
      try { await F.timeout(entered.promise, 'held Native flush'); human = F.message('Please discuss this with me first.'); agent.followup(human); assert.equal(focusMessage, human.id); assert.equal(w.adapter.calls.length, before); }
      finally { release.resolve(); }
      try { await F.timeout(task, 'focused maintenance'); await F.timeout(agent.whenIdle(), 'human after held wake'); }
      finally { w.ctx.sessions.flush = nativeFlush; off(); }
      assert.equal(w.adapter.calls.length - before, 1); const nativeRequest = w.adapter.calls[before];
      assert(nativeRequest.messages.some(m => m.id === human.id && m.source.kind === 'user')); assert(!nativeRequest.messages.some(m => m.id === message.id));
      assert(!surfaceText(nativeRequest.messages).includes('Review current recorded team work.')); assert.equal(agent.inbox.nextTurn.length, 0);
      const discard = agent.session.snapshotEvents().find(e => e.type === 'agent/inbox/spliced' && e.data.removedCount === 1 && e.data.inserted.length === 0);
      assert(discard); return { humanSourcePreserved: true, ownWakeNotModelVisible: true, noPreStepVeto: true, noHumanStranded: true, intentionalScriptedRequests: 1 };
    });
    await check('Canceling only own pending wake in maintenance without human input starts no model turn', async () => {
      const { agent } = await F.createAgent(w, '10-wake-cancel'); const before = w.adapter.calls.length;
      await agent.runMaintenance(async () => { const message = own('session-teams-10-cancel'); agent.followup(message); await flush(w, agent); assert(agent.inbox.remove(message.id)); await flush(w, agent); });
      await F.drain(); assert.equal(agent.status, 'idle'); assert.equal(w.adapter.calls.length, before); assert.equal(agent.inbox.nextTurn.length, 0);
      return { noModelRequests: true, nativePendingQueueEmpty: true, intentionalScriptedRequests: 0 };
    });
    await check('Already-running Native work rejects maintenance; wake protocol need not steer or cancel it', async () => {
      const { agent } = await F.createAgent(w, '10-wake-busy'); const entered = F.deferred(), release = F.deferred(), before = w.adapter.calls.length;
      w.adapter.script.push({ entered, wait: release.promise, text: 'Existing Native work finished.' }); agent.followup(own('session-teams-10-busy-original'));
      try { await F.timeout(entered.promise, 'busy model'); assert.equal(agent.status, 'running'); assert.throws(() => agent.runMaintenance(async () => {}), /active work/); assert.equal(agent.inbox.nextTurn.length, 0); }
      finally { release.resolve(); }
      await F.timeout(agent.whenIdle(), 'original busy work'); assert.equal(w.adapter.calls.length - before, 1);
      return { originalTurnNotCanceledOrSteered: true, noExtraQueuedInput: true, intentionalScriptedRequests: 1 };
    });
    await check('Flush throw/false or host receipt failure cannot release an unadmitted own wake from maintenance finally', async () => {
      const before = w.adapter.calls.length, tested = [];
      for (const fault of ['flush-throw', 'flush-false', 'host-receipt']) {
        const { agent } = await F.createAgent(w, '10-wake-fault-' + fault), nativeFlush = w.ctx.sessions.flush;
        let intercepted = false, admitted = false; const message = own('session-teams-10-' + fault);
        w.ctx.sessions.flush = async function(session) {
          if (session === agent.session && !intercepted && fault !== 'host-receipt') { intercepted = true; if (fault === 'flush-throw') throw Error('10-native-flush-failure'); return false; }
          return nativeFlush.call(this, session);
        };
        try {
          await assert.rejects(agent.runMaintenance(async () => {
            try { agent.followup(message); await flush(w, agent); if (fault === 'host-receipt') throw Error('10-host-receipt-failure'); admitted = true; }
            finally { if (!admitted && agent.inbox.remove(message.id)) await flush(w, agent); }
          }));
          await F.drain(); assert.equal(agent.status, 'idle'); assert.equal(agent.inbox.nextTurn.length, 0); assert.equal(w.adapter.calls.length, before);
          tested.push(fault);
        } finally { w.ctx.sessions.flush = nativeFlush; }
      }
      return { injectedAcknowledgmentFailures: tested, cleanupBeforeMaintenanceExit: true, ownInputNeverRuns: true, intentionalScriptedRequests: 0 };
    });
    await check('Public cold controller resolves exact ordinary Session with recorded selected Native preset and cwd without a model call', async () => {
      const { mountNativeController, persistColdOrdinarySession } = require('./controller-fixture.cjs');
      await mountNativeController(w);
      const id = '10-wake-cold-controller', before = w.adapter.calls.length;
      const { events } = await persistColdOrdinarySession(w, id, { headerPreset: '10-old-unavailable-preset', events: [
        ['sandbox/mode', { mode: 'read-only' }], ['approval/policy', { policy: 'never' }],
      ] });
      const [a, b] = await Promise.all([w.ctx.sessionController.resolveAgent(id), w.ctx.sessionController.resolveAgent(id)]);
      if ('error' in a) throw a.error; if ('error' in b) throw b.error;
      assert.equal(a.agent, b.agent); assert.equal(a.agent.id, id); assert.equal(a.agent.session.header.cwd, dataRoot);
      assert.equal(w.ctx.agentPresets.presetForSession(a.agent.session), '10-worker-selected-preset');
      const compositions = w.ctx.agentPresets.inspectCompositions(a.agent.ctx);
      assert(compositions.some(item => item.id === '10-worker-selected-preset'), JSON.stringify(compositions));
      assert(!compositions.some(item => item.id === '10-manager-default-preset'));
      assert.deepEqual(a.agent.session.snapshotEvents().filter(e => ['sandbox/mode', 'approval/policy'].includes(e.type)).map(e => [e.type, e.data]), events.slice(1).map(e => [e.type, e.data]));
      assert.equal(w.adapter.calls.length, before); assert.equal(a.agent.status, 'idle');
      return { exactSessionId: id, concurrentResumesShareAgent: true, recordedSelectedPresetBound: true, headerAndHostDefaultPresetNotUsed: true, cwdPreserved: true, noPermissionEventsAdded: true, noModelRequests: true, noProfileLoaderOrHTTPServer: true };
    });
    await check('Serial Native created cleanup removes only restored own producer inputs and does not wake or consume restored human input', async () => {
      const { persistColdOrdinarySession } = require('./controller-fixture.cjs');
      const id = '10-wake-cold-pending', before = w.adapter.calls.length, message = own('session-teams-10-before-restart'), human = F.message('Unprocessed real human input from before restart.');
      await persistColdOrdinarySession(w, id, { events: [
        ['agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [message, human] }],
      ] });
      let removed = 0;
      const off = w.ctx.on('agent/created', async ({ agent }) => {
        if (agent.id !== id) return;
        for (const item of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) if (item.source.kind === 'session-teams') removed += Number(agent.inbox.remove(item.id));
        await flush(w, agent);
      }, { global: true });
      let found; try { found = await w.ctx.sessionController.resolveAgent(id); } finally { off(); }
      if ('error' in found) throw found.error;
      assert.equal(removed, 1); assert.deepEqual(found.agent.inbox.nextTurn.map(item => item.id), [human.id]);
      assert.equal(found.agent.status, 'idle'); assert.equal(w.adapter.calls.length, before);
      const discards = found.agent.session.snapshotEvents().filter(e => e.type === 'agent/inbox/spliced' && e.data.removedCount);
      assert.equal(discards.length, 1); assert.equal(discards[0].data.removedCount, 1);
      return { obsoleteOwnInputRemovedBeforeInitializationRelease: true, restoredHumanIdPreserved: true, noImplicitResumeReplay: true, noModelRequests: true };
    });
    results.modelRequests = w.adapter.calls.length;
  } finally { await w.dispose(); }
  F.archiveFiles(dataRoot); results.networkAttempts = F.audit.networkAttempts; results.outsideTestMutations = F.audit.fileMutations.filter(p => !require('./paths.cjs').ownedMutation(p));
  assert.deepEqual(results.networkAttempts, []); assert.deepEqual(results.outsideTestMutations, []);
  results.passed = results.tests.filter(test => test.status === 'passed').length; results.failed = results.tests.length - results.passed;
  fs.writeFileSync(require('./paths.cjs').resultPath('wake-native'), JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.passed}/${results.tests.length} focused Native wake lifecycle checks passed`); if (results.failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });


