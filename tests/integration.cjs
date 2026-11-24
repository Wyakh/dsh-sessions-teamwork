'use strict';
// Production v0.5.2 adapter/wake/Core through actual installed Native services and deterministic model streams.
const F = require('./dsh-fixture.cjs');
const { assert, fs, path, root, runtime, load } = F;
const C = require('./controller-fixture.cjs');
const H = require('./native-helper.cjs');
const dataRoot = fs.mkdtempSync(path.join(runtime, '10-integration-'));
const results = { suite: '10-production-integration', scope: 'Real production v0.5.2 package, actual installed Native Tool/Agent/JSONL/storage/controller services, scripted model only, no profile or network.', tests: [] };
let caseId = 0, callId = 0;
const state = w => w.ctx.sessionTeams.runtime.ledger();
const rt = w => w.ctx.sessionTeams.runtime;
const task = (w, id) => state(w).teams.find(t => t.id === '10-team').assignments.find(a => a.targetId === id && a.status === 'current');
const guard = a => ({ assignmentRevision: a.revision, assignmentVersion: a.version });
const command = (w, agent, command) => F.tool(w, agent, { action: 'execute', command });
const write = (w, agent, c) => command(w, agent, c).then(F.ok);
// Legacy scenarios reuse exact native-recorded prepare/confirm setup, not a production dispatch bypass.
const batch = (w, fields) => H.dispatch(w, fields);
const saveTeam = (w, members = [w.worker.id, w.other.id]) => F.admin(w, { type: 'save-team', teamId: '10-team', title: 'Outcome collaboration', description: 'Report-trusting independent workers.', managerId: w.manager.id, memberIds: members });
const action = c => ({ tool: { id: '10-e2e-call-' + (++callId), name: 'session_teams', arguments: JSON.stringify({ action: 'execute', command: c }) } });
function value(options) { const m = options.messages.filter(m => m.role === 'tool').at(-1); assert(m && !m.isError, JSON.stringify(m)); return JSON.parse(m.content.filter(b => b.type === 'text').map(b => b.text).join('')); }
function route(w, bySession) {
  const queues = new Map(Object.entries(bySession).map(([id, items]) => [id, [...items]]));
  const count = [...queues.values()].reduce((sum, items) => sum + items.length, 0);
  const next = async options => { const queue = queues.get(options.sessionId); assert(queue?.length, 'Unplanned model request for ' + options.sessionId); const item = queue.shift(); return typeof item === 'function' ? item(options) : item; };
  w.adapter.script.push(...Array(count).fill(next)); return () => { assert([...queues.values()].every(q => !q.length), 'Expected model actions were not consumed: ' + JSON.stringify([...queues].map(([id, q]) => [id, q.length]))); };
}
async function settle(w, label = 'production wake quiescence') {
  for (let i = 0; i < 16; i++) {
    await rt(w).tail; if (rt(w).delivery.running) await F.timeout(rt(w).delivery.running, label);
    await Promise.all(w.ctx.agents.list().map(a => F.timeout(a.whenIdle(), label))); await F.drain();
    if (!rt(w).delivery.running && !rt(w).delivery.scheduled) { await rt(w).tail; await F.drain(); if (!rt(w).delivery.running && !rt(w).delivery.scheduled) return; }
  }
  throw Error('Production dispatcher did not quiesce: ' + label);
}
async function human(w, agent, text) { const message = F.message(text); w.adapter.script.push({ text: 'User conversation acknowledged.' }); agent.followup(message); await F.timeout(agent.whenIdle(), 'actual human conversation'); await rt(w).tail; return message; }
async function continuationSetup(w, suffix) {
  await saveTeam(w, [w.worker.id]); const first = route(w, { [w.worker.id]: [{ text: 'Initial authorized task started, awaiting a decision.' }] });
  await batch(w, { assignments: [{ targetId: w.worker.id, text: 'Continue the same exact authorized outcome after decision.', expectedAssignment: null }] }); await settle(w); first();
  await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: false });
  const reportId = '10-decision-report-' + suffix, proposalId = '10-decision-' + suffix;
  await write(w, w.manager, { type: 'report', teamId: '10-team', reportId, text: 'Decision context from manager.', status: 'progress' });
  await write(w, w.manager, { type: 'propose', teamId: '10-team', proposalId, reportId, reportVersion: 1, text: 'Continue existing authorized outcome without changing task or permissions.', concernedIds: [w.manager.id, w.worker.id], ownResponse: 'agree' });
  await write(w, w.worker, { type: 'respond-proposal', teamId: '10-team', proposalId, proposalRevision: 1, response: 'agree' });
  return { proposalId, accept: () => write(w, w.manager, { type: 'accept-proposal', teamId: '10-team', proposalId, proposalRevision: 1, continueAssignments: [{ sessionId: w.worker.id, ...guard(task(w, w.worker.id)) }] }) };
}
async function worldTest(body) {
  const w = await F.createWorld(path.join(dataRoot, '10-case-' + (++caseId))); const errors = [];
  const off = w.ctx.on('agent/error', e => errors.push(String(e.error?.message ?? e.error)), { global: true });
  try {
    for (const name of ['manager', 'worker', 'other']) w[name] = (await F.createAgent(w, '10-' + name + '-' + caseId)).agent;
    const evidence = await body(w); assert.deepEqual(errors, [], 'Unexpected Native model/loop errors'); return evidence;
  } finally { off(); results.scriptedModelRequests = (results.scriptedModelRequests || 0) + w.adapter.calls.length; F.faults.failCoordRenames = false; F.faults.failNextCoordRename = false; await w.dispose(); }
}
async function check(name, body) { try { const evidence = await worldTest(body); results.tests.push({ name, status: 'passed', evidence }); console.log('PASS ' + name); } catch (error) { results.tests.push({ name, status: 'failed', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); } }
(async () => {
  await check('Default-on production dispatch completes A to B dependent handoff directly with no manager relay or rechecking', async w => {
    await saveTeam(w); await human(w, w.manager, 'I am discussing the project; retain final updates for me.');
    const done = route(w, {
      [w.worker.id]: [() => action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-a-result', text: 'A verified the fixture input. Use this factual result.' }), o => { assert.equal(value(o).reportVersion, 1); return { text: 'A result recorded directly.' }; }],
      [w.other.id]: [() => { assert.equal(task(w, w.other.id).workStatus, 'ready'); assert(state(w).messages.some(m => m.kind === 'handoff' && m.authorId === w.worker.id && m.recipientId === w.other.id)); return action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.other.id)), reportId: '10-b-result', text: 'B used A report and completed its independent outcome.' }); }, o => { assert.equal(value(o).reportVersion, 1); return { text: 'B completed directly.' }; }],
    });
    await batch(w, { objective: 'Deliver the downstream outcome from the verified input.', assignments: [
      { targetId: w.worker.id, text: 'Verify the required fixture input and report the factual result.', expectedAssignment: null },
      { targetId: w.other.id, text: 'Use the predecessor report to deliver the requested downstream outcome.', expectedAssignment: null, afterSessionId: w.worker.id },
    ] });
    await settle(w); done(); assert(state(w).teams[0].assignments.every(a => a.workStatus === 'complete')); assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 1);
    for (const agent of [w.worker, w.other]) { assert.equal(state(w).sessions.find(p => p.id === agent.id).focus.withUser, false); assert(agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'session-teams')); }
    return { automationDefaultOn: state(w).teams[0].automation, workerReports: 2, directRecordedHandoff: true, managerRelayRequests: 0, managerIndependentVerification: false, noFocusFromPluginSource: true, scriptedRequests: w.adapter.calls.length };
  });
  await check('Actual user focus holds peer request, real dependency causes Waiting, and exact own release enables direct reply', async w => {
    await saveTeam(w); await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Produce outcome once required peer information arrives.', expectedAssignment: null }] });
    const focus = await human(w, w.other, 'Discuss the peer request with me before returning.');
    await write(w, w.worker, { type: 'message', teamId: '10-team', messageId: '10-needed-input', to: w.other.id, kind: 'request', text: 'Please supply the necessary input.', blockingAssignment: guard(task(w, w.worker.id)) });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w);
    assert.equal(task(w, w.worker.id).workStatus, 'waiting'); assert.equal(w.adapter.calls.length, 1); assert(rt(w).focusHolds.has(w.other.id));
    F.denied(await command(w, w.other, { type: 'set-user-focus', withUser: false, expectedUserMessageId: 'stale-human-id' }), 'STALE_FOCUS');
    const done = route(w, {
      [w.other.id]: [() => action({ type: 'message', teamId: '10-team', messageId: '10-peer-answer', to: w.worker.id, kind: 'reply', replyTo: '10-needed-input', text: 'Here is the required factual input.' }), o => { value(o); return { text: 'Peer reply is recorded directly.' }; }],
      [w.worker.id]: [{ text: 'Required information is available; continuing assigned work.' }],
    });
    await write(w, w.other, { type: 'set-user-focus', withUser: false, expectedUserMessageId: focus.id }); await settle(w); done();
    assert.equal(task(w, w.worker.id).workStatus, 'ready'); assert.deepEqual(task(w, w.worker.id).waitingOn, []); assert.equal(state(w).messages.find(m => m.id === '10-needed-input').resolvedBy, '10-peer-answer');
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0);
    return { actualUserMessageId: focus.id, heldUntilExactOwnRelease: true, blockingWorkProvenance: true, directPeerReplyClearsOnlyItsBlocker: true, managerRelayRequests: 0, scriptedRequests: w.adapter.calls.length };
  });
  await check('Production automatic wake cold-resumes the existing exact Session with recorded Native preset and preserved cwd', async w => {
    await C.mountNativeController(w); const coldId = '10-production-cold';
    await C.persistColdOrdinarySession(w, coldId, { headerPreset: '10-obsolete-preset', events: [['sandbox/mode', { mode: 'read-only' }], ['approval/policy', { policy: 'never' }]] });
    await saveTeam(w, [coldId]); await human(w, w.manager, 'Keep final project updates while we discuss.');
    const done = route(w, { [coldId]: [() => action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, coldId)), reportId: '10-cold-complete', text: 'The independently restored native worker completed its outcome.' }), o => { assert.equal(value(o).reportVersion, 1); return { text: 'Cold native worker result recorded.' }; }] });
    assert.equal(w.ctx.agents.get(coldId), undefined);
    await batch(w, { assignments: [{ targetId: coldId, text: 'Complete the independent cold worker outcome.', expectedAssignment: null }] }); await settle(w); done();
    const agent = w.ctx.agents.get(coldId); assert(agent); assert.equal(agent.session.header.cwd, w.storageRoot); assert(w.ctx.agentPresets.inspectCompositions(agent.ctx).some(p => p.id === '10-worker-selected-preset'));
    assert.equal(task(w, coldId).workStatus, 'complete'); assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'approval/policy').length, 1);
    return { exactExistingColdId: coldId, actualPublicControllerAndPresetBinding: true, headerPresetAndManagerDefaultsNotCopied: true, cwdPreserved: true, noPermissionOverrideAdded: true, scriptedRequests: w.adapter.calls.length };
  });
  await check('Production flush failure starts no model, and human arriving during a later held flush is preserved without own wake admission', async w => {
    await saveTeam(w); const nativeFlush = w.ctx.sessions.flush; let fail = true;
    w.ctx.sessions.flush = async function(session) { if (session === w.worker.session && fail && w.worker.inbox.nextTurn.some(m => m.source.kind === 'session-teams')) { fail = false; throw Error('10-production-injected-native-flush-failure'); } return nativeFlush.call(this, session); };
    try { await batch(w, { assignments: [{ targetId: w.worker.id, text: 'This wake must not run when acknowledgment fails.', expectedAssignment: null }] }); await settle(w); }
    finally { w.ctx.sessions.flush = nativeFlush; }
    assert.equal(w.adapter.calls.length, 0); assert.equal(w.worker.inbox.nextTurn.length, 0); assert(state(w).wakeups.some(x => x.sessionId === w.worker.id && x.status === 'failed')); assert(state(w).alerts.some(a => a.targetId === w.worker.id && a.needsUser));
    const entered = F.deferred(), release = F.deferred(); let held = false;
    w.ctx.sessions.flush = async function(session) { if (session === w.other.session && !held && w.other.inbox.nextTurn.some(m => m.source.kind === 'session-teams')) { held = true; entered.resolve(); await release.promise; } return nativeFlush.call(this, session); };
    w.adapter.script.push({ text: 'Answering the actual human, not the held automatic wake.' });
    let user;
    try { await batch(w, { assignments: [{ targetId: w.other.id, text: 'Hold this unsolicited work if the user arrives.', expectedAssignment: null }] }); await F.timeout(entered.promise, 'production held flush'); user = F.message('Please discuss this with me now.'); w.other.followup(user); assert.equal(w.adapter.calls.length, 0); }
    finally { release.resolve(); }
    try { await settle(w); } finally { w.ctx.sessions.flush = nativeFlush; }
    assert.equal(w.adapter.calls.length, 1); assert(w.adapter.calls[0].messages.some(m => m.id === user.id && m.source.kind === 'user')); assert(!w.adapter.calls[0].messages.some(m => m.source?.kind === 'session-teams'));
    assert.equal(state(w).sessions.find(s => s.id === w.other.id).focus.userMessageId, user.id); assert.equal(w.other.inbox.nextTurn.length, 0);
    return { failedFlushNoEarlyModel: true, failedAttemptNeedsIntervention: true, humanDuringFlushWins: true, humanIdAndSourceUnchanged: true, noBlanketPreStepVeto: true, scriptedRequests: 1 };
  });
  await check('True-idle maintenance contention retries on Native quiescence without a status transition or model polling', async w => {
    await saveTeam(w); const entered = F.deferred(), release = F.deferred();
    const held = w.worker.runMaintenance(async () => { entered.resolve(); await release.promise; }); await entered.promise;
    const done = route(w, { [w.worker.id]: [{ text: 'Started only after the other maintenance owner released.' }] });
    try { await batch(w, { assignments: [{ targetId: w.worker.id, text: 'Run after maintenance becomes genuinely idle.', expectedAssignment: null }] }); if (rt(w).delivery.running) await F.timeout(rt(w).delivery.running, 'maintenance defer'); assert.equal(w.adapter.calls.length, 0); assert.equal(w.worker.status, 'idle'); }
    finally { release.resolve(); }
    await held; await settle(w); done(); assert.equal(w.adapter.calls.length, 1);
    return { idleStatusWasNotTrueIdle: true, oneShotNativeIdleRetry: true, noManualKickOrModelPolling: true, scriptedRequests: 1 };
  });
  await check('Manager retirement leaves active Native run alone and accepts only exact late factual evidence without resurrecting task', async w => {
    await saveTeam(w); const entered = F.deferred(), release = F.deferred(); let original;
    const done = route(w, { [w.worker.id]: [() => { original = guard(task(w, w.worker.id)); return { ...action({ type: 'finish-assignment', teamId: '10-team', ...original, reportId: '10-late-fact', text: 'Verified factual result from the already-running retired task.' }), entered, wait: release.promise }; }, o => { assert.equal(value(o).historical, true); return { text: 'Historical factual evidence saved, no further team work.' }; }] });
    await batch(w, { assignments: [{ targetId: w.worker.id, text: 'Perform the outcome already in progress.', expectedAssignment: null }] });
    try { await F.timeout(entered.promise, 'active native team turn'); await write(w, w.manager, { type: 'retire-team', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion, reason: 'The user changed direction.' }); assert.equal(w.worker.status, 'running'); assert.equal(state(w).teams[0].status, 'idle'); }
    finally { release.resolve(); }
    await settle(w); done(); const s = state(w), old = s.teams[0].assignments.find(a => a.revision === original.assignmentRevision);
    assert.equal(old.status, 'needs-review'); assert.notEqual(old.workStatus, 'complete'); assert(s.reports.some(r => r.id === '10-late-fact')); assert.equal(w.ctx.agents.get(w.worker.id), w.worker);
    return { retirementDidNotCancelNativeRun: true, exactCapturedLateFactualReport: true, oldAssignmentNotResurrectedOrCompleted: true, nativeSessionPreserved: true, scriptedRequests: 2 };
  });
  await check('Selective proposals and direct peer requests coalesce while unrelated proposal does not cause work Waiting or manager wakes', async w => {
    await saveTeam(w); await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Independent ready work unaffected by optional peer proposals.', expectedAssignment: null }] });
    const focus = await human(w, w.other, 'Hold team updates while we talk.');
    for (const n of [1, 2]) await write(w, w.manager, { type: 'propose-identity', teamId: '10-team', proposalId: '10-proposal-' + n, targetId: w.other.id, identity: 'Reviewer ' + n, text: 'Please consider continuing role ' + n + '.', concernedIds: [w.manager.id, w.other.id], ownResponse: 'agree' });
    for (const n of [1, 2]) await write(w, w.worker, { type: 'message', teamId: '10-team', messageId: '10-routine-request-' + n, to: w.other.id, kind: 'request', text: 'Optional useful clarification ' + n + '.' });
    await write(w, w.worker, { type: 'message', teamId: '10-team', messageId: '10-routine-information', to: w.other.id, kind: 'information', text: 'Routine fact is retained without its own wake.' });
    assert.equal(task(w, w.worker.id).workStatus, 'ready');
    const done = route(w, { [w.worker.id]: [{ text: 'Doing the independent ready outcome.' }], [w.other.id]: [{ text: 'Received one coalesced actionable proposal and peer notice.' }] });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); assert.equal(w.adapter.calls.filter(c => c.sessionId === w.other.id).length, 1);
    await write(w, w.other, { type: 'set-user-focus', withUser: false, expectedUserMessageId: focus.id }); await settle(w); done();
    const ownInputs = w.other.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'session-teams'); assert.equal(ownInputs.length, 1); assert.equal(ownInputs[0].data.source.wakeIds.length, 4);
    const history = F.ok(await F.tool(w, w.manager, { action: 'read', query: { type: 'history', teamId: '10-team' } })); assert.equal(history.messages.length, 3);
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0); assert.equal(task(w, w.worker.id).workStatus, 'ready');
    return { pendingProposalNotWaiting: true, fourActionableRefsOneNativeWake: true, routineInformationNoWake: true, managerCanRetrieveAllPeerRecords: true, unsolicitedManagerRequests: 0, scriptedRequests: w.adapter.calls.length };
  });
  await check('Production plugin restart cancels old pending outbox, preserves user focus and never replays inherited task even after review', async w => {
    await saveTeam(w); const user = await human(w, w.worker, 'Discuss this with me before running team work.');
    await batch(w, { assignments: [{ targetId: w.worker.id, text: 'Must not replay after restart.', expectedAssignment: null }] }); await settle(w);
    assert(state(w).wakeups.some(x => x.status === 'pending')); const generation = state(w).generation, before = w.adapter.calls.length;
    await w.unmountCoordination(); await w.mountCoordination(); await settle(w);
    assert.equal(state(w).generation, generation + 1); assert.equal(state(w).reviewRequired, true); assert(state(w).wakeups.every(x => x.status === 'cancelled')); assert.equal(state(w).sessions.find(s => s.id === w.worker.id).focus.userMessageId, user.id);
    await F.reviewIfRequired(w); await settle(w); assert.equal(w.adapter.calls.length, before); assert.equal(state(w).teams[0].assignments[0].status, 'needs-review'); assert.equal(w.ctx.agents.get(w.worker.id), w.worker);
    return { actualPluginUnloadReload: true, generationAdvanced: true, oldOutboxCancelled: true, inheritedWorkNeedsReviewNotReplay: true, explicitReviewDoesNotResurrectOldTask: true, focusPreserved: true, extraModelRequests: 0 };
  });
  await check('Actual Native human preview and fresh approval atomically release manager focus and activate exact workers', async w => {
    await saveTeam(w, [w.worker.id]);
    let approval;
    const plan = { identities: [], responsibilities: [], statuses: [], assignments: [{ targetId: w.worker.id, text: 'Perform only the exact user-approved Native outcome.', expectedAssignment: null }] };
    const done = route(w, {
      [w.manager.id]: [
        o => { assert(o.messages.some(m => m.source?.kind === 'user')); return action({ type: 'prepare-dispatch', teamId: '10-team', dispatchId: '10-real-human', expectedPlanVersion: state(w).teams[0].planVersion, expectedUserMessageId: o.messages.filter(m => m.role === 'user' && m.source?.kind === 'user').at(-1).id, summary: 'One independent exact outcome.', permissionExpectations: 'Native permissions unchanged.', plan }); },
        o => { value(o); assert.equal(state(w).teams[0].assignments.length, 0); assert.equal(w.adapter.calls.filter(c => c.sessionId === w.worker.id).length, 0); return { text: 'Preview: one exact independent outcome; existing Native permissions only. Do you approve?' }; },
        o => { assert(o.messages.some(m => m.id === approval.id && m.source?.kind === 'user')); assert(o.messages.some(m => m.source?.kind === 'runtime-context' && JSON.stringify(m.content).includes(approval.id) && JSON.stringify(m.content).includes('WITH USER'))); return action({ type: 'confirm-dispatch', teamId: '10-team', dispatchId: '10-real-human', expectedUserMessageId: approval.id, approved: true, returnToCoordination: true }); },
        o => { value(o); return { text: 'Confirmed exact preview; returning to coordination.' }; },
        { text: 'The user-approved outcome is now complete.' },
      ],
      [w.worker.id]: [o => { assert(o.messages.some(m => m.source?.kind === 'runtime-context' && JSON.stringify(m.content).includes(plan.assignments[0].text))); assert.equal(H.focus(w, w.manager).withUser, false); assert.equal(task(w, w.worker.id).text, plan.assignments[0].text); return action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-real-human-result', text: 'Exact user-approved Native outcome completed.' }); }, o => { value(o); return { text: 'Recorded completion.' }; }],
    });
    const discussion = F.message('Preview the independent outcome before dispatching it.'); w.manager.followup(discussion); await F.timeout(w.manager.whenIdle(), 'Native preview conversation'); await rt(w).tail;
    assert.equal(state(w).teams[0].assignments.length, 0); assert.equal(H.focus(w, w.manager).withUser, true);
    approval = F.message('Yes, I explicitly approve that exact preview; return to coordination.'); w.manager.followup(approval); await settle(w);
    assert(task(w, w.worker.id), 'Confirmed Native model tool must create exact task: ' + JSON.stringify({ dispatches: state(w).dispatches, toolResults: w.manager.session.snapshotEvents().filter(e => e.type === 'tool/result').map(e => e.data.message) }));
    assert.equal(task(w, w.worker.id).workStatus, 'complete', JSON.stringify({ wakes: state(w).wakeups, focus: state(w).sessions.map(s => ({ id: s.id, focus: s.focus })), alerts: state(w).alerts, workerStatus: w.worker.status })); done();
    const events = w.manager.session.snapshotEvents();
    for (const message of [discussion, approval]) assert(events.some(e => e.type === 'user/message' && e.data.id === message.id && e.data.source.kind === 'user'));
    assert.equal(task(w, w.worker.id).workStatus, 'complete');
    return { actualNativeHumanProof: true, fixtureOnlyHostInput: false, discussionId: discussion.id, approvalId: approval.id, actualNativeToolCalls: events.filter(e => e.type === 'tool/call').length, prepareNoActivation: true, requestedAtomicFocusRelease: true, exactWorkerCompletion: true };
  });
  await check('Dispatch rejects old preview, newer human ID and retired membership without activating work', async w => {
    await saveTeam(w); const fields = { assignments: [{ targetId: w.worker.id, text: 'Must remain unactivated.', expectedAssignment: null }] };
    const confirm = (dispatchId, expectedUserMessageId) => command(w, w.manager, { type: 'confirm-dispatch', teamId: '10-team', dispatchId, expectedUserMessageId, approved: true });
    const a = await H.prepare(w, fields); assert.equal((await confirm(a.dispatchId, H.focus(w, w.manager).userMessageId)).isError, true, 'Preview discussion itself is not fresh confirmation.');
    assert.equal((await command(w, w.manager, { type: 'update-work', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion, ...fields })).isError, true, 'Direct assignment dispatch cannot bypass confirmation.');
    const first = await H.nativeRecordedInput(w, w.manager); const newer = await H.nativeRecordedInput(w, w.manager);
    assert.equal((await confirm(a.dispatchId, first.id)).isError, true);
    await write(w, w.manager, { type: 'set-objective', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion, text: 'Changed mission invalidates old preview.' });
    assert.equal((await confirm(a.dispatchId, newer.id)).isError, true);
    const b = await H.prepare(w, fields); const approved = await H.nativeRecordedInput(w, w.manager);
    await F.admin(w, { type: 'save-team', teamId: '10-team', title: 'Outcome collaboration', description: 'Changed roster.', managerId: w.manager.id, memberIds: [w.other.id] });
    assert.equal((await confirm(b.dispatchId, approved.id)).isError, true);
    const c = await H.prepare(w, { assignments: [{ targetId: w.other.id, text: 'No dispatch after retirement.', expectedAssignment: null }] }); const last = await H.nativeRecordedInput(w, w.manager);
    await write(w, w.manager, { type: 'retire-team', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion }); assert.equal((await confirm(c.dispatchId, last.id)).isError, true);
    assert.equal(state(w).teams[0].assignments.length, 0); assert.equal(w.adapter.calls.length, 0);
    return { staleHumanRejected: true, changedPlanRejected: true, changedMembershipRejected: true, retiredRejected: true, noModelRequests: true, fixtureOnlyNativeInsertedInput: true };
  });
  await check('Accepted continuation survives Native busy to idle and a progress-only assignment version bump', async w => {
    const p = await continuationSetup(w, 'busy'), entered = F.deferred(), release = F.deferred();
    const done = route(w, { [w.worker.id]: [{ text: 'Existing independent Native activity ends normally.', entered, wait: release.promise }, o => { assert(o.messages.some(m => m.source?.kind === 'session-teams' && JSON.stringify(m.content).includes('Continue existing authorized outcome without changing task or permissions.') && JSON.stringify(m.content).includes(p.proposalId)), 'Actual Native continuation must include the exact accepted decision text and proposal reference.'); return { text: 'Accepted exact-task continuation received after true idle.' }; }] });
    const native = F.load('@deepseek-ai/dsh-llm').createUserMessage({ content: [{ type: 'text', text: 'Already running fixture activity, not a human authorization.' }], source: { kind: '10-fixture' } });
    w.worker.followup(native); await F.timeout(entered.promise, 'Native busy continuation barrier');
    try {
      await p.accept(); await write(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'in-progress' });
      await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); if (rt(w).delivery.running) await rt(w).delivery.running;
      const wake = state(w).wakeups.find(x => x.reason === 'continuation' && x.refs.proposalId === p.proposalId); assert(wake); assert.equal(wake.status, 'pending'); assert.equal(w.worker.status, 'running'); assert.equal(w.adapter.calls.length, 2);
    } finally { release.resolve(); }
    await settle(w); done(); const wake = state(w).wakeups.find(x => x.reason === 'continuation' && x.refs.proposalId === p.proposalId); assert.equal(wake.status, 'sent');
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0);
    const delivery = F.ok(await F.tool(w, w.manager, { action: 'read', query: { type: 'delivery', teamId: '10-team' } })); assert(delivery.continuations.some(c => c.proposalId === p.proposalId));
    return { nativeBusyRetainsPending: true, idleDeliversOnce: true, progressVersionBumpPreserved: true, managerNotWokenByOwnAcceptance: true, deliveryFactsNotUnderstanding: true, scriptedRequests: w.adapter.calls.length };
  });
  await check('Finish before continuation admission cancels it with no duplicate Native execution', async w => {
    const p = await continuationSetup(w, 'finished'); await p.accept();
    assert(state(w).wakeups.some(x => x.reason === 'continuation' && x.status === 'pending'));
    await write(w, w.worker, { type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-finished-before-admission', text: 'Already obtained exact factual result, recorded before continuation admission.' });
    const before = w.adapter.calls.length; await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w);
    assert.equal(w.adapter.calls.length, before); assert.equal(state(w).wakeups.find(x => x.reason === 'continuation').status, 'cancelled');
    return { completeBeforeNativeAdmission: true, continuationCancelled: true, extraNativeRequests: 0 };
  });
  await check('Acceptance never overrides waiting or actual Native human focus', async w => {
    const p = await continuationSetup(w, 'gates');
    await write(w, w.manager, { type: 'update-work', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion, statuses: [{ targetId: w.worker.id, ...guard(task(w, w.worker.id)), workStatus: 'waiting', waitingReason: 'Manual required information is still unavailable.' }] });
    await write(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'waiting', waitingReason: 'Own waiting write cannot launder manager reservation.' });
    assert.equal(require('../lib/core.cjs').managerReservedHold(state(w).teams[0], task(w, w.worker.id)), true);
    assert.equal((await command(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'ready' })).isError, true);
    await write(w, w.manager, { type: 'message', teamId: '10-team', messageId: '10-held-handoff', to: w.worker.id, kind: 'handoff', assignmentRevision: task(w, w.worker.id).revision, text: 'Relevant factual evidence does not override the manager-reserved hold.' });
    const acceptance = await p.accept(); assert.equal(acceptance.continuations[0].status, 'held'); assert.equal(state(w).wakeups.find(x => x.reason === 'continuation').status, 'pending'); assert.equal(task(w, w.worker.id).workStatus, 'waiting'); assert.equal(task(w, w.worker.id).waitingReason, 'Own waiting write cannot launder manager reservation.');
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); assert.equal(w.adapter.calls.length, 1);
    // Readying the same task preserves its original accepted intent; real Native source:user focus still holds it.
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: false });
    await write(w, w.manager, { type: 'update-work', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion, statuses: [{ targetId: w.worker.id, ...guard(task(w, w.worker.id)), workStatus: 'ready' }] });
    const heldUser = await H.nativeRecordedInput(w, w.worker, 'Hold the accepted decision while I discuss it.');
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); assert.equal(w.adapter.calls.length, 1); assert.equal(H.focus(w, w.worker).userMessageId, heldUser.id);
    return { waitingStatusAndReasonUnchanged: true, actualNativeFocusRetained: true, noPermissionChangeOrNativeRequest: true, originalContinuationStillPending: state(w).wakeups.find(x => x.reason === 'continuation').status === 'pending' };
  });
  await check('Ready accepted continuation remains pending behind focus and read-only approval observation', async w => {
    const p = await continuationSetup(w, 'approval'); const held = await H.nativeRecordedInput(w, w.worker, 'Discuss the accepted continuation with me.'); await p.accept();
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w);
    const wake = () => state(w).wakeups.find(x => x.reason === 'continuation'); assert.equal(wake().status, 'pending'); assert.equal(w.adapter.calls.length, 1);
    const gateway = w.ctx.typertGateway, pending = gateway.getPendingRemoteEvents;
    // Observation-only fixture, not an actual native approval request or grant/UI proof.
    gateway.getPendingRemoteEvents = () => [{ event: 'approval/request', agentId: w.worker.id }];
    try { await write(w, w.worker, { type: 'set-user-focus', withUser: false, expectedUserMessageId: held.id }); await settle(w); assert.equal(wake().status, 'pending'); assert.equal(w.adapter.calls.length, 1); }
    finally { gateway.getPendingRemoteEvents = pending; }
    const done = route(w, { [w.worker.id]: [{ text: 'Continuation admitted only after both independent holds clear.' }] }); rt(w).delivery.kick(); await settle(w); done(); assert.equal(wake().status, 'sent');
    return { actualFocusGate: true, injectedReadOnlyApprovalObservation: true, realApprovalUIOrGrantClaimed: false, noOverride: true, exactlyOneContinuationAdmission: true };
  });
  await check('Prepared dispatch cannot cross plugin restart startup review or be replayed after review', async w => {
    await saveTeam(w); const p = await H.prepare(w, { assignments: [{ targetId: w.worker.id, text: 'Must never cross generation boundary.', expectedAssignment: null }] }); const approval = await H.nativeRecordedInput(w, w.manager);
    await w.unmountCoordination(); await w.mountCoordination(); await settle(w);
    const attempt = () => command(w, w.manager, { type: 'confirm-dispatch', teamId: '10-team', dispatchId: p.dispatchId, expectedUserMessageId: approval.id, approved: true });
    assert.equal((await attempt()).isError, true); await F.reviewIfRequired(w); assert.equal((await attempt()).isError, true);
    assert.equal(state(w).teams[0].assignments.length, 0); assert.equal(w.adapter.calls.length, 0);
    return { actualPluginRestart: true, startupReviewBlocks: true, explicitReviewDoesNotRevivePreview: true, noModelRequests: true };
  });
  await check('Retirement removes focused former members from cached status but preserves exact own focus release', async w => {
    await saveTeam(w); const user = await H.nativeRecordedInput(w, w.worker); assert(Object.hasOwn(rt(w).statusFacts, w.worker.id));
    await write(w, w.manager, { type: 'retire-team', teamId: '10-team', expectedPlanVersion: state(w).teams[0].planVersion }); await settle(w);
    assert.equal(Object.hasOwn(rt(w).statusFacts, w.worker.id), false); assert.equal(H.focus(w, w.worker).withUser, true);
    await write(w, w.worker, { type: 'set-user-focus', withUser: false, expectedUserMessageId: user.id }); assert.equal(H.focus(w, w.worker).withUser, false); assert.equal(Object.hasOwn(rt(w).statusFacts, w.worker.id), false);
    return { actualRetirement: true, retiredOnlyStatusFactAbsent: true, exactInactiveOwnFocusReleaseStillAvailable: true, nativeModelRequests: 0 };
  });
  await check('Prepare and confirm reject immediate Native human latch before its queued Core persistence', async w => {
    await saveTeam(w); const discussion = await H.nativeRecordedInput(w, w.manager);
    const fields = { assignments: [{ targetId: w.worker.id, text: 'Stale native latch must prevent activation.', expectedAssignment: null }] };
    async function race(c) {
      const r = rt(w), original = r.refresh, newer = F.message('Newer actual Native user input supersedes the in-flight operation.'); let inserted = false;
      await w.manager.runMaintenance(async () => {
        r.refresh = async function(...args) { const result = await original.apply(this, args); if (!inserted) { inserted = true; w.manager.inbox.splice('next-turn', w.manager.inbox.nextTurn.length, 0, [newer]); assert.equal(H.focus(w, w.manager).userMessageId, c.expectedUserMessageId, 'Core still contains the old input inside this operation.'); assert.equal(r.focusHolds.get(w.manager.id), newer.id); } return result; };
        try { F.denied(await command(w, w.manager, c), 'STALE_FOCUS'); }
        finally { r.refresh = original; await r.tail; assert.equal(H.focus(w, w.manager).userMessageId, newer.id); assert.equal(w.manager.inbox.remove(newer.id), true); assert.equal(await w.ctx.sessions.flush(w.manager.session), true); }
      });
      assert(inserted); return newer;
    }
    await race({ type: 'prepare-dispatch', teamId: '10-team', dispatchId: '10-latch-stale-prepare', expectedPlanVersion: state(w).teams[0].planVersion, expectedUserMessageId: discussion.id, summary: 'Cannot preview against old human.', permissionExpectations: 'No changes.', plan: fields });
    assert.equal(state(w).dispatches.length, 0);
    const p = await H.prepare(w, fields); const approval = await H.nativeRecordedInput(w, w.manager);
    await race({ type: 'confirm-dispatch', teamId: '10-team', dispatchId: p.dispatchId, expectedUserMessageId: approval.id, approved: true });
    assert.equal(state(w).teams[0].assignments.length, 0); assert.equal(state(w).dispatches[0].status, 'prepared'); assert.equal(w.adapter.calls.length, 0);
    return { actualNativeInsertionDuringAwait: true, oldCoreIdProvenAtGate: true, synchronousNewHumanLatchWinsPrepare: true, synchronousNewHumanLatchWinsConfirm: true, noAssignmentActivated: true };
  });
  await check('Actual schema5 storage boot preserves exact Legacy5 backup hash before schema6 upgrade', async w => {
    await saveTeam(w); await H.nativeRecordedInput(w, w.manager, 'Preserve this exact historical focus through upgrade.');
    const Legacy5 = require('../lib/legacy-v5.cjs'), adapter = require('../lib/adapter.cjs');
    const prior = structuredClone(state(w)); delete prior.dispatches; prior.schemaVersion = 5; const original = Legacy5.validateState(prior), digest = Legacy5.token(original);
    await w.unmountCoordination(); const domain = await w.ctx.storageDomain.open(adapter.domainSpec);
    try { await domain.table('ledgers').put('state', original); } finally { await domain.close(); }
    await w.mountCoordination(); await settle(w);
    assert.equal(state(w).schemaVersion, 6); assert.deepEqual(state(w).dispatches, []); assert.equal(state(w).generation, original.generation + 1); assert.equal(state(w).reviewRequired, true);
    assert.deepEqual(state(w).sessions.find(s => s.id === w.manager.id).focus, original.sessions.find(s => s.id === w.manager.id).focus); assert.equal(w.adapter.calls.length, 0);
    await w.unmountCoordination(); // Reopen the separate durable backup only after its existing Native handle closes.
    const cold = await w.ctx.storageDomain.open(adapter.backupDomainSpec);
    try { const backup = cold.table('backups').get('v5-' + digest); assert.deepEqual(backup, original); assert.equal(Legacy5.token(backup), digest); }
    finally { await cold.close(); }
    return { actualStorageDomainSchema5Boot: true, exactLegacy5BackupHash: digest, backupByteEquivalentLogicalJSON: true, upgradedSchema: 6, generationAdvanced: true, startupReviewRequired: true, historicalFocusPreserved: true, noModelRequests: true };
  });
  for (const invalidation of ['complete', 'replace']) await check('Exact handoff invalidated before admission cannot replay after recipient ' + invalidation, async w => {
    await saveTeam(w); await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Original exact recipient outcome.', expectedAssignment: null }] });
    await write(w, w.other, { type: 'message', teamId: '10-team', messageId: '10-obsolete-handoff', to: w.worker.id, kind: 'handoff', assignmentRevision: task(w, w.worker.id).revision, text: 'Obsolete peer evidence must never reach a completed or replaced task.' });
    if (invalidation === 'complete') await write(w, w.worker, { type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-completed-handoff-target', text: 'Already completed before peer notice admission.' });
    else await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Different exact replacement outcome.', expectedAssignment: guard(task(w, w.worker.id)) }] });
    let done;
    if (invalidation === 'replace') done = route(w, { [w.worker.id]: [o => { const notices = o.messages.filter(m => m.source?.kind === 'session-teams'); assert(!JSON.stringify(notices).includes('10-obsolete-handoff')); assert(!JSON.stringify(notices).includes('Obsolete peer evidence')); assert(o.messages.some(m => m.source?.kind === 'runtime-context' && JSON.stringify(m.content).includes('Different exact replacement outcome.'))); return { text: 'Only replacement assignment received; no stale handoff replay.' }; }] });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); if (done) done();
    assert.equal(state(w).wakeups.find(x => x.reason === 'handoff').status, 'cancelled'); assert.equal(w.adapter.calls.length, invalidation === 'replace' ? 1 : 0);
    const before = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, before);
    return { invalidation, obsoleteHandoffCancelled: true, obsoleteEvidenceNotModelVisible: true, noReplay: true, nativeRequests: before };
  });
  for (const phase of ['before-append', 'after-flush', 'after-settle']) await check('Native work-to-reassessment mode race safely defers stale wording ' + phase, async w => {
    const p = await continuationSetup(w, 'mode-' + phase); await p.accept();
    const nativeMaintenance = w.worker.runMaintenance, nativeFlush = w.ctx.sessions.flush, nativeHost = rt(w).delivery.host;
    let changed = false, staleMessageId;
    const changeMode = async () => { changed = true; assert.equal(w.worker.status, 'idle'); await write(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'waiting', waitingReason: 'New missing prerequisite discovered during native admission.' }); assert.equal(task(w, w.worker.id).workStatus, 'waiting'); };
    if (phase === 'before-append') w.worker.runMaintenance = function(callback) { return nativeMaintenance.call(this, async signal => { if (!changed) await changeMode(); return callback(signal); }); };
    else if (phase === 'after-settle') rt(w).delivery.host = async function(c) {
      const result = await nativeHost.call(this, c);
      if (!changed && c.type === 'settle-wakes' && c.status === 'sent') { staleMessageId = w.worker.inbox.nextTurn.find(m => m.source.kind === 'session-teams')?.id; await changeMode(); }
      return result;
    };
    else w.ctx.sessions.flush = async function(session) {
      const result = await nativeFlush.call(this, session);
      if (!changed && session === w.worker.session && w.worker.inbox.nextTurn.some(m => m.source.kind === 'session-teams')) { staleMessageId = w.worker.inbox.nextTurn.find(m => m.source.kind === 'session-teams').id; await changeMode(); }
      return result;
    };
    const done = route(w, { [w.worker.id]: [o => {
      const notice = o.messages.filter(m => m.source?.kind === 'session-teams').at(-1); assert(notice); assert.match(JSON.stringify(notice.content), /reassessment only/i);
      assert.notEqual(notice.id, staleMessageId); assert.equal(task(w, w.worker.id).workStatus, 'waiting'); return { text: 'Only current reassessment wording reached the model; still missing prerequisite, stop.' };
    }] });
    try { await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); done(); }
    finally { w.worker.runMaintenance = nativeMaintenance; w.ctx.sessions.flush = nativeFlush; rt(w).delivery.host = nativeHost; }
    assert(changed); assert.equal(w.worker.inbox.nextTurn.length, 0); assert.equal(w.adapter.calls.length, 2);
    if (staleMessageId) { assert(!w.worker.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.id === staleMessageId)); assert(w.worker.session.snapshotEvents().some(e => e.type === 'agent/inbox/spliced' && e.data.removedCount)); }
    assert.equal(state(w).wakeups.find(x => x.reason === 'continuation').status, 'sent');
    const before = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, before);
    return { phase, actualNativeMaintenanceAndFlush: true, staleMessageId, staleWorkWordingNotModelVisible: true, deferredBeforeMaintenanceExit: true, oneCurrentModeReassessment: true, noRepeatWake: true };
  });
  await check('Self-waiting validator reassesses acceptance then later handoff and finishes without manager push or manual release', async w => {
    await saveTeam(w);
    const decisionText = 'Agreed contract: validate manifest entries against artifact folder 10-artifacts; producer must hand off exact folder evidence.';
    const handoffText = 'Producer handoff: folder 10-artifacts is ready; manifest 10-manifest.json contains two verified entries under the agreed contract.';
    const waitingReason = 'Need both artifact folder evidence and unanimously agreed contract before validation.';
    const first = route(w, {
      [w.worker.id]: [{ text: 'Producer is working independently; no handoff yet.' }],
      [w.other.id]: [() => action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'waiting', waitingReason }), o => { value(o); return { text: 'Waiting for both prerequisites. No validation execution.' }; }],
    });
    await batch(w, { assignments: [{ targetId: w.worker.id, text: 'Produce artifact folder and hand off exact evidence.', expectedAssignment: null }, { targetId: w.other.id, text: 'Validate artifact folder against agreed contract only after both prerequisites are evidenced.', expectedAssignment: null }] });
    await settle(w); first(); assert.equal(task(w, w.other.id).workStatus, 'waiting');
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: false });
    await write(w, w.manager, { type: 'report', teamId: '10-team', reportId: '10-validator-contract-report', text: decisionText, status: 'progress' });
    await write(w, w.manager, { type: 'propose', teamId: '10-team', proposalId: '10-validator-contract', reportId: '10-validator-contract-report', reportVersion: 1, text: decisionText, concernedIds: [w.manager.id, w.worker.id, w.other.id], ownResponse: 'agree' });
    for (const agent of [w.worker, w.other]) await write(w, agent, { type: 'respond-proposal', teamId: '10-team', proposalId: '10-validator-contract', proposalRevision: 1, response: 'agree' });
    await write(w, w.manager, { type: 'accept-proposal', teamId: '10-team', proposalId: '10-validator-contract', proposalRevision: 1, continueAssignments: [{ sessionId: w.other.id, ...guard(task(w, w.other.id)) }] });
    const revision = task(w, w.other.id).revision, version = task(w, w.other.id).version;
    const decision = route(w, { [w.other.id]: [o => {
      const notice = o.messages.filter(m => m.source?.kind === 'session-teams').at(-1); const text = notice.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      assert.match(text, /reassessment only/i); assert(text.includes(decisionText)); assert(text.includes('"proposalId":"10-validator-contract"')); assert(text.includes('"acceptedRevision":1')); assert(text.includes('"assignmentRevision":' + revision));
      assert(o.messages.some(m => m.source?.kind === 'runtime-context' && JSON.stringify(m.content).includes(waitingReason)));
      assert.equal(task(w, w.other.id).workStatus, 'waiting'); assert.equal(task(w, w.other.id).version, version);
      assert(!state(w).messages.some(m => m.kind === 'handoff'));
      return action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'waiting', waitingReason });
    }, o => { value(o); return { text: 'Accepted contract understood, but folder evidence remains unmet; preserve Waiting and stop without validation.' }; }] });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); decision();
    assert.equal(task(w, w.other.id).workStatus, 'waiting'); assert.equal(task(w, w.other.id).version, version); assert(!state(w).reports.some(r => r.id === '10-validator-finished'), 'No validation completion may be recorded while folder evidence is unmet.');
    const afterDecision = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, afterDecision, 'Still-waiting must not self-wake repeatedly.');
    const final = route(w, { [w.worker.id]: [() => action({ type: 'report', teamId: '10-team', reportId: '10-producer-artifact-report', text: handoffText, status: 'progress' }), o => { value(o); return action({ type: 'message', teamId: '10-team', messageId: '10-validator-handoff', to: w.other.id, kind: 'handoff', assignmentRevision: revision, reportId: '10-producer-artifact-report', reportVersion: 1, text: handoffText }); }, o => { value(o); return { text: 'Independent producer recorded exact report and direct handoff through Native tools.' }; }], [w.other.id]: [o => {
      const notice = o.messages.filter(m => m.source?.kind === 'session-teams').at(-1); const text = notice.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      assert.match(text, /reassessment only/i); assert(text.includes(handoffText)); assert(text.includes('"messageId":"10-validator-handoff"')); assert(text.includes('"reportId":"10-producer-artifact-report"')); assert(text.includes('"reportVersion":1')); assert(text.includes('"assignmentRevision":' + revision));
      assert.equal(task(w, w.other.id).workStatus, 'waiting');
      return action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'waiting', waitingReason: waitingReason + ' Checking newly received handoff evidence.' });
    }, async o => {
      value(o); const inbox = F.ok(await F.tool(w, w.other, { action: 'read', query: { type: 'inbox' } })); assert(JSON.stringify(inbox).includes('10-validator-handoff'), 'Exact handoff remains visible after own progress-only version bump while waiting.');
      return action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'in-progress' });
    }, o => { value(o); assert.equal(task(w, w.other.id).workStatus, 'in-progress'); return action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.other.id)), reportId: '10-validator-finished', text: 'Validated both manifest entries using accepted exact contract and producer handoff evidence.' }); }, o => { value(o); return { text: 'Validation complete; own resolved wait cleared without manager intervention.' }; }] });
    // Automation remains on: the producer's handoff alone must kick the validator's second reassessment.
    // Fixture represents the producer's independent Native activity completing, not a manager request or user focus hand-back.
    w.worker.followup(F.load('@deepseek-ai/dsh-llm').createUserMessage({ content: [{ type: 'text', text: 'Independent scripted producer activity now has the exact artifact evidence ready to record.' }], source: { kind: '10-fixture-producer-completion' } }));
    await F.timeout(w.worker.whenIdle(), 'independent Native producer records report and handoff'); await rt(w).tail;
    await settle(w); final(); assert.equal(task(w, w.other.id).workStatus, 'complete');
    const before = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, before);
    const inputs = w.other.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'session-teams');
    const wakes = state(w).wakeups.filter(x => x.sessionId === w.other.id && ['continuation', 'handoff'].includes(x.reason));
    assert.equal(wakes.length, 2); assert(wakes.every(x => x.status === 'sent')); assert.equal(inputs.length, 3);
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0); assert(!state(w).messages.some(m => m.kind === 'request'));
    return { nativeInputIds: inputs.map(e => e.data.id), nativeEvidence: inputs.slice(1).map(e => ({ id: e.data.id, wakeIds: e.data.source.wakeIds, text: e.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n') })), exactWakeRefs: wakes.map(x => ({ reason: x.reason, refs: x.refs, messageId: x.messageId })), exactDecision: '10-validator-contract@1', exactHandoff: '10-validator-handoff', exactReport: '10-producer-artifact-report@1', assignmentRevision: revision, reassessments: 2, waitingUnchangedUntilHandoff: true, noValidationWhileUnmet: true, noRepeatSelfWake: true, ownGuardedReleaseAndFinish: true, managerPushOrManualRelease: false, automationRemainedOnForHandoff: true, producerNativeToolCalls: w.worker.session.snapshotEvents().filter(e => e.type === 'tool/call').length, actualArtifactValidation: false, scriptedEvidenceOnly: true };
  });
  await check('Bound producer completion preserves recipient own extra wait until later accepted evidence and own Native release', async w => {
    await saveTeam(w);
    await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Produce the exact bounded input result.', expectedAssignment: null }, { targetId: w.other.id, text: 'Validate producer result only after the final contract is explicitly accepted.', expectedAssignment: null, afterSessionId: w.worker.id }] });
    const waitingReason = 'Waiting for producer result AND accepted final contract; producer completion alone is insufficient.';
    await write(w, w.other, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'waiting', waitingReason });
    const waitingVersion = task(w, w.other.id).version;
    const decisionText = 'Final contract accepted: use the exact completed producer report as validator input.';
    await write(w, w.manager, { type: 'report', teamId: '10-team', reportId: '10-bound-contract-report', text: decisionText, status: 'progress' });
    await write(w, w.manager, { type: 'propose', teamId: '10-team', proposalId: '10-bound-contract', reportId: '10-bound-contract-report', reportVersion: 1, text: decisionText, concernedIds: [w.manager.id, w.other.id], ownResponse: 'agree' });
    await write(w, w.other, { type: 'respond-proposal', teamId: '10-team', proposalId: '10-bound-contract', proposalRevision: 1, response: 'agree' });
    const initial = route(w, {
      [w.worker.id]: [() => action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-bound-producer-result', text: 'Exact producer input result completed; independent final contract acceptance is still pending.' }), o => { value(o); return { text: 'Bound producer completed directly through Native tools.' }; }],
      [w.other.id]: [o => {
        const notice = o.messages.filter(m => m.source?.kind === 'session-teams').at(-1); const text = notice.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        assert.match(text, /reassessment only/i); assert(text.includes('10-bound-producer-result'));
        assert.equal(task(w, w.worker.id).workStatus, 'complete'); assert.equal(task(w, w.other.id).workStatus, 'waiting'); assert.equal(task(w, w.other.id).waitingReason, waitingReason); assert.equal(task(w, w.other.id).version, waitingVersion);
        assert(!state(w).reports.some(r => r.id === '10-bound-validator-result'));
        return { text: 'Producer evidence arrived, but accepted final contract is still missing. Preserve own Waiting and stop without execution.' };
      }],
    });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); initial();
    assert.equal(task(w, w.other.id).workStatus, 'waiting'); const before = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, before, 'Unresolved own extra wait cannot repeatedly self-wake.');
    const finish = route(w, { [w.other.id]: [o => {
      const text = JSON.stringify(o.messages.filter(m => m.source?.kind === 'session-teams').at(-1).content); assert.match(text, /reassessment only/i); assert(text.includes(decisionText)); assert(text.includes('10-bound-contract'));
      assert.equal(task(w, w.other.id).workStatus, 'waiting'); return action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.other.id)), workStatus: 'in-progress' });
    }, o => { value(o); return action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.other.id)), reportId: '10-bound-validator-result', text: 'Validated exact producer result after independently receiving accepted contract evidence.' }); }, o => { value(o); return { text: 'Own resolved wait released and validator completed without manager status push.' }; }] });
    await write(w, w.manager, { type: 'accept-proposal', teamId: '10-team', proposalId: '10-bound-contract', proposalRevision: 1, continueAssignments: [{ sessionId: w.other.id, ...guard(task(w, w.other.id)) }] });
    await settle(w); finish(); assert.equal(task(w, w.other.id).workStatus, 'complete');
    const inputs = w.other.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'session-teams'); assert.equal(inputs.length, 2); assert(inputs.every(e => /reassessment only/i.test(JSON.stringify(e.data.content))));
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0);
    return { boundProducerNativeFinish: true, recipientOwnExtraWaitPreserved: true, noAutomaticReadyOrValidationWhileUnmet: true, firstHandoffReassessmentOnly: true, noRepeatedWake: true, laterAcceptedDecisionReassessment: true, ownGuardedReleaseAndFinish: true, managerStatusPush: false, nativeInputIds: inputs.map(e => e.data.id), reassessments: inputs.length };
  });
  await check('Accepted decision first and exact required folder reply last reassess own multi-prerequisite wait without manager push', async w => {
    await saveTeam(w);
    await batch(w, { automation: false, assignments: [{ targetId: w.worker.id, text: 'Validate only after accepted exact contract AND required peer folder evidence are available.', expectedAssignment: null }] });
    const waitingReason = 'Own prerequisite wait: accepted final contract AND required folder evidence are both necessary.';
    await write(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'waiting', waitingReason });
    await write(w, w.worker, { type: 'message', teamId: '10-team', messageId: '10-required-folder-request', to: w.other.id, kind: 'request', blockingAssignment: guard(task(w, w.worker.id)), text: 'Supply the exact folder evidence required for my current validation task.' });
    await write(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'waiting', waitingReason });
    const decisionText = 'Accepted final contract: use exact required folder reply evidence to validate the two manifest entries.';
    await write(w, w.manager, { type: 'report', teamId: '10-team', reportId: '10-reply-contract-report', text: decisionText, status: 'progress' });
    await write(w, w.manager, { type: 'propose', teamId: '10-team', proposalId: '10-reply-contract', reportId: '10-reply-contract-report', reportVersion: 1, text: decisionText, concernedIds: [w.manager.id, w.worker.id], ownResponse: 'agree' });
    await write(w, w.worker, { type: 'respond-proposal', teamId: '10-team', proposalId: '10-reply-contract', proposalRevision: 1, response: 'agree' });
    await write(w, w.manager, { type: 'accept-proposal', teamId: '10-team', proposalId: '10-reply-contract', proposalRevision: 1, continueAssignments: [{ sessionId: w.worker.id, ...guard(task(w, w.worker.id)) }] });
    const initial = route(w, {
      [w.other.id]: [{ text: 'Required request received; folder evidence is not yet ready, so no reply yet.' }],
      [w.worker.id]: [o => { const text = JSON.stringify(o.messages.filter(m => m.source?.kind === 'session-teams').at(-1).content); assert.match(text, /reassessment only/i); assert(text.includes(decisionText)); assert(text.includes('10-reply-contract')); assert.equal(task(w, w.worker.id).workStatus, 'waiting'); assert(task(w, w.worker.id).waitingOn.includes('10-required-folder-request')); return { text: 'Accepted decision received, but required folder reply remains missing. Keep Waiting; do not validate.' }; }],
    });
    await F.admin(w, { type: 'set-automation', teamId: '10-team', enabled: true }); await settle(w); initial();
    assert.equal(task(w, w.worker.id).workStatus, 'waiting'); F.denied(await command(w, w.worker, { type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'in-progress' }), 'WAITING_FOR_INFORMATION');
    const before = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, before);
    await write(w, w.other, { type: 'message', teamId: '10-team', messageId: '10-routine-folder-information', to: w.worker.id, kind: 'information', text: 'General folder progress is not the exact required reply and cannot wake or release this wait.' }); await settle(w); assert.equal(w.adapter.calls.length, before); assert.equal(task(w, w.worker.id).workStatus, 'waiting');
    const replyText = 'Required folder evidence: 10-artifacts folder is ready and its 10-manifest.json contains the two entries required by the accepted contract.';
    const finish = route(w, {
      [w.other.id]: [() => action({ type: 'report', teamId: '10-team', reportId: '10-required-folder-report', text: replyText, status: 'progress' }), o => { value(o); return action({ type: 'message', teamId: '10-team', messageId: '10-required-folder-reply', to: w.worker.id, kind: 'reply', replyTo: '10-required-folder-request', reportId: '10-required-folder-report', reportVersion: 1, text: replyText }); }, o => { value(o); return { text: 'Exact required reply and evidence recorded directly by peer Native tools.' }; }],
      [w.worker.id]: [o => {
        const notice = o.messages.filter(m => m.source?.kind === 'session-teams').at(-1); const text = notice.content.filter(b => b.type === 'text').map(b => b.text).join('\n'); assert.match(text, /reassessment only/i); assert(text.includes(replyText)); assert(text.includes('10-required-folder-reply')); assert(text.includes('10-required-folder-request')); assert(text.includes('10-required-folder-report'));
        assert.equal(task(w, w.worker.id).workStatus, 'waiting', 'Required reply must not auto-clear an additional own explicit wait.'); assert.deepEqual(task(w, w.worker.id).waitingOn, []); assert(!state(w).reports.some(r => r.id === '10-required-reply-validation'));
        return action({ type: 'set-work-status', teamId: '10-team', ...guard(task(w, w.worker.id)), workStatus: 'in-progress' });
      }, o => { value(o); return action({ type: 'finish-assignment', teamId: '10-team', ...guard(task(w, w.worker.id)), reportId: '10-required-reply-validation', text: 'Validated exact peer folder reply evidence using the previously accepted final contract.' }); }, o => { value(o); return { text: 'Own resolved prerequisite wait released and validation complete with no manager push.' }; }],
    });
    w.other.followup(F.load('@deepseek-ai/dsh-llm').createUserMessage({ content: [{ type: 'text', text: 'Independent scripted peer activity now has the exact requested folder evidence ready to report and reply.' }], source: { kind: '10-fixture-requiredreply-completion' } }));
    await settle(w); finish(); assert.equal(task(w, w.worker.id).workStatus, 'complete'); const after = w.adapter.calls.length; rt(w).delivery.kick(); await settle(w); assert.equal(w.adapter.calls.length, after);
    assert.equal(w.adapter.calls.filter(c => c.sessionId === w.manager.id).length, 0);
    const inputs = w.worker.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'session-teams'); assert.equal(inputs.length, 2);
    const wakes = state(w).wakeups.filter(x => x.sessionId === w.worker.id && ['continuation', 'reply'].includes(x.reason)); assert.equal(wakes.length, 2); assert(wakes.every(x => x.status === 'sent'));
    return { decisionBeforeRequiredReply: true, bothReassessmentOnly: true, unansweredRequiredRequestStillBlocksExecution: true, finalReplyClearsOnlyTypedBlocker: true, ownExtraWaitNotAutoCleared: true, exactReplyEvidenceNativeVisible: true, generalInformationDoesNotWake: true, ownGuardedReleaseAndFinish: true, managerPushOrManualStatusRelease: false, automationRemainedOnForReply: true, noRepeatWake: true, nativeEvidence: inputs.map(e => ({ id: e.data.id, wakeIds: e.data.source.wakeIds, text: e.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n') })), exactWakeRefs: wakes.map(x => ({ reason: x.reason, refs: x.refs, messageId: x.messageId })) };
  });
  F.archiveFiles(dataRoot); results.networkAttempts = F.audit.networkAttempts; results.outsideTestMutations = F.audit.fileMutations.filter(p => !require('./paths.cjs').ownedMutation(p)); assert.deepEqual(results.networkAttempts, []); assert.deepEqual(results.outsideTestMutations, []);
  results.passed = results.tests.filter(t => t.status === 'passed').length; results.failed = results.tests.length - results.passed;
  fs.writeFileSync(require('./paths.cjs').resultPath('integration'), JSON.stringify(results, null, 2) + '\n'); console.log(`${results.passed}/${results.tests.length} production Native integration groups passed`); if (results.failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });


