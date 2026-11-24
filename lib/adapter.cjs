'use strict';
// V5 native boundary: atomic records, selective outbox admission and user-first delivery.
const { Service } = require('@deepseek-ai/cordis');
const { z } = require('zod');
const { defineDomain, domainTable } = require('@deepseek-ai/dsh-storage-domain');
const { HarnessError } = require('@deepseek-ai/dsh-llm');
const { Remote, RemoteError, TypertRemoteService } = require('@deepseek-ai/dsh-typert-protocol');
const { workspaceDomainSpec, workspaceDomainState } = require('@deepseek-ai/dsh-workspace');
const { SESSION_FORMAT_VERSION } = require('@deepseek-ai/dsh-session');
const Core = require('./core.cjs');
const Legacy = require('./legacy-v2.cjs');
const Legacy3 = require('./legacy-v3.cjs');
const Legacy4 = require('./legacy-v4.cjs');
const Legacy5 = require('./legacy-v5.cjs');
const { WakeDelivery } = require('./wake.cjs');
const { createEnvironmentReader } = require('./environment.cjs');
const DOMAIN = 'session_teams_v2', KEY = 'state';
const legacySchema = z.union([Legacy.stateSchema, Legacy3.stateSchema, Legacy4.stateSchema, Legacy5.stateSchema]);
const domainSpec = defineDomain({ name: DOMAIN, version: 2, tables: { ledgers: domainTable(z.union([Core.stateSchema, legacySchema])), backups: domainTable(legacySchema) } });
const backupDomainSpec = defineDomain({ name: 'session_teams_backups', version: 1, layout: 'per-record', tables: { backups: domainTable(legacySchema) } });
const clone = value => structuredClone(value);
class AdapterError extends Error { constructor(code, message) { super(message); this.code = code; } }
const check = (condition, code, message) => { if (!condition) throw new AdapterError(code, message); };
function parse(schema, value) { const result = schema.safeParse(value); check(result.success, 'INVALID', 'Arguments do not match this operation.'); return result.data; }
function errorInfo(error) {
  const code = error instanceof AdapterError || error instanceof Core.CoordinationError ? error.code : 'STORAGE';
  return { code, message: code === 'STORAGE' ? 'Session teams storage or a required native service is unavailable; refresh before retrying. No success is established.' : error.message };
}
function asRemote(error) { if (error instanceof RemoteError) return error; const { code, message } = errorInfo(error); return new RemoteError('session-teams/' + code.toLowerCase().replaceAll('_', '-'), message, {}); }
function asTool(error) { const { code, message } = errorInfo(error); return new HarnessError(message, 'TEAMS_' + code); }
const nativeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const setupQuery = z.object({ type: z.literal('worker-setup'), teamId: nativeId, sessionId: nativeId, detail: z.boolean().optional() }).strict();
const statusQuery = z.object({ type: z.literal('status'), after: z.number().int().nonnegative().optional() }).strict();
const ownerQuerySchema = z.discriminatedUnion('type', [...Core.querySchema.options, setupQuery, statusQuery]);
const querySchema = z.discriminatedUnion('type', [...Core.querySchema.options.filter(option => !['snapshot', 'export'].includes(option.shape.type.value)), setupQuery]);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), query: querySchema }).strict(),
  z.object({ action: z.literal('execute'), command: Core.agentCommandSchema }).strict(),
]);
const preconditionSchema = z.object({ expectedRevision: z.number().int().nonnegative(), expectedGeneration: z.number().int().positive(), reviewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const observationEqual = (a, b) => a.availability === b.availability && a.execution === b.execution && a.archived === b.archived;
class Runtime {
  constructor(ctx, options = {}) {
    this.ctx = ctx; this.tail = Promise.resolve(); this.closing = false; this.initialized = false;
    this.pendingArchives = new Set(); this.pendingUnarchives = new Set(); this.committedArchives = new Set(); this.archiveFault = false;
    this.participantIds = new Set(); this.contexts = new Map(); this.labels = new Map(); this.snapshot = null;
    this.observations = new Map(); this.environment = createEnvironmentReader(ctx);
    this.focusHolds = new Map(); this.closeouts = new Map(); this.statusWaiters = new Set();
    this.statusVersion = 0; this.statusFacts = {}; this.statusJSON = '{}';
    this.delivery = new WakeDelivery(this, options);
  }
  enqueue(work) {
    if (this.closing) return Promise.reject(new AdapterError('CLOSED', 'Session teams is closed.'));
    const task = this.tail.then(work); this.tail = task.catch(() => {}); return task;
  }
  archiveSet() {
    check(!this.archiveFault, 'UNAVAILABLE', 'Native archive state could not be validated.');
    const ids = this.ctx.workspaceRegistry.archivedSessionIds;
    check(Array.isArray(ids) && ids.every(id => typeof id === 'string'), 'UNAVAILABLE', 'Native archive state is unavailable.');
    return new Set([...ids, ...this.committedArchives]);
  }
  archived(id) { return this.pendingArchives.has(id) || this.archiveSet().has(id); }
  noticeArchive(id) {
    this.pendingArchives.add(id);
    if (this.initialized) this.enqueue(() => this.retire(id)).catch(() => this.ctx.logger.warn('Session teams archive reconciliation is pending; affected operations remain blocked.'));
  }
  installListeners() {
    this.ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!['user', 'retry'].includes(message.source?.kind) || this.ctx.agents.get(agent.id) !== agent || !this.snapshot?.sessions.some(p => p.id === agent.id) || this.closing) return;
      this.focusHolds.set(agent.id, message.id); this.delivery.resetBurst(agent.id); this.updateStatusFacts();
      this.enqueue(() => this.commit({ kind: 'host' }, { type: 'user-input', sessionId: agent.id, userMessageId: message.id }))
        .catch(() => this.ctx.logger.warn('User focus could not be persisted; automatic team delivery remains held for that Session.'));
    }, { global: true });
    this.ctx.on('agent/created', async ({ agent }) => { await this.delivery.cleanRestored(agent); }, { global: true });
    this.ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') { for (const [key, permit] of this.closeouts) if (permit.agent === agent) this.closeouts.delete(key); this.delivery.kick(); }
    }, { global: true });
    this.ctx.on('agent/disposed', ({ agent }) => { for (const [key, permit] of this.closeouts) if (permit.agent === agent) this.closeouts.delete(key); }, { global: true });
    this.ctx.on('domain/changed', change => {
      if (change.domain !== workspaceDomainSpec.name || change.table !== '' || change.operation !== 'put') return;
      const next = workspaceDomainState.safeParse(change.value);
      if (!next.success) { this.archiveFault = true; return; }
      this.archiveFault = false; const previous = this.committedArchives;
      this.committedArchives = new Set(next.data.archivedSessionIds);
      for (const id of this.committedArchives) if (!previous.has(id)) this.noticeArchive(id);
      for (const id of previous) if (!this.committedArchives.has(id)) {
        this.pendingUnarchives.add(id);
        this.enqueue(() => this.reconcileUnarchive(id)).catch(() => this.ctx.logger.warn('Session teams unarchive reconciliation is pending.'));
      }
    });
    this.ctx.on('workspace/session-archived', ({ sessionId }) => this.noticeArchive(sessionId));
    this.ctx.on('workspace/session-unarchiving', ({ sessionId }) => {
      this.pendingArchives.add(sessionId);
      return this.enqueue(() => this.retire(sessionId));
    });
  }
  publish(state) {
    // Replace caches only after the backend acknowledged the whole aggregate.
    this.snapshot = Core.validateState(state);
    this.participantIds = new Set(this.snapshot.teams.filter(team => team.status === 'active').flatMap(team => [team.managerId, ...team.memberIds]));
    this.contexts = new Map([...this.participantIds].map(id => [id, Core.context(this.snapshot, id)]));
    this.teamPeers = new Map([...this.participantIds].map(id => [id, new Set([id])]));
    for (const team of this.snapshot.teams.filter(team => team.status === 'active')) {
      const ids = [team.managerId, ...team.memberIds];
      for (const id of ids) for (const peer of ids) this.teamPeers.get(id)?.add(peer);
    }
    for (const person of this.snapshot.sessions) if (!person.focus.withUser && this.focusHolds.get(person.id) === person.focus.userMessageId) this.focusHolds.delete(person.id);
    this.updateStatusFacts();
  }
  updateStatusFacts() {
    if (!this.snapshot) return;
    const s = this.snapshot, facts = {};
    for (const id of this.participantIds) {
      const person = s.sessions.find(p => p.id === id), teams = s.teams.filter(t => t.status === 'active' && [t.managerId, ...t.memberIds].includes(id));
      const tasks = teams.flatMap(t => t.assignments.filter(a => a.targetId === id && a.status === 'current' && a.generation === s.generation && a.tenure === t.tenures[id]));
      const alert = s.alerts.find(a => a.targetId === id && a.needsUser && !a.resolved && (!a.assignmentRevision || tasks.some(task => task.revision === a.assignmentRevision && task.workStatus !== 'complete')) && teams.some(t => t.id === a.teamId && t.epoch === a.epoch && t.tenures[id] === a.targetTenure));
      const withUser = this.focusHolds.has(id) || person.focus.withUser;
      const waiting = !tasks.some(a => ['ready', 'in-progress'].includes(a.workStatus)) && tasks.some(a => a.workStatus === 'waiting');
      const complete = tasks.length > 0 && tasks.every(a => a.workStatus === 'complete');
      const pendingCount = s.attention.filter(e => e.recipientId === id && e.generation === s.generation && e.sequence > (person.acknowledgment.generation === s.generation ? person.acknowledgment.throughSequence : 0) && teams.some(t => t.id === e.teamId && (e.epoch === undefined || e.epoch === t.epoch))).length;
      Object.defineProperty(facts, id, { enumerable: true, value: { withUser, needsIntervention: !!alert, waiting, complete, pendingCount, reason: alert?.text || (withUser ? 'With user; team delivery is held.' : waiting ? tasks.find(a => a.workStatus === 'waiting').waitingReason : '') } });
    }
    const json = JSON.stringify(facts); if (json === this.statusJSON) return;
    this.statusJSON = json; this.statusFacts = facts; this.statusVersion++;
    for (const notify of [...this.statusWaiters]) notify();
  }
  async waitStatus(peer, signal, query) {
    this.owner(peer, signal);
    if (query.after === this.statusVersion) await new Promise((resolve, reject) => {
      const signals = [...new Set([signal, peer?.signal].filter(Boolean))]; let timer;
      const clean = () => { clearTimeout(timer); this.statusWaiters.delete(done); for (const source of signals) source.removeEventListener('abort', abort); };
      const done = () => { clean(); resolve(); };
      const abort = () => { clean(); reject(new AdapterError('CANCELLED', 'Status observation ended.')); };
      this.statusWaiters.add(done); timer = setTimeout(done, 20000);
      for (const source of signals) source.addEventListener('abort', abort, { once: true });
      if (signals.some(source => source.aborted)) abort(); else if (query.after !== this.statusVersion || this.closing) done();
    });
    this.owner(peer, signal);
    return { state: { statusVersion: this.statusVersion, statuses: clone(this.statusFacts) } };
  }
  async loadLabels(ids) {
    // Cosmetic native metadata only. A cold title read never attaches or wakes an Agent.
    const query = this.ctx.get('sessionQuery');
    if (!query || !ids.length) return;
    try {
      for (const result of await query.readTitleSnapshots([...new Set(ids)])) if (result.status === 'fulfilled') this.labels.set(result.sessionId,
        { id: result.sessionId, title: result.value.title?.title ?? '', cwd: result.value.session.cwd ?? '' });
    } catch { /* Missing title metadata must not disable ordinary coordination. */ }
  }
  nativeLabel(id) {
    const cached = this.labels.get(id) ?? { id, title: '', cwd: '' };
    try {
      const session = this.ctx.sessions.get(id);
      if (!session) return { ...cached };
      return { id, title: this.ctx.get('sessionTitle')?.get(session)?.title ?? cached.title, cwd: session.header.cwd ?? '' };
    } catch { return { ...cached }; }
  }
  withObservations(value) {
    const observation = (id, fallback) => this.observations.get(id) ?? fallback;
    const result = { ...value };
    if (Array.isArray(value.wakeups)) result.wakeups = value.wakeups.map(wake => ({ ...wake, mode: Core.wakeMode(this.snapshot, wake), heldReason: this.deliveryHoldReason(wake) }));
    if (value.sessions) result.sessions = value.sessions.map(person => ({ ...person, observation: observation(person.id, person.observation) }));
    if (value.session) result.session = { ...value.session, observation: observation(value.session.id, value.session.observation) };
    if (value.members) result.members = value.members.map(person => {
      const base = observation(person.id, person.observation), facts = this.statusFacts[person.id];
      const approvalPending = this.ctx.get('typertGateway')?.getPendingRemoteEvents().some(e => e.agentId === person.id && e.event === 'approval/request') ?? false;
      const observed = { ...base, approvalPending };
      const visibleState = observed.archived || observed.availability !== 'available' ? 'Unavailable' : facts?.needsIntervention ? 'Needs intervention' : approvalPending ? 'Approval needed' : facts?.withUser ? 'With user' : observed.execution === 'running' ? 'Running' : facts?.waiting ? 'Waiting' : facts?.complete ? 'Complete' : 'Idle';
      return { ...person, observation: observed, visibleState, coordinationStatus: facts };
    });
    return result;
  }
  deliveryHoldReason(wake) {
    if (!['pending', 'claimed'].includes(wake.status)) return null;
    const state = this.snapshot, team = state.teams.find(t => t.id === wake.teamId), person = state.sessions.find(p => p.id === wake.sessionId);
    if (!team || team.status !== 'active') return 'Team is retired or unavailable.';
    if (this.closing || !this.initialized) return 'Coordination runtime is not ready.';
    if (state.reviewRequired) return 'Owner startup review is required.';
    if (!team.automation) return 'Team automation is paused.';
    if (this.focusHolds.has(wake.sessionId) || person?.focus.withUser) return 'With user: automatic team delivery is held.';
    if (this.archiveFault || this.pendingArchives.has(wake.sessionId) || person?.observation.archived) return 'Native archive reconciliation or retirement is pending.';
    if (!Core.wakeApplicable(state, wake, false)) return 'Current work, membership or decision no longer matches this event.';
    if (!Core.wakeApplicable(state, wake, true)) return 'An explicit manager-reserved hold or another delivery gate still applies.';
    const agent = this.ctx.agents.get(wake.sessionId);
    if (this.delivery.nativePending(wake.sessionId)) return 'A native interaction must be resolved before automatic delivery.';
    if (agent && agent.status !== 'idle') return 'Member is executing; the durable event will be reconsidered at idle.';
    if (agent && [...agent.inbox.nextTurn, ...agent.inbox.nextStep].length) return 'Existing native input takes priority.';
    return wake.status === 'claimed' ? 'Native admission is in progress; no understanding is established.' : Core.wakeMode(state, wake) === 'reassess' ? 'Eligible for one wait-reassessment notice only; work remains Waiting until its genuine prerequisites are resolved.' : 'Eligible for the next bounded delivery pass.';
  }
  async setups(ids, signal) {
    const result = {};
    for (const id of new Set(ids)) {
      if (signal?.aborted) throw new AdapterError('CANCELLED', 'Setup read was cancelled.');
      try { Object.defineProperty(result, id, { value: await this.environment.read(id, { signal }), enumerable: true }); }
      catch { Object.defineProperty(result, id, { value: { id, state: 'unknown', loaded: false, unknownMarkers: ['Native setup could not be verified.'] }, enumerable: true }); }
    }
    return result;
  }
  setupTeam(state, actor, query) {
    const team = state.teams.find(team => team.id === query.teamId), roster = team ? [team.managerId, ...team.memberIds] : [];
    check(team && roster.includes(query.sessionId), 'NOT_MEMBER', 'Select a current teammate.');
    check(actor.kind === 'owner' || team.status === 'active' && roster.includes(actor.id), 'FORBIDDEN', 'Current immediate team membership required.');
    return team;
  }
  async readForAgent(state, actor, query, signal) {
    let value;
    if (query.type === 'worker-setup') {
      this.setupTeam(state, { kind: 'session', id: actor.id }, query);
      value = { teamId: query.teamId, setup: await this.environment.read(query.sessionId, { detail: query.detail, signal }) };
    } else {
      value = this.withObservations(Core.read(state, { kind: 'session', id: actor.id }, query));
      if (query.type === 'profile' && value.team) value.workerSetups = await this.setups([value.team.managerId, ...value.team.memberIds], signal);
    }
    this.agent(actor, signal);
    check(!this.archived(actor.id) && ![...(this.teamPeers.get(actor.id) ?? [])].some(id => this.pendingArchives.has(id)), 'UNAVAILABLE', 'Native membership changed during the read; retrieve current team state.');
    const ids = new Set([actor.id]);
    for (const team of state.teams) if (team.status === 'active' && [team.managerId, ...team.memberIds].includes(actor.id)) for (const id of [team.managerId, ...team.memberIds]) ids.add(id);
    return { ...value, nativeSessions: [...ids].map(id => this.nativeLabel(id)) };
  }
  ledger() { return Core.validateState(this.table.get(KEY)); }
  closeoutFor(agent, command) {
    if (!agent || agent.status !== 'running') return null;
    return [...this.closeouts.values()].find(p => p.agent === agent && (!command || p.teamId === command.teamId && p.assignmentRevision === command.assignmentRevision && (command.assignmentVersion === undefined || p.assignmentVersion === command.assignmentVersion))) ?? null;
  }
  hasFocus(id) { return this.focusHolds.has(id) || this.snapshot?.sessions.some(p => p.id === id && p.focus.withUser); }
  participates(agent) { return !this.closing && !!agent && typeof agent.id === 'string' && this.ctx.agents.get(agent.id) === agent && (this.participantIds.has(agent.id) || !!this.closeoutFor(agent) || this.hasFocus(agent.id)); }
  contextFor(scope) {
    // Called by prompt assembly/admission: no durable reads, IO, mutation or throwing predicates.
    try {
      if (!this.participates(scope)) return '';
      if (!this.participantIds.has(scope.id) && this.hasFocus(scope.id)) return 'WITH USER. Your native Session remains independent; no active team work is implied. Prioritize the user conversation. On a clear hand-back use set-user-focus {withUser:false,expectedUserMessageId:' + (this.focusHolds.get(scope.id) ?? this.snapshot.sessions.find(p => p.id === scope.id).focus.userMessageId) + '}. Only your own focus may be changed.';
      if (!this.participantIds.has(scope.id)) return 'Your team was retired while this native run was active. Do not continue its old instructions. You may save a final factual result for already-performed work with finish-assignment using the original exact assignment reference; it will be historical evidence, not resumed work. Your native Session remains independent.';
      const heldMessage = this.focusHolds.get(scope.id);
      if (heldMessage && heldMessage !== this.snapshot.sessions.find(p => p.id === scope.id)?.focus.userMessageId) return 'WITH USER: prioritize the latest direct user conversation. Incoming team information is retained, not automatically injected. Do not start unsolicited team work. For an explicitly approved prepared dispatch, use confirm-dispatch with this exact expectedUserMessageId; it activates the reviewed plan and releases focus atomically by default. Do not release focus first. Otherwise on a clear user hand-back use set-user-focus false with expectedUserMessageId:' + heldMessage + '. Silence or merely receiving a reply is not approval. No other Session can release this hold.';
      if (this.ctx.storageDomain.get(DOMAIN) !== this.domain) return 'Session teams is temporarily unavailable. Do not claim coordination changes succeeded. Ordinary session execution is independent.';
      if (this.archiveFault || [...this.pendingArchives].some(id => this.teamPeers.get(scope.id)?.has(id))) return 'Session teams: native archive reconciliation is pending. Prior assignments are not current instructions. Retrieve current team state before coordinating work; ordinary independent session work remains available.';
      const base = this.contexts.get(scope.id) ?? '';
      let labels = '\nNative session titles (display labels, not editable work identities):';
      for (const id of this.teamPeers.get(scope.id) ?? []) {
        const value = this.nativeLabel(id); if (!value.title) continue;
        const line = '\n' + id + ' — ' + [...value.title].slice(0, 80).join('');
        if (Buffer.byteLength(labels + line, 'utf8') > 1600) break; labels += line;
      }
      const buffer = Buffer.from(base, 'utf8'); let end = Math.min(buffer.length, 6000);
      while (end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--;
      const bounded = buffer.subarray(0, end).toString('utf8');
      return bounded + (buffer.length > end ? '\n[Context shortened; read profile/inbox for exact records.]' : '') + (labels.includes(' — ') ? labels : '');
    } catch { return ''; }
  }
  owner(peer, signal) {
    check(!this.closing, 'CLOSED', 'Session teams is closing.');
    check(peer?.principal?.kind === 'owner', 'OWNER_REQUIRED', 'An actual authenticated owner invocation is required.');
    check(!peer.signal?.aborted && !signal?.aborted, 'CANCELLED', 'Owner invocation is no longer active.');
  }
  agent(agent, signal) {
    check(!this.closing, 'CLOSED', 'Session teams is closing.');
    check(agent && this.ctx.agents.get(agent.id) === agent, 'AGENT_REQUIRED', 'The actual currently registered Agent is required.');
    check(!signal?.aborted, 'CANCELLED', 'Tool invocation was cancelled.');
    check(this.participantIds.has(agent.id) || !!this.closeoutFor(agent) || this.hasFocus(agent.id), 'NOT_REGISTERED', 'This Session has no active coordination or in-flight closeout record.');
  }
  async sample(id) {
    const live = this.ctx.sessions.get(id);
    let known = !!live, compatible = !live || live.header.version === SESSION_FORMAT_VERSION && live.header.origin !== 'subagent';
    if (!known) {
      try {
        const record = await this.ctx.sessionPersistence.stat(id); known = !!record;
        compatible = !record || record.header.id === id && record.header.origin !== 'subagent' && record.header.version === SESSION_FORMAT_VERSION && (record.formatStatus === undefined || record.formatStatus === 'current');
      } catch { return { sessionId: id, availability: 'unknown', execution: 'unknown', archived: this.archived(id) }; }
    }
    const agent = this.ctx.agents.get(id);
    return { sessionId: id, availability: compatible ? known ? 'available' : 'missing' : 'unknown',
      execution: agent ? agent.status === 'running' ? 'running' : 'idle' : known ? 'unloaded' : 'unknown', archived: this.archived(id) };
  }
  async commit(actor, command, gate = () => {}, observations = []) {
    let outcome; const closeouts = [];
    const next = await this.table.update(KEY, current => {
      gate();
      if (command.type === 'retire-team') {
        const team = current.teams.find(t => t.id === command.teamId);
        for (const a of team?.assignments ?? []) if (a.status === 'current' && a.generation === current.generation) {
          const agent = this.ctx.agents.get(a.targetId);
          if (agent?.status === 'running') closeouts.push({ teamId: team.id, assignmentRevision: a.revision, assignmentVersion: a.version, agent });
        }
      }
      const changed = Core.transition(current, actor, command, new Date().toISOString()); outcome = changed.result;
      let state = changed.state;
      for (const observation of observations) this.observations.set(observation.sessionId, observation);
      const archives = observations.filter(observation => observation.archived && state.sessions.some(member => member.id === observation.sessionId && !member.observation.archived));
      if (archives.length) state = Core.transition(state, { kind: 'host' }, { type: 'observe', observations: archives }, new Date().toISOString()).state;
      return state;
    });
    this.publish(next);
    for (const permit of closeouts) if (this.ctx.agents.get(permit.agent.id) === permit.agent && permit.agent.status === 'running') this.closeouts.set(permit.teamId + '\0' + permit.assignmentRevision, permit);
    if (!['claim-wakes', 'settle-wakes', 'defer-wakes'].includes(command.type)) this.delivery.kick();
    return { ...outcome, ...(actor.kind === 'owner' ? { revision: next.revision } : {}), generation: next.generation, reviewRequired: next.reviewRequired };
  }
  async refresh() {
    for (const id of [...this.pendingArchives]) await this.retire(id);
    for (const id of [...this.pendingUnarchives]) await this.reconcileUnarchive(id);
    const state = this.ledger(), archives = [];
    const ids = new Set(state.teams.filter(team => team.status === 'active').flatMap(team => [team.managerId, ...team.memberIds]));
    for (const id of ids) {
      const observation = await this.sample(id); observation.archived = this.archived(id);
      this.observations.set(id, observation);
      if (observation.archived && state.sessions.some(member => member.id === id && !member.observation.archived)) archives.push(observation);
    }
    if (archives.length) await this.commit({ kind: 'host' }, { type: 'observe', observations: archives });
  }
  async retire(id) {
    const member = this.ledger().sessions.find(member => member.id === id);
    if (member) {
      const base = this.observations.get(id) ?? member.observation;
      const observation = { sessionId: id, availability: base.availability, execution: base.execution, archived: true };
      this.observations.set(id, observation);
      if (!member.observation.archived) await this.commit({ kind: 'host' }, { type: 'observe', observations: [observation] });
    }
    this.pendingArchives.delete(id);
  }
  async reconcileUnarchive(id) {
    if (this.archived(id)) return; // The native registry may still be publishing its committed change.
    const member = this.ledger().sessions.find(member => member.id === id);
    if (member?.observation.archived) {
      const observation = { sessionId: id, availability: member.observation.availability, execution: member.observation.execution, archived: false };
      this.observations.set(id, observation);
      await this.commit({ kind: 'host' }, { type: 'observe', observations: [observation] });
    }
    this.pendingUnarchives.delete(id);
  }
  checkPrecondition(precondition) {
    if (!precondition) return;
    const state = this.ledger();
    check(state.revision === precondition.expectedRevision && state.generation === precondition.expectedGeneration && Core.token(state) === precondition.reviewToken,
      'REVISION_CONFLICT', 'This owner preview is stale. Refresh and review the proposed setup again.');
  }
  affected(command, actor) {
    const ids = new Set(actor ? [actor.id] : []);
    for (const key of ['targetId', 'managerId', 'to']) if (command[key]) ids.add(command[key]);
    for (const entry of command.assignments ?? []) if (entry.afterSessionId) ids.add(entry.afterSessionId);
    const state = this.ledger(), team = state.teams.find(team => team.id === command.teamId);
    const plan = command.type === 'prepare-dispatch' ? command.plan : command.type === 'confirm-dispatch' ? state.dispatches.find(d => d.teamId === command.teamId && d.id === command.dispatchId)?.plan : null;
    if (plan) for (const field of ['identities', 'responsibilities', 'assignments', 'statuses']) for (const entry of plan[field] ?? []) { ids.add(entry.targetId); if (entry.afterSessionId) ids.add(entry.afterSessionId); }
    for (const entry of command.continueAssignments ?? []) ids.add(entry.sessionId);
    if (team) ids.add(team.managerId);
    for (const id of command.memberIds ?? command.concernedIds ?? []) ids.add(id);
    for (const field of ['identities', 'responsibilities', 'assignments', 'statuses']) for (const entry of command[field] ?? []) ids.add(entry.targetId);
    if (['revise-proposal', 'respond-proposal', 'accept-proposal'].includes(command.type)) {
      const proposal = state.proposals.find(proposal => proposal.id === command.proposalId && proposal.teamId === command.teamId);
      const revision = proposal?.revisions.at(-1);
      if (revision?.identityChange?.targetId) ids.add(revision.identityChange.targetId);
      if (command.type !== 'revise-proposal') for (const member of revision?.concerned ?? []) ids.add(member.id);
    }
    return [...ids];
  }
  async administer(peer, signal, raw, rawPrecondition) {
    this.owner(peer, signal); const command = parse(Core.ownerCommandSchema, raw);
    const precondition = rawPrecondition === undefined ? null : parse(preconditionSchema, rawPrecondition);
    return this.enqueue(async () => {
      this.owner(peer, signal); await this.refresh();
      const observations = [];
      if (command.type === 'save-team') {
        for (const id of new Set([command.managerId, ...command.memberIds])) {
          const observation = await this.sample(id);
          check(observation.availability === 'available' && !observation.archived, 'UNAVAILABLE', 'Select existing compatible, unarchived Sessions. No Session is created or woken by setup.'); observations.push(observation);
        }
        await this.loadLabels(observations.map(observation => observation.sessionId));
      }
      const gate = () => {
        this.owner(peer, signal); this.checkPrecondition(precondition);
        if (command.type === 'save-team') for (const observation of observations) check(!this.archived(observation.sessionId), 'ARCHIVED', 'A selected Session was archived while setup was pending.');
        if (command.type === 'review-startup') for (const team of this.ledger().teams.filter(team => team.status === 'active')) {
          for (const id of [team.managerId, ...team.memberIds]) {
            const member = this.ledger().sessions.find(member => member.id === id);
            check((this.observations.get(id) ?? member?.observation)?.availability === 'available' && !this.archived(id), 'UNAVAILABLE', 'An active team endpoint cannot currently be verified.');
          }
        }
      };
      return this.commit({ kind: 'owner' }, command, gate, observations);
    });
  }
  async inspect(peer, signal, raw) {
    this.owner(peer, signal); const query = parse(ownerQuerySchema, raw);
    if (query.type === 'status') return this.waitStatus(peer, signal, query);
    return this.enqueue(async () => {
      this.owner(peer, signal); await this.refresh(); this.owner(peer, signal);
      const state = this.ledger(); let value;
      if (query.type === 'worker-setup') {
        this.setupTeam(state, { kind: 'owner' }, query);
        value = { teamId: query.teamId, setup: await this.environment.read(query.sessionId, { detail: query.detail, signal }) };
      } else {
        value = Core.read(state, { kind: 'owner' }, query);
        if (!['history', 'export'].includes(query.type)) value = this.withObservations(value);
        if (query.type === 'snapshot') value.workerSetups = await this.setups(state.teams.filter(team => team.status === 'active').flatMap(team => [team.managerId, ...team.memberIds]), signal);
      }
      this.owner(peer, signal);
      return { state: value, reviewToken: Core.token(state) };
    });
  }
  async execute(exec, raw) {
    this.agent(exec?.agent, exec?.signal); const request = parse(actionSchema, raw), actor = exec.agent, signal = exec.signal;
    return this.enqueue(async () => {
      this.agent(actor, signal);
      await this.refresh(); this.agent(actor, signal);
      if (request.action === 'execute' && request.command.type === 'set-user-focus') {
        const command = request.command;
        check(command.withUser === false, 'FORBIDDEN', 'Only actual native user input enters With user; this command is conversational hand-back only.');
        return this.commit({ kind: 'session', id: actor.id }, command, () => {
          this.agent(actor, signal); check(!this.archived(actor.id), 'ARCHIVED', 'Archived Session cannot change coordination focus.');
          check((this.focusHolds.get(actor.id) ?? this.snapshot.sessions.find(p => p.id === actor.id)?.focus.userMessageId) === command.expectedUserMessageId, 'STALE_FOCUS', 'A newer user message retains this hold.');
        });
      }
      if (request.action === 'read' && !this.participantIds.has(actor.id) && !this.closeoutFor(actor)) return { focus: clone(this.snapshot.sessions.find(p => p.id === actor.id).focus), message: 'No active team. Own conversational focus can be released; historical records remain in the team UI.' };
      const targetTeamId = request.action === 'execute' ? request.command.teamId : request.query.teamId;
      if (!this.participantIds.has(actor.id) || this.snapshot.teams.some(t => t.id === targetTeamId && t.status !== 'active') && this.closeoutFor(actor)) {
        const permit = request.action === 'execute' ? this.closeoutFor(actor, request.command) : this.closeoutFor(actor);
        check(permit, 'INACTIVE', 'Team retired; no new coordination work may start.');
        if (request.action === 'read') return { retired: true, message: 'Only a final factual report for already-running work may be saved.', closeouts: [...this.closeouts.values()].filter(p => p.agent === actor).map(({ teamId, assignmentRevision, assignmentVersion }) => ({ teamId, assignmentRevision, assignmentVersion })) };
        const c = request.command;
        check(['finish-assignment', 'report'].includes(c.type), 'INACTIVE', 'Retired team permits only the captured run final factual report.');
        const gate = () => { this.agent(actor, signal); check(this.closeoutFor(actor, c) === permit && !this.archived(actor.id), 'INACTIVE', 'The captured native run has ended.'); };
        const late = { type: 'record-late-report', teamId: permit.teamId, sessionId: actor.id, assignmentRevision: permit.assignmentRevision, assignmentVersion: permit.assignmentVersion, reportId: c.reportId, text: c.text, status: c.type === 'report' ? c.status : 'complete', ...(c.expectedReportVersion === undefined ? {} : { expectedReportVersion: c.expectedReportVersion }) };
        const result = await this.commit({ kind: 'host' }, late, gate);
        this.closeouts.delete(permit.teamId + '\0' + permit.assignmentRevision); return { ...result, historical: true, retired: true };
      }
      if (request.action === 'read') return this.readForAgent(this.ledger(), actor, request.query, signal);
      const command = request.command;
      const gate = () => {
        this.agent(actor, signal);
        if (['prepare-dispatch', 'confirm-dispatch'].includes(command.type) || command.type === 'set-user-focus' && !command.withUser) check((this.focusHolds.get(actor.id) ?? this.snapshot.sessions.find(p => p.id === actor.id)?.focus.userMessageId) === command.expectedUserMessageId, 'STALE_FOCUS', 'A newer actual user message supersedes this preview, confirmation or hand-back.');
        check(!this.archived(actor.id), 'ARCHIVED', 'This Session is archived or awaiting retirement.');
        if (!['report', 'correct-report', 'acknowledge'].includes(command.type)) for (const id of this.affected(command, actor)) {
          check(!this.archived(id), 'ARCHIVED', 'An affected Session is archived or awaiting retirement.');
          const member = this.ledger().sessions.find(member => member.id === id);
          check((this.observations.get(id) ?? member?.observation)?.availability === 'available', 'UNAVAILABLE', 'An affected Session is currently unavailable.');
        }
      };
      return this.commit({ kind: 'session', id: actor.id }, command, gate);
    });
  }
  async open() {
    this.committedArchives = this.archiveSet(); this.installListeners();
    this.domain = await this.ctx.storageDomain.open(domainSpec);
    try {
      check(!this.closing, 'CLOSED', 'Session teams was disposed during startup.');
      this.backupDomain = await this.ctx.storageDomain.open(backupDomainSpec);
      this.table = this.domain.table('ledgers');
      check([...this.table.keys()].every(key => key === KEY), 'INVALID_STATE', 'Unexpected coordination ledger key.');
      const cold = this.backupDomain.table('backups'), hot = this.domain.table('backups');
      const preserve = async original => {
        const legacy = original.schemaVersion === 2 ? Legacy : original.schemaVersion === 3 ? Legacy3 : original.schemaVersion === 4 ? Legacy4 : Legacy5;
        const saved = legacy.validateState(original), digest = legacy.token(saved), key = `v${saved.schemaVersion}-${digest}`;
        const existing = cold.get(key);
        if (existing === undefined) await cold.put(key, saved);
        else check(existing.schemaVersion === saved.schemaVersion && legacy.token(existing) === digest, 'INVALID_BACKUP', 'An existing migration backup does not match.');
      };
      for (const [, original] of hot.entries()) await preserve(original);
      const inherited = this.table.get(KEY);
      if (inherited && [2, 3, 4, 5].includes(inherited.schemaVersion)) await preserve(inherited);
      check(!this.closing, 'CLOSED', 'Session teams was disposed during backup.');
      if (inherited === undefined) await this.table.put(KEY, Core.initialState());
      this.publish(await this.table.update(KEY, state => {
        check(!this.closing, 'CLOSED', 'Session teams was disposed during startup.');
        const upgraded = state.schemaVersion === 2 ? Core.upgradeV2(state) : state.schemaVersion === 3 ? Core.upgradeV3(state) : state.schemaVersion === 4 ? Core.upgradeV4(state) : state.schemaVersion === 5 ? Core.upgradeV5(state) : Core.validateState(state);
        return Core.start(upgraded, new Date().toISOString());
      }));
      // These logical entries are now verified in the separate durable backup unit.
      // Remove only those entries, never user reports/teams or a filesystem path.
      await hot.deleteMany([...hot.keys()]);
      await this.enqueue(() => this.refresh());
      await this.loadLabels(this.snapshot.teams.filter(team => team.status === 'active').flatMap(team => [team.managerId, ...team.memberIds]));
      check(!this.closing, 'CLOSED', 'Session teams was disposed during startup.');
      this.initialized = true; return this;
    } catch (error) { if (this.backupDomain) await this.backupDomain.close(); await this.domain.close(); throw error; }
  }
  async close() { this.closing = true; for (const notify of [...this.statusWaiters]) notify(); await this.delivery.close(); await this.tail; this.contexts.clear(); this.closeouts.clear(); this.environment.dispose(); if (this.backupDomain) await this.backupDomain.close(); if (this.domain) await this.domain.close(); }
}
const remoteInitializers = [];
function remote(prototype, name) { Remote(prototype[name], { kind: 'method', name, static: false, private: false, addInitializer: initializer => remoteInitializers.push(initializer) }); }
class SessionTeams extends TypertRemoteService {
  static inject = ['storageDomain', 'tools', 'agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'systemPrompt'];
  static Config = z.object({ maxAutomaticWakesPerBurst: z.number().int().min(1).max(1000).default(24) }).default({ maxAutomaticWakesPerBurst: 24 });
  constructor(ctx, config = {}) { super(ctx, 'sessionTeams'); this.options = SessionTeams.Config.parse(config); for (const initialize of remoteInitializers) initialize.call(this); }
  async [Service.init]() {
    const runtime = new Runtime(this.ctx, this.options); this.ctx.effect(() => async () => { await runtime.close(); }, 'sessionTeams: drain and close');
    this.runtime = await runtime.open();
    this.ctx.tools.register({ name: 'session_teams',
      description: "Coordinate existing native Sessions through durable team records. V0.5.2: relevant accepted decisions, exact required replies and handoffs can notify a prerequisite-waiting worker for bounded REASSESSMENT ONLY. They do not clear its wait or authorize execution; the worker uses exact evidence to clear only satisfied own prerequisites, preserves manager-reserved holds/required requests/predecessors, otherwise keeps Waiting and stops. Do not send a separate manager acceptance notification as a routine relay. No polling or repeated self-wakes. V0.5.1 dispatch: prepare-dispatch stores an immutable exact plan without activating work. Present its plan, permissionExpectations and the default return to automatic coordination to the user BEFORE dispatch. confirm-dispatch requires a fresh actual user reply explicitly approving that preview; approved:true attests its meaning, not merely its arrival. It atomically activates that exact plan and releases With user by default; returnToCoordination:false explicitly keeps manager follow-up held while workers run. Do not call set-user-focus first. Direct update-work cannot create/replace assignments; ordinary handoffs within a confirmed chain remain authorized. Native operation approval is separate. Accepting work proposals normally supplies continueAssignments with exact affected current task refs; recordOnly:true explicitly records without continuation. Acceptance commits durable continuation intent even if the member is busy or otherwise held; it never overrides blockers, repeats finished tasks or grants permissions. Delivery read shows native input admission/hold reasons, never proof of understanding. Automatic delivery wakes actionable work, not routine acknowledgments; it grants no permissions. Trust worker reports by default: do not reread every artifact or duplicate verification. Delegate outcomes, acceptance criteria and necessary constraints, not step-by-step methods. Workers and managers may use native subagents creatively; the parent retains responsibility. Ask peers for needed information; use focused checks only for a specific uncertainty. Record direct peer requests/replies/handoffs with message, raising an alert when manager/user action is genuinely needed. Only actual work prerequisites cause Waiting; optional questions and unrelated proposals do not. Manager can bind downstream assignments with afterSessionId for direct successful handoff without relay. Profile already contains bounded workerSetups; request worker-setup detail only if needed, never as a ritual. Registered tools and ask policy do not guarantee admission/approval; executing worker handles exact native permission. Use stable concise objective and responsibilities; deliberate set-objective changes the mission. No synthetic manager self-task or compulsory todo/final summary. Use local plan/task/report/proposal guards and receipt versions, not global revisions or repeated reads. finish-assignment atomically saves exact own result. updates returns compact current records and exact proposal responses/readiness; reads are not acknowledgment. Optional explicit acknowledgment can accompany work/report/message/vote. Manager-created proposals can include concernedIds and ownResponse:agree in revision1; mandatory manager/originator/identity-target parties are included explicitly by confirmation, never auto-voted. Workers may suggest parties with suggestedConcernedIds, not confirm them with concernedIds. Concerned-party explicit current unanimity remains necessary before accept-proposal. WITH USER prioritizes the latest direct user conversation; no focus toggle. On clear user hand-back use set-user-focus false with exact expectedUserMessageId. Silence is not hand-back or agreement. Manager may retire its team without a closeout checklist; old work/consent never replays. Native Sessions/presets/tools/history remain independent. Do not generate artificial messages or status writes to keep automation going.",
      parameters: { type: 'object', ...z.toJSONSchema(actionSchema, { target: 'draft-7', unrepresentable: 'any' }) },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => { try { return await runtime.execute(exec, args); } catch (error) { throw asTool(error); } },
    }, { when: ({ agent }) => runtime.participates(agent) });
    this.ctx.systemPrompt.context({ name: 'session-teams-v4', order: 850, required: true, interpolate: false, text: ({ scope }) => runtime.contextFor(scope) });
  }
  async administer(command, precondition) { try { const invocation = this.ctx.invocation; return await this.runtime.administer(invocation?.peer, invocation?.signal, command, precondition); } catch (error) { throw asRemote(error); } }
  async inspect(query) { try { const invocation = this.ctx.invocation; return await this.runtime.inspect(invocation?.peer, invocation?.signal, query); } catch (error) { throw asRemote(error); } }
}
for (const name of ['administer', 'inspect']) remote(SessionTeams.prototype, name);
module.exports = { SessionTeams, Runtime, AdapterError, domainSpec, backupDomainSpec, actionSchema };
