'use strict';
// TEST ONLY. Real Native queue insertion drives production's source-aware listener.
// No production bypass, profile, network, model, or foreign pending-input removal.
const F = require('./dsh-fixture.cjs');
let dispatchNumber = 0;
const ledger = w => w.ctx.sessionTeams.runtime.ledger();
const runtime = w => w.ctx.sessionTeams.runtime;
const team = (w, teamId = '10-team') => ledger(w).teams.find(t => t.id === teamId);
const focus = (w, agent) => ledger(w).sessions.find(p => p.id === agent.id).focus;
const execute = (w, agent, command) => F.tool(w, agent, { action: 'execute', command }).then(F.ok);
async function nativeRecordedInput(w, agent, text = 'Fixture user approves the exact displayed dispatch.') {
  const message = F.message(text), before = w.adapter.calls.length;
  await agent.runMaintenance(async () => {
    agent.inbox.splice('next-turn', agent.inbox.nextTurn.length, 0, [message]);
    F.assert.equal(runtime(w).focusHolds.get(agent.id), message.id, 'Actual inserted event must synchronously latch human source.');
    await runtime(w).tail;
    F.assert.equal(focus(w, agent).userMessageId, message.id, 'Core must durably record the actual Native input.');
    F.assert.equal(await w.ctx.sessions.flush(agent.session), true);
    F.assert.equal(agent.inbox.remove(message.id), true, 'Remove only this no-model fixture input, never another pending human.');
    F.assert.equal(await w.ctx.sessions.flush(agent.session), true);
  });
  F.assert.equal(w.adapter.calls.length, before, 'Nonwaking Native queue setup must not start a model.');
  return message;
}
async function prepare(w, fields, options = {}) {
  const teamId = options.teamId || '10-team';
  if (!focus(w, w.manager).withUser) await nativeRecordedInput(w, w.manager, 'Discuss the exact work preview with me first.');
  const dispatchId = options.dispatchId || '10-dispatch-' + (++dispatchNumber);
  const result = await execute(w, w.manager, { type: 'prepare-dispatch', teamId, dispatchId, expectedPlanVersion: team(w, teamId).planVersion, expectedUserMessageId: focus(w, w.manager).userMessageId, summary: 'Exact fixture dispatch preview.', permissionExpectations: 'Existing Native permissions only; no permission changes.', plan: fields });
  return { dispatchId, result };
}
async function dispatch(w, fields, { returnToCoordination = false, teamId = '10-team' } = {}) {
  const { dispatchId } = await prepare(w, fields, { teamId });
  const approval = await nativeRecordedInput(w, w.manager);
  const result = await execute(w, w.manager, { type: 'confirm-dispatch', teamId, dispatchId, expectedUserMessageId: approval.id, approved: true, returnToCoordination });
  F.assert.equal(focus(w, w.manager).withUser, !returnToCoordination, 'Confirmation must atomically honor keep-With-user versus return-to-coordination.');
  return result;
}
module.exports = { nativeRecordedInput, prepare, dispatch, execute, ledger, runtime, team, focus };
