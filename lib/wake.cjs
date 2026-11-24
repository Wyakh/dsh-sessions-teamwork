'use strict';
// Native wake admission only. Business events/claims live in the atomic Core ledger.
const { randomUUID } = require('node:crypto');
const { freezeMessage } = require('@deepseek-ai/dsh-llm');
const Core = require('./core.cjs');
const SOURCE = 'session-teams';
const own = message => message?.source?.kind === SOURCE;
const queued = agent => [...agent.inbox.nextTurn, ...agent.inbox.nextStep];
class WakeDelivery {
  constructor(runtime, { maxAutomaticWakesPerBurst = 24 } = {}) {
    this.runtime = runtime; this.ctx = runtime.ctx; this.limit = maxAutomaticWakesPerBurst;
    this.closed = false; this.scheduled = false; this.running = null; this.dirty = false; this.bursts = new Map(); this.inFlight = new Map(); this.idleWatches = new Map(); this.maintenanceRetries = new Map();
  }
  kick() {
    if (this.closed || !this.runtime.initialized || this.scheduled) return;
    if (this.running) { this.dirty = true; return; }
    this.scheduled = true;
    this.ctx.agents.withoutInitiator(() => queueMicrotask(() => {
      this.scheduled = false; if (this.closed) return;
      this.running = this.drain().catch(() => this.ctx.logger.warn('Session teams delivery could not settle; no automatic retry or execution success is established.')).finally(() => { this.running = null; if (this.dirty) { this.dirty = false; this.kick(); } });
    }));
  }
  resetBurst(sessionId) {
    this.maintenanceRetries.delete(sessionId);
    for (const team of this.runtime.snapshot?.teams ?? []) if (team.status === 'active' && [team.managerId, ...team.memberIds].includes(sessionId)) this.bursts.delete(team.id);
  }
  held(sessionId) {
    const r = this.runtime;
    return this.closed || r.closing || !r.initialized || r.focusHolds.has(sessionId) || r.snapshot.reviewRequired || r.archived(sessionId);
  }
  pending(sessionId) { return Core.pendingWakes(this.runtime.snapshot, sessionId); }
  async host(command) { return this.runtime.enqueue(() => this.runtime.commit({ kind: 'host' }, command)); }
  async defer(ids, messageId) {
    try { await this.host({ type: 'defer-wakes', wakeIds: ids, messageId }); }
    catch { // Core partitions obsolete siblings; any remaining failure must not silently lose valid intent.
      await this.host({ type: 'settle-wakes', wakeIds: ids, status: 'failed', messageId, error: 'Automatic delivery could not be durably deferred; review before retrying.' }).catch(() => {});
    }
  }
  nativePending(sessionId) {
    return this.ctx.get('typertGateway')?.getPendingRemoteEvents().some(event => event.agentId === sessionId) ?? false;
  }
  watchMaintenance(agent) {
    if (this.idleWatches.has(agent)) return true;
    const retries = this.maintenanceRetries.get(agent.id) ?? 0;
    if (retries >= 3) return false;
    this.maintenanceRetries.set(agent.id, retries + 1);
    const wait = agent.whenIdle().then(() => new Promise(resolve => setImmediate(resolve)));
    this.idleWatches.set(agent, wait);
    wait.then(() => { this.idleWatches.delete(agent); if (!this.closed && this.ctx.agents.get(agent.id) === agent) this.kick(); }, () => { this.idleWatches.delete(agent); });
    return true;
  }
  async drain() {
    const targets = [...new Set(this.pending().map(wake => wake.sessionId))];
    for (const sessionId of targets) {
      if (this.closed) return;
      try { await this.deliver(sessionId); }
      catch { this.ctx.logger.warn('A Session teams wake was not admitted; its durable receipt requires review.'); }
    }
  }
  continuationContext(candidates, messageId, maxBytes = 4800) {
    const state = this.runtime.snapshot, lines = []; let omitted = 0;
    for (const wake of candidates.filter(w => w.reason === 'continuation')) {
      const proposal = state.proposals.find(p => p.teamId === wake.teamId && p.id === wake.refs.proposalId);
      const revision = proposal?.revisions.find(v => v.revision === wake.refs.proposalRevision);
      if (!revision) continue;
      const line = JSON.stringify({ teamId: wake.teamId, proposalId: proposal.id, acceptedRevision: revision.revision, assignmentRevision: wake.refs.assignmentRevision, decisionText: [...revision.text].slice(0, 850).join('') });
      if (Buffer.byteLength(lines.join('\n') + line, 'utf8') > maxBytes) { omitted++; continue; }
      lines.push(line);
    }
    if (!lines.length && !omitted) return '';
    return '\nAccepted decisions for your existing unfinished assignment(s):\n' + lines.join('\n') + (omitted ? '\nIMPORTANT: ' + omitted + ' additional accepted decision excerpt(s) could not fit. Native delivery messageId: ' + messageId + '. Before acting, read my-teams if team IDs are needed, then delivery for your active teams; find continuation entries with this exact messageId and read their exact proposalId/proposalRevision. All decisions in this delivery matter; cached assignment text alone is NOT sufficient.' : '') + '\nUse these accepted decisions for the already-authorized outcome only when its actual prerequisites are satisfied; otherwise reassess and retain Waiting. Read the exact proposal if the excerpt is insufficient. Do not redo finished work or override another waiting condition. This is not a new assignment, a native permission grant, or a user-message hand-back.';
  }
  eventContext(candidates, messageId) {
    const state = this.runtime.snapshot;
    const reassess = candidates.some(wake => Core.wakeMode(state, wake) === 'reassess');
    const prefix = reassess ? '\nREASSESSMENT ONLY for each referenced WAITING assignment: the new accepted decision, exact required reply or handoff is evidence to reassess its wait, NOT permission to execute that task. Read the relevant evidence; clear only your own prerequisite wait with exact current guards when every actual prerequisite is satisfied. Preserve manager-reserved holds, unanswered required requests and unfinished predecessors. If something remains missing, keep Waiting and stop; request/alert the manager only when genuinely needed. Do not poll, redo completed work, or manufacture acknowledgments. Other already-runnable assignments remain independent.\n' : '';
    const decisions = this.continuationContext(candidates, messageId, 3500), lines = []; let omitted = 0;
    const budget = Math.max(0, 5900 - Buffer.byteLength(prefix + decisions, 'utf8'));
    for (const wake of candidates.filter(w => w.reason === 'handoff' || w.reason === 'reply' && Core.wakeMode(state, w) === 'reassess')) {
      const record = state.messages.find(m => m.teamId === wake.teamId && m.id === wake.refs.messageId);
      if (!record) continue;
      const request = record.replyTo && state.messages.find(m => m.teamId === wake.teamId && m.id === record.replyTo);
      const line = JSON.stringify({ teamId: wake.teamId, messageId: record.id, authorId: record.authorId, kind: wake.reason, assignmentRevision: wake.refs.assignmentRevision ?? request?.blockingAssignmentRevision, ...(record.replyTo ? { replyTo: record.replyTo } : {}), ...(record.reportId ? { reportId: record.reportId, reportVersion: record.reportVersion } : {}), evidence: [...record.text].slice(0, 850).join('') });
      if (Buffer.byteLength(lines.join('\n') + line, 'utf8') > budget) { omitted++; continue; }
      lines.push(line);
    }
    return prefix + decisions + (lines.length ? '\nExact handoff/required-reply evidence for your current unfinished assignment(s):\n' + lines.join('\n') : '') + (omitted ? '\nIMPORTANT: ' + omitted + ' handoff/required-reply excerpt(s) could not fit. Before acting read updates; if needed, read delivery for your active teams and match native messageId ' + messageId + ', then refs.messageId against exact peer records in team history. Cached assignment text alone is insufficient.' : '');
  }
  async deliver(sessionId) {
    const r = this.runtime;
    if (this.held(sessionId) || this.nativePending(sessionId)) return;
    let agent = this.ctx.agents.get(sessionId);
    if (agent && (agent.status !== 'idle' || queued(agent).length)) return;
    let candidates = this.pending(sessionId); if (!candidates.length) return;
    const messageId = 'session-teams-' + randomUUID(), ids = candidates.map(wake => wake.id);
    await this.host({ type: 'claim-wakes', wakeIds: ids, messageId });
    let appended = false, admitted = false, entered = false;
    try {
      if (this.held(sessionId)) { await this.defer(ids, messageId); return; }
      if (candidates.some(wake => (this.bursts.get(wake.teamId) ?? 0) >= this.limit)) throw Error('Automatic wake burst limit reached. Discuss/resume explicitly before more team delivery.');
      const observation = await r.sample(sessionId);
      if (observation.availability !== 'available' || observation.archived) throw Error('Target Session is not currently available for automatic delivery.');
      if (!agent) {
        const controller = this.ctx.get('sessionController');
        if (!controller) throw Error('Native Session controller is unavailable; open the existing Session manually.');
        const result = await controller.resolveAgent(sessionId);
        if (!result.agent) throw Error('Native Session activation failed; open the existing Session and review its native status.');
        agent = result.agent;
      }
      if (this.held(sessionId) || this.nativePending(sessionId) || agent.status !== 'idle' || queued(agent).length) { await this.defer(ids, messageId); return; }
      const modes = new Map(candidates.map(wake => [wake.id, Core.wakeMode(r.snapshot, wake)]));
      const modeChanged = wake => Core.wakeMode(r.snapshot, wake) !== modes.get(wake.id);
      const message = freezeMessage({ id: messageId, role: 'user', source: { kind: SOURCE, form: 'notice', summary: 'Team coordination ready', wakeIds: ids, generation: r.snapshot.generation },
        content: [{ type: 'text', text: 'Recorded team coordination needs attention. Use the cached current assignment when sufficient; read session_teams updates only for needed peer results, requests, proposal responses or exact references. Do not perform ritual rereads. Trust factual reports; act on your assigned outcome without routine manager rechecking. This delivery grants no native permissions. If With user, prioritize the latest user conversation and defer unsolicited team work. If nothing remains actionable, stop rather than creating acknowledgments or new work merely to keep automation running.' + this.eventContext(candidates, messageId) }] });
      try {
        await agent.runMaintenance(async signal => {
          entered = true;
          if (signal.aborted || this.held(sessionId) || this.ctx.agents.get(sessionId) !== agent || queued(agent).length || this.nativePending(sessionId)) { await this.defer(ids, messageId); return; }
          const exact = r.snapshot.wakeups.filter(wake => ids.includes(wake.id));
          if (exact.length !== ids.length || exact.some(wake => wake.status !== 'claimed' || wake.messageId !== messageId || (!Core.wakeApplicable(r.snapshot, wake, true) || modeChanged(wake)))) {
            await this.defer(ids, messageId); return;
          }
          this.inFlight.set(messageId, { agent, ids });
          try {
          agent.followup(message); appended = true;
          if (await this.ctx.sessions.flush(agent.session) !== true) throw Error('Native input durability was not acknowledged.');
          if (signal.aborted || this.held(sessionId) || this.ctx.agents.get(sessionId) !== agent || this.nativePending(sessionId) || r.snapshot.wakeups.some(wake => ids.includes(wake.id) && (wake.status !== 'claimed' || (!Core.wakeApplicable(r.snapshot, wake, true) || modeChanged(wake))))) {
            if (agent.inbox.remove(messageId) && await this.ctx.sessions.flush(agent.session) !== true) throw Error('Held native input removal was not acknowledged.');
            await this.defer(ids, messageId); return;
          }
          // No model runs inside maintenance. Settle before releasing its queued input.
          await this.host({ type: 'settle-wakes', wakeIds: ids, status: 'sent', messageId });
          if (signal.aborted || this.held(sessionId) || this.ctx.agents.get(sessionId) !== agent || this.nativePending(sessionId) || r.snapshot.wakeups.some(wake => ids.includes(wake.id) && (!Core.wakeApplicable(r.snapshot, wake, true) || modeChanged(wake)))) {
            if (agent.inbox.remove(messageId) && await this.ctx.sessions.flush(agent.session) !== true) throw Error('Held native input removal was not acknowledged.');
            await this.defer(ids, messageId); return;
          }
          for (const teamId of new Set(candidates.map(wake => wake.teamId))) this.bursts.set(teamId, (this.bursts.get(teamId) ?? 0) + 1);
          this.maintenanceRetries.delete(sessionId); admitted = true;
          } catch (error) {
            // Remove BEFORE maintenance unwinds; otherwise its finally could wake an uncommitted input.
            if (appended) { try { if (agent.inbox.remove(messageId)) await this.ctx.sessions.flush(agent.session); } catch {} }
            throw error;
          }
        });
      } catch (error) {
        if (!entered && /already has active work/.test(error?.message ?? '') && this.watchMaintenance(agent)) { await this.defer(ids, messageId); return; } // Native maintenance stays publicly idle; watch its actual activity promise.
        throw error;
      }
    } catch (error) {
      if (appended && agent) {
        try { if (agent.inbox.remove(messageId)) await this.ctx.sessions.flush(agent.session); } catch { /* Ambiguity is recorded, not retried. */ }
      }
      await this.host({ type: 'settle-wakes', wakeIds: ids, status: 'failed', messageId, error: String(error?.message ?? 'Native automatic delivery failed.').slice(0, 1000) }).catch(() => {});
    } finally {
      this.inFlight.delete(messageId);
      if (admitted && agent) {
        // Not awaited by the Core FIFO or maintenance. New input can replace activity.
        agent.whenIdle().then(() => this.kick(), () => this.kick());
      }
    }
  }
  async cleanRestored(agent) {
    const removed = queued(agent).filter(own).map(message => agent.inbox.remove(message.id));
    if (removed.some(Boolean) && await this.ctx.sessions.flush(agent.session) !== true) throw Error('Old team wake cleanup was not durable.');
  }
  async close() {
    this.closed = true;
    for (const agent of this.ctx.agents.list()) {
      let removed = false;
      for (const message of queued(agent)) if (own(message)) removed = agent.inbox.remove(message.id) || removed;
      if (removed) await this.ctx.sessions.flush(agent.session).catch(() => {});
    }
    if (this.running) await this.running;
  }
}
module.exports = { WakeDelivery, SOURCE, own, queued };
