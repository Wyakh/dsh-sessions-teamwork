/* Workspace-only v0.5.1 Client. Factory is lazy and pure until apply; no private Client imports. */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else window.__ModuleLoader__.load({ id: '@local/session-coordination', factory });
})(function (require) {
  'use strict';
  const PANEL = 'session-coordination', NS = 'sessionTeamsV51';
  const clone = value => structuredClone(value), latest = values => values?.at(-1);
  const failure = code => Object.assign(new Error(code), { code });
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  function id(value) { if (!validId(value)) throw failure('INPUT_INVALID'); return value; }
  function text(value, max, required = true) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (required && !result || result.length > max) throw failure('INPUT_INVALID');
    return result;
  }
  function validDispatchPlan(plan) {
    const positive = number => Number.isSafeInteger(number) && number > 0;
    if (!plan || !['identities', 'responsibilities', 'assignments', 'statuses'].every(key => Array.isArray(plan[key]))) return false;
    if (['objective', 'exceptionalRules'].some(key => plan[key] !== undefined && typeof plan[key] !== 'string') || plan.automation !== undefined && typeof plan.automation !== 'boolean') return false;
    if (plan.identities.some(item => !validId(item?.targetId) || typeof item.identity !== 'string') || plan.responsibilities.some(item => !validId(item?.targetId) || typeof item.text !== 'string')) return false;
    if (plan.assignments.some(item => !validId(item?.targetId) || typeof item.text !== 'string'
      || item.expectedAssignment !== null && (!item.expectedAssignment || !positive(item.expectedAssignment.assignmentRevision) || !positive(item.expectedAssignment.assignmentVersion))
      || item.afterSessionId !== undefined && !validId(item.afterSessionId) || item.workStatus !== undefined && !['ready', 'waiting'].includes(item.workStatus)
      || item.waitingReason !== undefined && typeof item.waitingReason !== 'string')) return false;
    return !plan.statuses.some(item => !validId(item?.targetId) || !positive(item.assignmentRevision) || !positive(item.assignmentVersion)
      || !['ready', 'waiting', 'in-progress', 'complete'].includes(item.workStatus) || item.waitingReason !== undefined && typeof item.waitingReason !== 'string');
  }
  function verifyView(view) {
    const state = view?.state, integer = value => Number.isSafeInteger(value) && value >= 0;
    const arrays = ['sessions', 'teams', 'reports', 'proposals', 'comments', 'attention', 'messages', 'alerts', 'wakeups', 'dispatches'];
    if (!state || state.schemaVersion !== 6 || !integer(state.revision) || !integer(state.generation)
      || typeof state.reviewRequired !== 'boolean' || !arrays.every(key => Array.isArray(state[key]))
      || !/^[a-f0-9]{64}$/.test(view.reviewToken)) throw failure('INVALID_RESPONSE');
    for (const session of state.sessions) if (!validId(session?.id) || typeof session.identity !== 'string' || !session.observation
      || !['available', 'missing', 'unknown'].includes(session.observation.availability) || !['idle', 'running', 'unloaded', 'unknown'].includes(session.observation.execution)
      || typeof session.observation.archived !== 'boolean' || !session.focus || typeof session.focus.withUser !== 'boolean'
      || session.focus.userMessageId !== null && typeof session.focus.userMessageId !== 'string') throw failure('INVALID_RESPONSE');
    for (const team of state.teams) {
      if (!validId(team?.id) || typeof team.title !== 'string' || typeof team.description !== 'string'
        || !integer(team.planVersion) || team.planVersion < 1 || !integer(team.epoch) || team.epoch < 1 || typeof team.automation !== 'boolean' || !validId(team.managerId) || !Array.isArray(team.memberIds) || !team.memberIds.every(validId)
        || !team.tenures || typeof team.tenures !== 'object' || ![team.managerId, ...team.memberIds].every(who => integer(team.tenures[who]) && team.tenures[who] > 0)
        || !['active', 'idle'].includes(team.status) || !['brief', 'responsibilities', 'assignments', 'identities', 'history'].every(key => Array.isArray(team[key]))) throw failure('INVALID_RESPONSE');
      for (const item of [...team.brief, ...team.responsibilities, ...team.identities, ...team.assignments]) if (!item || typeof item.text !== 'string') throw failure('INVALID_RESPONSE');
      for (const item of team.identities) if (!validId(item.targetId) || !integer(item.tenure) || item.tenure < 1) throw failure('INVALID_RESPONSE');
      for (const item of team.assignments) if (!integer(item.version) || item.version < 1 || !validId(item.targetId) || !integer(item.tenure) || item.tenure < 1 || !integer(item.generation)
        || !['current', 'needs-review'].includes(item.status) || !['ready', 'waiting', 'in-progress', 'complete'].includes(item.workStatus)
        || typeof item.waitingReason !== 'string' || !Array.isArray(item.statusHistory)) throw failure('INVALID_RESPONSE');
    }
    for (const report of state.reports) if (!validId(report?.id) || !validId(report.teamId) || !validId(report.authorId)
      || !Array.isArray(report.versions) || !report.versions.length || report.versions.some(version => !version || typeof version.text !== 'string' || typeof version.at !== 'string' || !integer(version.version) || version.version < 1)) throw failure('INVALID_RESPONSE');
    for (const key of ['comments', 'proposals', 'messages', 'alerts']) for (const record of state[key]) if (!record || !validId(record.id) || !validId(record.teamId)) throw failure('INVALID_RESPONSE');
    for (const message of state.messages) if (!validId(message.authorId) || !validId(message.recipientId) || typeof message.text !== 'string' || !['information', 'request', 'reply', 'handoff', 'alert'].includes(message.kind)) throw failure('INVALID_RESPONSE');
    for (const alert of state.alerts) if (!validId(alert.targetId) || typeof alert.text !== 'string' || typeof alert.needsUser !== 'boolean' || typeof alert.resolved !== 'boolean') throw failure('INVALID_RESPONSE');
    for (const wake of state.wakeups) if (!validId(wake?.id) || !validId(wake.teamId) || !validId(wake.sessionId) || typeof wake.reason !== 'string' || !['pending', 'claimed', 'sent', 'cancelled', 'failed'].includes(wake.status)) throw failure('INVALID_RESPONSE');
    for (const proposal of state.proposals) if (!proposal.origin || !Array.isArray(proposal.revisions) || !proposal.revisions.length || !Array.isArray(proposal.responses) || !Array.isArray(proposal.decisions)
      || proposal.revisions.some(item => !item || !integer(item.revision) || item.revision < 1 || typeof item.text !== 'string' || !Array.isArray(item.concerned))) throw failure('INVALID_RESPONSE');
    for (const dispatch of state.dispatches) if (!validId(dispatch?.id) || !validId(dispatch.teamId) || !validId(dispatch.managerId)
      || !['prepared', 'confirmed'].includes(dispatch.status) || typeof dispatch.summary !== 'string' || typeof dispatch.permissionExpectations !== 'string'
      || !/^[a-f0-9]{64}$/.test(dispatch.hash) || !integer(dispatch.planVersion) || dispatch.planVersion < 1
      || typeof dispatch.discussionUserMessageId !== 'string' || !integer(dispatch.generation) || !integer(dispatch.epoch) || dispatch.epoch < 1
      || !integer(dispatch.managerTenure) || dispatch.managerTenure < 1 || typeof dispatch.at !== 'string'
      || dispatch.plan === undefined && (!Array.isArray(dispatch.assignmentTargets) || !dispatch.assignmentTargets.every(validId) || !integer(dispatch.assignmentCount))
      || dispatch.plan !== undefined && !validDispatchPlan(dispatch.plan)
      || (dispatch.status === 'confirmed') !== !!dispatch.confirmation
      || dispatch.confirmation !== undefined && (!dispatch.confirmation || typeof dispatch.confirmation.userMessageId !== 'string' || typeof dispatch.confirmation.at !== 'string' || typeof dispatch.confirmation.returnToCoordination !== 'boolean')) throw failure('INVALID_RESPONSE');
    return freeze(clone(view));
  }
  function verifyDelivery(value, teamId, generation) {
    const state = value?.state, integer = number => Number.isSafeInteger(number) && number >= 0;
    if (!state || state.teamId !== teamId || state.generation !== generation || !Array.isArray(state.wakeups) || !Array.isArray(state.continuations)) throw failure('INVALID_RESPONSE');
    for (const wake of state.wakeups) if (!validId(wake?.id) || wake.teamId !== teamId || !validId(wake.sessionId)
      || !['pending', 'claimed', 'sent', 'cancelled', 'failed'].includes(wake.status) || typeof wake.reason !== 'string'
      || wake.heldReason !== undefined && wake.heldReason !== null && typeof wake.heldReason !== 'string') throw failure('INVALID_RESPONSE');
    for (const item of state.continuations) if (!validId(item?.proposalId) || !integer(item.proposalRevision) || item.proposalRevision < 1 || item.status !== 'recorded'
      || typeof item.recordOnly !== 'boolean' || !Array.isArray(item.continueAssignments)
      || item.continueAssignments.some(task => !validId(task?.sessionId) || !integer(task.assignmentRevision) || task.assignmentRevision < 1 || !integer(task.assignmentVersion) || task.assignmentVersion < 1)
      || !Array.isArray(item.wakeIds) || !item.wakeIds.every(validId)) throw failure('INVALID_RESPONSE');
    return freeze(clone(state));
  }
  const reviewOf = view => ({ expectedRevision: view.state.revision, expectedGeneration: view.state.generation, reviewToken: view.reviewToken });
  function prepareCommand(type, draft) {
    if (type === 'save-team') {
      const memberIds = draft.memberIds;
      if (!Array.isArray(memberIds) || !memberIds.every(validId) || new Set(memberIds).size !== memberIds.length || memberIds.includes(draft.managerId)) throw failure('INPUT_INVALID');
      const description = text(draft.description, 1000, false);
      const title = text(draft.title, 200);
      if (/[\r\n]/.test(description + title)) throw failure('INPUT_INVALID');
      return { type, teamId: id(draft.teamId), title, description, managerId: id(draft.managerId), memberIds: [...memberIds] };
    }
    if (type === 'retire-team') return { type, teamId: id(draft.teamId) };
    if (type === 'set-automation' && typeof draft.enabled === 'boolean') return { type, teamId: id(draft.teamId), enabled: draft.enabled };
    throw failure('INPUT_INVALID');
  }
  function createTransport(connection) {
    return async (method, args, signal) => {
      if (!['inspect', 'administer'].includes(method)) throw failure('INPUT_INVALID');
      const result = await connection.rpc.call('/api', 'sessionTeams/' + method, { args }, signal);
      if (result?.ok === true) return result.value;
      if (result?.ok === false && typeof result.error?.code === 'string') throw Object.assign(new Error(String(result.error.message ?? result.error.code)), { code: result.error.code });
      throw failure('INVALID_RESPONSE');
    };
  }
  function createController(call) {
    let state = freeze({ view: null, fresh: false, busy: null, pending: null, acknowledged: false, error: null, notice: null, lastCommit: null, history: null, delivery: null });
    let setupDraft = null, setupCommitSerial = null;
    let historyEpoch = 0, historyActive = null, deliveryActive = null, selectedHistoryTeam = null;
    function clearHistory() { ++historyEpoch; historyActive?.abort(); deliveryActive?.abort(); historyActive = deliveryActive = null; }
    function selectHistoryTeam(teamId) { if (teamId !== selectedHistoryTeam) { clearHistory(); selectedHistoryTeam = teamId; emit({ history: null, delivery: null }); } }
    async function loadDelivery(teamId) {
      if (!ready() || selectedHistoryTeam !== teamId || state.delivery?.busy) return false;
      deliveryActive?.abort(); const token = historyEpoch, snapshotEpoch = epoch, controller = new AbortController(); deliveryActive = controller;
      const currentDelivery = () => !disposed && token === historyEpoch && snapshotEpoch === epoch && selectedHistoryTeam === teamId;
      emit({ delivery: { teamId, busy: true, view: null, error: null } });
      try {
        const value = verifyDelivery(await call('inspect', { query: { type: 'delivery', teamId: id(teamId) } }, controller.signal), teamId, state.view.state.generation);
        if (!currentDelivery()) return false;
        emit({ delivery: { teamId, busy: false, view: value, error: null } }); return true;
      } catch (error) { if (currentDelivery()) emit({ delivery: { teamId, busy: false, view: null, error: info(error, 'read') } }); return false; }
      finally { if (deliveryActive === controller) deliveryActive = null; }
    }
    async function loadHistory(teamId) {
      if (!ready() || selectedHistoryTeam !== teamId || state.history?.busy) return false;
      clearHistory(); const token = historyEpoch, snapshotEpoch = epoch, controller = new AbortController(); historyActive = controller;
      const currentHistory = () => !disposed && token === historyEpoch && snapshotEpoch === epoch && selectedHistoryTeam === teamId;
      emit({ delivery: null, history: { teamId, busy: true, view: null, error: null } });
      try {
        const value = verifyView(await call('inspect', { query: { type: 'history', teamId: id(teamId) } }, controller.signal));
        if (!currentHistory()) return false;
        if (value.state.generation !== state.view.state.generation || value.state.snapshotKind !== 'history' || value.state.teams.length !== 1 || value.state.teams[0].id !== teamId) throw failure('INVALID_RESPONSE');
        emit({ history: { teamId, busy: false, view: value, error: null } }); return true;
      } catch (error) { if (currentHistory()) emit({ history: { teamId, busy: false, view: null, error: info(error, 'read') } }); return false; }
      finally { if (historyActive === controller) historyActive = null; }
    }
    let epoch = 0, active = null, disposed = false;
    const listeners = new Set();
    const emit = patch => { state = freeze({ ...state, ...patch }); for (const listener of listeners) listener(); };
    const info = (error, phase) => ({ code: typeof error?.code === 'string' ? error.code : 'TRANSPORT_ERROR', message: String(error?.message ?? ''), phase });
    const ready = () => !disposed && !state.busy && state.fresh && state.view;
    function localError(code) { if (!disposed && !state.busy) emit({ error: info(failure(code), 'input'), pending: null, acknowledged: false }); return false; }
    function begin(kind) {
      if (disposed || state.busy) return null;
      clearHistory();
      const job = { epoch: ++epoch, controller: new AbortController(), committed: false }; active = job;
      emit({ history: null, delivery: null, busy: kind, fresh: false, error: null, pending: null, acknowledged: false, ...(kind === 'load' ? {} : { notice: null }) }); return job;
    }
    const current = job => !disposed && job.epoch === epoch;
    async function acquire(job) {
      const value = verifyView(await call('inspect', { query: { type: 'snapshot' } }, job.controller.signal));
      if (!current(job)) return false;
      emit({ view: value, fresh: true, busy: null, error: null }); return true;
    }
    async function load() {
      const job = begin('load'); if (!job) return false;
      try { return await acquire(job); }
      catch (error) { if (current(job)) emit({ fresh: false, busy: null, error: info(error, 'read') }); return false; }
      finally { if (active === job) active = null; }
    }
    function stage(command) {
      if (disposed || state.busy) return false;
      if (!ready()) return localError('REFRESH_REQUIRED');
      try {
        const clean = prepareCommand(command?.type, command);
        const pending = { command: { ...clean, expectedRevision: state.view.state.revision }, precondition: reviewOf(state.view) };
        emit({ pending: clone(pending), acknowledged: false, error: null, notice: null }); return true;
      } catch { return localError('INPUT_INVALID'); }
    }
    function confirm() {
      if (disposed || state.busy) return false;
      if (!ready() || state.pending || !state.view.state.reviewRequired || !state.acknowledged) return localError('REVIEW_ACK_REQUIRED');
      const reference = reviewOf(state.view);
      emit({ pending: { command: { type: 'review-startup', ...reference }, precondition: { ...reference } }, acknowledged: false, error: null, notice: null }); return true;
    }
    async function apply() {
      if (disposed || state.busy) return false;
      if (!ready() || !state.pending) return localError('PREVIEW_REQUIRED');
      const pending = clone(state.pending);
      const job = begin('administer'); if (!job) return false;
      try {
        const result = await call('administer', pending, job.controller.signal);
        if (!current(job)) return false;
        if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw failure('INVALID_RESPONSE');
        job.committed = true;
        emit({ notice: pending.command.type === 'review-startup' ? 'reviewCommitted' : 'ownerCommitted', busy: 'postRead', lastCommit: { serial: job.epoch, command: pending.command, revision: result.revision } });
        // Exactly one follow-up read. Never retry, rebase, or infer failure after acknowledged commit.
        return await acquire(job);
      } catch (error) {
        if (current(job)) emit({ fresh: false, busy: null, error: info(error, job.committed ? 'postCommit' : 'mutation') });
        return false;
      } finally { if (active === job) active = null; }
    }
    function invalidate() {
      const committed = active?.committed === true;
      const phase = committed ? 'postCommit' : state.busy === 'administer' ? 'mutation' : 'connection';
      ++epoch; active?.controller.abort(); active = null; clearHistory();
      if (!disposed) emit({ history: null, delivery: null, fresh: false, busy: null, pending: null, acknowledged: false, error: info(failure('CONNECTION_CHANGED'), phase) });
    }
    return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, load, loadHistory, loadDelivery, selectHistoryTeam, stage, confirm, apply, localError, invalidate,
      getSetup() { return setupDraft; }, setSetup(value) { if (!disposed) setupDraft = freeze(clone(value)); },
      claimSetupCommit(serial) { if (serial === setupCommitSerial) return false; setupCommitSerial = serial; return true; },
      cancelStage() { if (!disposed && !state.busy) emit({ pending: null, acknowledged: false, error: null }); },
      acknowledge(value) { if (ready() && !state.pending) emit({ acknowledged: value === true, error: null }); },
      dispose() { disposed = true; ++epoch; active?.controller.abort(); active = null; clearHistory(); listeners.clear(); } };
  }
  function verifyStatuses(value) {
    const state = value?.state, integer = number => Number.isSafeInteger(number) && number >= 0;
    if (!state || !integer(state.statusVersion) || !state.statuses || typeof state.statuses !== 'object' || Array.isArray(state.statuses)) throw failure('INVALID_RESPONSE');
    for (const key of Object.keys(state.statuses)) {
      const facts = state.statuses[key];
      if (!validId(key) || !facts || !['withUser', 'needsIntervention', 'waiting', 'complete'].every(name => typeof facts[name] === 'boolean')
        || typeof facts.reason !== 'string' || !integer(facts.pendingCount)) throw failure('INVALID_RESPONSE');
    }
    return freeze(clone({ statusVersion: state.statusVersion, statuses: state.statuses }));
  }
  function createStatusStore(call, scheduler = {}) {
    const setTimer = scheduler.setTimer ?? ((fn, delay) => setTimeout(fn, delay)), clearTimer = scheduler.clearTimer ?? (timer => clearTimeout(timer));
    let snapshot = freeze({ ready: false, statusVersion: undefined, statuses: {}, error: null });
    let disposed = false, running = false, epoch = 0, active = null, timer = null, release = null; const listeners = new Set();
    const publish = patch => { snapshot = freeze({ ...snapshot, ...patch }); for (const listener of [...listeners]) listener(); };
    const alive = token => !disposed && running && token === epoch;
    const wake = () => { if (timer !== null) clearTimer(timer); timer = null; const done = release; release = null; done?.(); };
    const pause = delay => new Promise(resolve => { release = resolve; timer = setTimer(() => { timer = null; release = null; resolve(); }, delay); });
    async function pump(token) {
      let retry = 1000;
      while (alive(token)) {
        const controller = new AbortController(); active = controller;
        try {
          const after = snapshot.statusVersion, value = verifyStatuses(await call('inspect', { query: { type: 'status', ...(after === undefined ? {} : { after }) } }, controller.signal));
          if (!alive(token)) break;
          // Equality is a long-poll cursor only: a restarted Host service can reset this counter.
          // Request epoch already discards old connection/disposal responses; do not impose global ordering.
          publish({ ...value, ready: true, error: null }); retry = 1000;
          // Native endpoint long-polls unchanged versions. Also bound a faulty immediate-empty responder.
          if (after === value.statusVersion) await pause(250);
        } catch (error) {
          if (!alive(token)) break;
          publish({ ready: false, statuses: {}, error: typeof error?.code === 'string' ? error.code : 'CARRIER_FAILURE' });
          await pause(retry); retry = Math.min(30000, retry * 2);
        } finally { if (active === controller) active = null; }
      }
    }
    return { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      start() { if (!disposed && !running) { running = true; void pump(++epoch); } },
      reset() { if (disposed) return; ++epoch; active?.abort(); active = null; wake(); publish({ ready: false, statusVersion: undefined, statuses: {}, error: null }); if (running) void pump(epoch); },
      dispose() { if (disposed) return; disposed = true; running = false; ++epoch; active?.abort(); active = null; wake(); listeners.clear(); } };
  }
  function sidebarProjection(status, sessions, sessionId, nativeStatus, archived = false) {
    const known = sessions?.ids?.includes(sessionId) && Object.hasOwn(sessions.byId ?? {}, sessionId), facts = Object.hasOwn(status?.statuses ?? {}, sessionId) ? status.statuses[sessionId] : null;
    const native = known ? sessions.byId[sessionId] : null;
    // A ready Host fact is the active-membership proof, independent of the open profile.
    // Unknown status, unrelated rows and retired-only sessions contribute no UI at all.
    if (!status?.ready || !facts) return null;
    if (archived || sessions?.phase !== 'ready' || !known) return { state: 'Unavailable', reason: '', pendingCount: 0 };
    const observation = { availability: 'available', archived: false, execution: (typeof nativeStatus?.running === 'boolean' ? nativeStatus.running : native?.running) === true ? 'running' : 'idle' };
    const work = facts ? { status: 'current', workStatus: facts.waiting ? 'waiting' : facts.complete ? 'complete' : 'ready' } : null;
    return { state: visibleState(observation, work, { nativeStatus, intervention: facts?.needsIntervention, focus: { withUser: facts?.withUser } }), reason: facts?.reason ?? '', pendingCount: facts?.pendingCount ?? 0 };
  }
  // Join native workspace membership to the GLOBAL list's ids only. byId may retain non-list subagents.
  function buildCatalog(sessionState = {}, workspaceState = {}, selectedIds = []) {
    const ids = Array.isArray(sessionState.ids) ? [...new Set(sessionState.ids)] : [];
    const archived = new Set(workspaceState.archivedSessionIds ?? []), byId = new Map();
    const ready = sessionState.phase === 'ready' && workspaceState.phase === 'ready' && workspaceState.state !== 'error';
    for (const sessionId of ids) {
      const value = Object.hasOwn(sessionState.byId ?? {}, sessionId) ? sessionState.byId[sessionId] : null; if (!value) continue;
      // Native hides non-selected blank rows. Explicit stored titles are intentional real worker choices.
      const hiddenBlank = value.blank === true && !value.title?.trim() && !(value.retainedBy?.mainView > 0);
      const eligible = !archived.has(sessionId) && !hiddenBlank && value.origin !== 'subagent' && value.formatStatus !== 'migration-required';
      byId.set(sessionId, { id: sessionId, title: String(value.title?.trim() || (value.blank === true ? sessionId : value.displayTitle) || sessionId), eligible, missing: false, running: sessionState.phase === 'ready' && typeof value.running === 'boolean' ? value.running : undefined, reason: archived.has(sessionId) ? 'archived' : value.origin === 'subagent' ? 'subagent' : hiddenBlank ? 'blank' : !eligible ? 'incompatible' : null });
    }
    for (const sessionId of selectedIds) if (!byId.has(sessionId)) byId.set(sessionId, { id: sessionId, title: sessionId, eligible: false, missing: true, reason: ready ? 'missing' : 'pending' });
    const labels = new Map();
    for (const entry of byId.values()) { const group = labels.get(entry.title) ?? []; group.push(entry); labels.set(entry.title, group); }
    for (const entries of labels.values()) for (const entry of entries) {
      let length = 6; while (length < entry.id.length && entries.some(other => other !== entry && other.id.slice(-length) === entry.id.slice(-length))) length++;
      entry.label = entry.title + (entries.length > 1 ? ' · ' + entry.id.slice(-length) : '');
    }
    const selected = new Set(selectedIds), used = new Set(), groups = [];
    for (const workspace of workspaceState.items ?? []) {
      const entries = [];
      for (const sessionId of workspace.sessionIds ?? []) {
        const entry = byId.get(sessionId); if (entry && !used.has(sessionId) && (entry.eligible || selected.has(sessionId))) { entries.push(entry); used.add(sessionId); }
      }
      groups.push({ id: workspace.workspaceId, title: String(workspace.title || workspace.path || workspace.workspaceId), path: workspace.path, entries });
    }
    const remaining = [...byId.values()].filter(entry => !used.has(entry.id) && (entry.eligible || selected.has(entry.id)));
    if (remaining.length) groups.push({ id: '__ungrouped', title: null, entries: remaining });
    return { ready, error: workspaceState.state === 'error', groups, tree: workspaceTree(groups), entries: [...byId.values()], byId };
  }
  // Exact Native folder comparison: canonical Host spelling, case-sensitive, component boundary.
  function folderPath(path) { return (/^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') ? path.replaceAll('\\', '/') : path).replace(/\/+$/, ''); }
  function workspaceTree(groups) {
    const nodes = groups.map(group => ({ ...group, children: [] })), roots = [];
    for (const node of nodes) {
      const child = node.path ? folderPath(node.path) : null;
      const parent = child === null ? null : nodes.filter(other => other !== node && other.path && child !== folderPath(other.path) && child.startsWith(folderPath(other.path) + '/')).sort((a, b) => folderPath(b.path).length - folderPath(a.path).length)[0];
      (parent ? parent.children : roots).push(node);
    }
    const prune = node => { node.children = node.children.filter(prune); return node.entries.length > 0 || node.children.length > 0; };
    return roots.filter(prune);
  }
  function directSelection(group, values, excludedId) {
    const ids = group.entries.filter(entry => entry.id !== excludedId && (entry.eligible || values.includes(entry.id))).map(entry => entry.id);
    return { ids, checked: ids.length > 0 && ids.every(id => values.includes(id)) };
  }
  function toggleDirect(group, values, excludedId) {
    const { ids, checked } = directSelection(group, values, excludedId);
    return checked ? values.filter(id => !ids.includes(id)) : [...new Set([...values, ...ids])];
  }
  function setupFrom(team, revision) {
    return { teamId: team?.id ?? '', draft: { title: team?.title ?? '', description: team?.description ?? '', managerId: team?.managerId ?? '', memberIds: [...(team?.memberIds ?? [])] }, baseRevision: revision, dirty: false, stale: false };
  }
  function changeSetup(setup, key, value) {
    const previous = setup.draft, draft = { ...previous, [key]: value };
    if (key === 'managerId') draft.memberIds = [...new Set([...previous.memberIds, ...(previous.managerId && previous.managerId !== value ? [previous.managerId] : [])])].filter(sessionId => sessionId !== value);
    return { ...setup, draft, dirty: true };
  }
  function refreshSetup(setup, view) {
    if (setup.baseRevision === view.state.revision) return setup;
    if (setup.dirty) return { ...setup, stale: true };
    const team = view.state.teams.find(team => team.id === setup.teamId);
    return setup.teamId && !team ? { ...setup, stale: true } : setupFrom(team, view.state.revision);
  }
  function rosterDelta(team, command) {
    const previous = team ? [team.managerId, ...team.memberIds] : [], next = [command.managerId, ...command.memberIds];
    return { added: next.filter(sessionId => !previous.includes(sessionId)), removed: previous.filter(sessionId => !next.includes(sessionId)), previousManagerId: team?.managerId ?? null, managerId: command.managerId };
  }
  function partitionTeams(teams) { return { active: teams.filter(team => team.status === 'active'), retired: teams.filter(team => team.status === 'idle') }; }
  function teamLabel(teams, teamId) {
    const team = teams.find(team => team.id === teamId); if (!team) return teamId;
    const duplicates = teams.filter(other => other.title === team.title); let length = 6;
    while (length < team.id.length && duplicates.some(other => other !== team && other.id.slice(-length) === team.id.slice(-length))) length++;
    return team.title + (duplicates.length > 1 ? ' · ' + team.id.slice(-length) : '');
  }
  // Presentation is deterministic code, never a generated model label.
  function currentAssignment(state, team, sessionId) {
    if (team.status !== 'active' || ![team.managerId, ...team.memberIds].includes(sessionId)) return null;
    return latest(team.assignments.filter(item => item.targetId === sessionId && item.status === 'current'
      && item.generation === state.generation && item.tenure === team.tenures?.[sessionId])) ?? null;
  }
  const PRIMARY_STATES = ['NeedsIntervention', 'ApprovalNeeded', 'WithUser', 'Running', 'Waiting', 'Complete', 'Idle', 'Unavailable'];
  function visibleState(observation, assignment, options = {}) {
    if (!observation || observation.archived || observation.availability !== 'available') return 'Unavailable';
    if (options.intervention === true) return 'NeedsIntervention';
    const pending = options.nativeStatus?.pendingInteraction?.kind;
    if (pending === 'approval') return 'ApprovalNeeded';
    if (pending === 'question' || pending === 'plan-review') return 'NeedsIntervention';
    if (options.focus?.withUser === true) return 'WithUser';
    if (typeof options.nativeStatus?.running === 'boolean' ? options.nativeStatus.running : observation.execution === 'running') return 'Running';
    if (options.waiting === true || options.waiting === undefined && assignment?.status === 'current' && assignment.workStatus === 'waiting') return 'Waiting';
    if (options.complete === true || options.complete === undefined && assignment?.status === 'current' && assignment.workStatus === 'complete') return 'Complete';
    return 'Idle';
  }
  const STATE_COLORS = Object.freeze({ NeedsIntervention: 'light-dark(var(--dsw-static-red-900), var(--dsw-static-red-600))', ApprovalNeeded: 'var(--dsw-alias-state-error-primary)', WithUser: 'var(--dsw-alias-state-done-primary)', Running: 'var(--dsw-alias-state-business-primary)', Waiting: 'var(--dsw-alias-state-warn-primary)', Complete: 'var(--dsw-alias-state-success-primary)', Idle: 'var(--dsw-alias-state-idle-primary)', Unavailable: 'var(--dsw-alias-label-secondary)' });
  function statusLabel(state, t, reason = '') { return t('visible' + state) + (reason && ['Waiting', 'NeedsIntervention'].includes(state) ? ' · ' + shortSummary(reason) : ''); }
  function openIntervention(state, sessionId) {
    return (state.alerts ?? []).find(alert => {
      const team = state.teams.find(team => team.id === alert.teamId);
      const assignment = team && alert.assignmentRevision ? currentAssignment(state, team, sessionId) : null;
      return alert.targetId === sessionId && alert.needsUser === true && alert.resolved === false
        && team?.status === 'active' && alert.epoch === team.epoch && alert.targetTenure === team.tenures[sessionId]
        && [team.managerId, ...team.memberIds].includes(sessionId)
        && (!alert.assignmentRevision || assignment?.revision === alert.assignmentRevision && assignment.workStatus !== 'complete');
    });
  }
  function messageReportSource(state, message) { return state.reports.find(report => report.teamId === message.teamId && report.id === message.reportId)?.authorId; }
  function observedNative(session, catalog) {
    const native = catalog.byId.get(session?.id), stored = session?.observation;
    // Loading is not absence. A confirmed global-list member's boolean is authoritative.
    if (native?.reason === 'archived') return { ...stored, availability: 'available', archived: true };
    if (native?.missing && catalog.ready) return { ...stored, availability: 'missing' };
    if (native && !native.missing && native.reason !== 'subagent' && native.reason !== 'incompatible')
      return { ...stored, ...(catalog.ready ? { availability: 'available', archived: false } : {}),
        ...(typeof native.running === 'boolean' ? { availability: 'available', execution: native.running ? 'running' : 'idle' } : {}) };
    return stored;
  }
  function memberProjection(state, team, sessionId, catalog, nativeStatus, coordination) {
    const session = state.sessions.find(item => item.id === sessionId), assignment = currentAssignment(state, team, sessionId);
    const identity = sessionId === team.managerId ? 'Manager' : latest(team.identities.filter(item => item.targetId === sessionId && item.tenure === team.tenures?.[sessionId]))?.text ?? '';
    const overall = latest(team.responsibilities.filter(item => item.targetId === sessionId));
    return { id: sessionId, name: catalog.byId.get(sessionId)?.label ?? sessionId, identity, overallAssignment: overall?.text ?? '',
      overall, assignment, state: visibleState(observedNative(session, catalog), assignment, { nativeStatus, focus: { withUser: coordination?.withUser ?? session?.focus?.withUser }, intervention: coordination?.needsIntervention ?? !!openIntervention(state, sessionId), waiting: coordination?.waiting, complete: coordination?.complete }),
      reason: coordination?.reason || openIntervention(state, sessionId)?.text || assignment?.waitingReason || '',
      report: latestReport(currentWorkerReports(state, team).filter(item => item.authorId === sessionId)) };
  }
  function currentWorkerReports(state, team) {
    return state.reports.filter(report => report.teamId === team.id && team.memberIds.includes(report.authorId)
      && currentAssignment(state, team, report.authorId)?.revision === latest(report.versions)?.assignmentRevision);
  }
  function exactReport(state, teamId, reportId, version) {
    const report = state.reports.find(report => report.teamId === teamId && report.id === reportId);
    const cited = report?.versions.find(item => item.version === version);
    return cited ? { report, version: cited } : null;
  }
  const currentDecision = proposal => latest(proposal.decisions.filter(decision => decision.proposalRevision === latest(proposal.revisions)?.revision)) ?? null;
  const historicalDecisions = proposal => proposal.decisions.filter(decision => decision !== currentDecision(proposal));
  function recentProposals(state, teamId, sessionId, limit = 3) {
    return state.proposals.filter(item => item.teamId === teamId && (!sessionId || item.origin?.authorId === sessionId
      || latest(item.revisions)?.concerned?.some(member => member.id === sessionId)
      || latest(item.revisions)?.identityChange?.targetId === sessionId))
      .slice().sort((a, b) => String(latest(b.decisions)?.at ?? latest(b.revisions)?.at ?? '').localeCompare(String(latest(a.decisions)?.at ?? latest(a.revisions)?.at ?? ''))).slice(0, limit);
  }
  function createNavigation() {
    const cleared = { view: 'profile', memberId: null, reportId: null, reportVersion: null, setupOpen: false };
    let route = freeze({ teamId: null, ...cleared }); const listeners = new Set();
    const publish = patch => { route = freeze({ ...route, ...patch }); listeners.forEach(listener => listener()); };
    return { getSnapshot: () => route, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      select(teamId) { publish({ teamId, ...cleared }); }, back() { publish({ teamId: null, ...cleared }); }, setup() { publish({ teamId: null, ...cleared, setupOpen: true }); },
      detail(view, memberId = null, reportId = null, reportVersion = null) { if (['profile', 'history'].includes(view)) publish({ view, memberId, reportId, reportVersion }); } };
  }
  const shortSummary = value => String(value ?? '').length > 240 ? String(value).slice(0, 237) + '…' : String(value ?? '');
  const latestReport = reports => reports.reduce((found, report) => !found || String(latest(report.versions)?.at ?? '') >= String(latest(found.versions)?.at ?? '') ? report : found, null);
  const reportAnchor = (teamId, reportId) => 'sc9-report-' + Array.from(JSON.stringify([teamId, reportId]), char => char.codePointAt(0).toString(16) + '-').join('');
  function nativeReference(destination, sourceSessionId) {
    if (!validId(sourceSessionId) || typeof destination !== 'string' || !destination || destination.length > 4096 || /[\u0000-\u001f\u007f<>"|*?]/.test(destination)) return null;
    let path = destination.replace(/\\/g, '/'), line;
    const anchor = path.match(/#L([1-9]\d*)$/);
    if (anchor) { line = Number(anchor[1]); path = path.slice(0, anchor.index); if (!Number.isSafeInteger(line)) return null; }
    path = path.replace(/^\.\//, '');
    if (!path || path.includes('#') || path.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:\//.test(path) || path.replace(/^[A-Za-z]:\//, '').includes(':')) return null;
    const kind = path.endsWith('/') ? 'directory' : 'file'; if (kind === 'directory' && line) return null;
    const segment = value => encodeURIComponent(value).replace(/%3A/gi, ':');
    try { return freeze({ sourceSessionId, path, kind, ...(line ? { line } : {}), address: 'dsh-resource://file/session/' + segment(sourceSessionId) + '/' + path.split('/').map(segment).join('/') }); }
    catch { return null; } // Malformed Unicode stays plain text, never a render failure.
  }
  function markdownReferences(value, sourceSessionId) {
    const text = String(value), parts = []; let cursor = 0;
    for (const match of text.matchAll(/(?<!!)\[([^\]\r\n]{1,200})\]\((?:<([^<>\r\n]+)>|([^()\s]+))\)/g)) {
      const reference = nativeReference(match[2] ?? match[3], sourceSessionId); if (!reference) continue;
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
      parts.push({ text: match[1], reference }); cursor = match.index + match[0].length;
    }
    if (cursor < text.length || !parts.length) parts.push({ text: text.slice(cursor) });
    return parts;
  }
  function recordSource(value, inherited, sources) {
    if (value && !Array.isArray(value) && typeof value === 'object' && Object.hasOwn(value, 'authorId')) {
      const source = sources?.get(value.authorId); return source && !source.missing ? value.authorId : undefined;
    }
    return inherited;
  }
  // Owned by apply, NOT the panel: opening a Conversation unmounts the global panel.
  function createResourceNavigator(native, scheduler = {
    requestFrame: callback => requestAnimationFrame(callback), cancelFrame: frame => cancelAnimationFrame(frame),
    setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: timer => clearTimeout(timer)
  }) {
    let epoch = 0, off = null, frame = null, timer = null, disposed = false, snapshot = null;
    const listeners = new Set(), publish = value => { snapshot = value; for (const listener of listeners) listener(); };
    function cancel() {
      ++epoch; off?.(); off = null;
      if (frame !== null) scheduler.cancelFrame(frame); if (timer !== null) scheduler.clearTimer(timer);
      frame = timer = null;
    }
    function fail(error, token) {
      if (disposed || token !== epoch) return;
      cancel(); publish(freeze({ message: String(error?.message ?? error).slice(0, 600) }));
      try { native.returnToPanel(); } catch { /* Error remains available on the next panel open. */ }
    }
    function navigate(reference) {
      if (disposed) return false;
      cancel(); const token = epoch; publish(null);
      const checked = reference && nativeReference(reference.path + (reference.line ? '#L' + reference.line : ''), reference.sourceSessionId);
      if (!checked) { fail(failure('INVALID_REFERENCE'), token); return false; }
      const mounted = native.mounted;
      const onMounted = () => {
        if (disposed || token !== epoch || frame !== null || mounted.getSnapshot() !== checked.sourceSessionId) return;
        frame = scheduler.requestFrame(() => {
          if (disposed || token !== epoch) return; frame = null;
          if (mounted.getSnapshot() !== checked.sourceSessionId) { fail(failure('SESSION_MOUNT_CHANGED'), token); return; }
          try {
            if (checked.kind === 'directory') native.openTab('files');
            else native.openResource(checked.address, { params: checked.line ? { line: checked.line } : {}, destination: 'sidebar' });
            cancel(); // void return means accepted navigation, never proof of file existence/read success.
          } catch (error) { fail(error, token); }
        });
      };
      try {
        off = mounted.subscribe(onMounted); // Must precede navigation and its synchronous mounted publication.
        timer = scheduler.setTimer(() => fail(failure('SESSION_MOUNT_TIMEOUT'), token), 10000);
        native.openSession(checked.sourceSessionId); onMounted(); return true;
      } catch (error) { fail(error, token); return false; }
    }
    return { navigate, cancel, getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dismiss() { if (!disposed) publish(null); }, dispose() { disposed = true; cancel(); listeners.clear(); } };
  }
  const EN = {
    title: 'Session teams', intro: 'Create native Sessions manually, then choose a manager and teammates. Manage work through their conversations.',
    refresh: 'Refresh', back: 'Back to conversation', loading: 'Loading current state…', lastLoaded: 'Last loaded / stale snapshot', stale: 'Refresh before editing or confirming. The last loaded view is read-only.',
    snapshotNote: 'Read on open, connection reset, explicit refresh and after a change. No polling, automatic wake, or execution approval.',
    setup: 'Team setup · owner only', newTeam: 'New team', editTeam: 'Edit team', chooseTeam: 'Choose team setup', teamTitle: 'Team title', description: 'One-line description', descriptionHelp: 'A description is not a work mandate. The manager owns the brief, responsibilities and assignments in conversation.',
    manager: 'Manager · choose one', members: 'Members · add or remove', pickerHelp: 'Use this same picker to add or remove members. Create Sessions in the native sidebar first. Each Session has at most one upstream team; cycles are not allowed. Changing manager keeps the former manager as a member unless you explicitly remove it.',
    ungrouped: 'Ungrouped Sessions', pendingCatalog: 'Native Sessions or workspaces are still loading. An empty list is not a confirmed empty selection.', catalogError: 'Native workspace list could not be read. Refresh or reconnect before choosing new Sessions.',
    noChoices: 'No eligible native Sessions. Create an independent Session in the native sidebar first.', missing: 'Missing from the current native list · retained selection', pending: 'Not yet present in the loading native list · retained selection', archived: 'Archived · retained selection', subagent: 'Native subagent · not a new choice', incompatible: 'Requires native format migration · retained selection',
    retainedWarning: 'Unavailable saved selections are retained below. Remove them explicitly if intended; they are never silently dropped. The Host validates native availability on save.',
    previewButton: 'Preview exact change', preview: 'Review exact change', previewHelp: 'Only this staged change, revision, generation and snapshot token will be submitted. Nothing is automatically retried or rebased.',
    apply: 'Apply this change', cancel: 'Cancel preview', saveAction: 'Save team setup', retire: 'Retire team', retireAction: 'Retire this team', session: 'Session', teams: 'Team profiles · read-only', noTeams: 'No teams yet. Use team setup below.', profileHelp: 'Only setup and native titles can be changed here. Use the manager conversation for work; each Session owns its identity and factual reports.',
    brief: 'Team brief', responsibilities: 'Responsibilities', assignments: 'Assignments', reports: 'Reports and versions', comments: 'Comments', proposals: 'Proposals and decisions', history: 'History', identity: 'Identity', state: 'State', none: 'None recorded', open: 'Open native Session', latestReport: 'Latest report', versions: 'Versions', responses: 'Responses', decisions: 'Decisions', origin: 'Origin report', concerned: 'Concerned teammates',
    held: 'Startup coordination hold', heldHelp: 'Review the exact current roster and work below. Setup remains editable while held. Review does not revive old assignments or agreements, and never approves execution.', available: 'No startup review pending', reviewAck: 'I reviewed this exact current roster, brief, assignments, reports, proposals and startup hold. Old assignments and agreements will not be revived.', reviewButton: 'Preview startup review', reviewAction: 'Release this reviewed startup hold',
    revision: 'Revision', generation: 'Generation', ownerCommitted: 'Team setup committed.', reviewCommitted: 'Startup review committed. Old assignments and agreements were not revived.', operationFeedback: 'Operation result', error_input: 'Check the selection', help_input: 'Correct the setup, then preview the exact change again.', error_read: 'Current snapshot could not be read', help_read: 'Refresh to obtain a usable current snapshot. A failed read does not make the cached view current.', error_mutation: 'Change outcome not confirmed', help_mutation: 'Do not resend blindly. Refresh to establish current state; a transport failure does not prove nothing committed.', error_postCommit: 'Change committed; follow-up refresh failed', help_postCommit: 'Success was acknowledged. Refresh the snapshot; do not repeat this change.', error_connection: 'Connection changed', help_connection: 'The old generation, preview and startup checkbox are invalid. Refresh current state before acting.',
    INPUT_INVALID: 'Choose one manager, distinct members, a team title and a one-line description. Check the selected native title.', REFRESH_REQUIRED: 'Refresh the snapshot first.', PREVIEW_REQUIRED: 'Preview the exact change first.', REVIEW_ACK_REQUIRED: 'Review the loaded snapshot and check the explicit acknowledgment first.', INVALID_RESPONSE: 'The Host returned an unrecognized response. No usable current state is assumed.', CONNECTION_CHANGED: 'Connection reset invalidated the previous view.', TRANSPORT_ERROR: 'The request failed at the transport boundary.', active: 'Active', idle: 'Retired / historical', current: 'Current', 'needs-review': 'Needs fresh manager review', progress: 'Progress', blocked: 'Blocked', complete: 'Complete', availableState: 'Available', missingState: 'Missing', unknown: 'Unknown', running: 'Running', unloaded: 'Unloaded', agree: 'Agree', conditional: 'Conditional', object: 'Object', accepted: 'Accepted', escalated: 'Escalated',
    text: 'Text', titleField: 'Title', status: 'Status', authorId: 'Author', targetId: 'Teammate', sessionId: 'Session', managerId: 'Manager', memberIds: 'Members', at: 'Recorded at', version: 'Version', reportId: 'Report', proposalId: 'Proposal', reportVersion: 'Report version', proposalRevision: 'Proposal revision', assignmentRevision: 'Assignment revision', response: 'Response', outcome: 'Outcome', exceptionalRules: 'Optional plain-language rules', confirmed: 'Manager-confirmed', tenure: 'Membership tenure', tenures: 'Membership tenures', observation: 'Native observation', availability: 'Availability', execution: 'Execution', archivedField: 'Archived', identityHistory: 'Identity history', acknowledgment: 'Attention acknowledgment', throughSequence: 'Through sequence', sequence: 'Sequence', kind: 'Kind', reason: 'Reason', action: 'Action', type: 'Record type', teamId: 'Team', id: 'Record', recipientId: 'Recipient', revisions: 'Revisions', concernedIds: 'Concerned teammates', generationField: 'Generation', yes: 'Yes', no: 'No', removed: 'Removed', added: 'Added', previousManagerId: 'Previous manager', freshWork: 'Current work is managed in conversation; historical work below is not an instruction to resume.',
    openNativeFile: 'Open native file reference', openSessionFiles: 'Open Session files (path shown)', referenceHelp: 'Unverified literal reference from its author Session. Open only by your click; native preview handles read/permission errors. Directory actions open that Session’s Files navigator, not the exact folder.', referenceNavigationFailed: 'Could not navigate to the source Session or native resource', dismiss: 'Dismiss',
    responseNeededBy: 'Response requested from',
    team: 'Team', managerChange: 'Manager role change', reactivateAction: 'Reactivate retired team and save this roster', draftStale: 'Your unsaved setup was retained while the loaded ledger changed. Compare it with the current profile, then preview again; no old preview is reusable.', hostFailure: 'The Host did not confirm this operation.',
    STALE: 'The ledger changed. Refresh and review a new preview.', STALE_REVIEW: 'Startup generation or reviewed snapshot changed. Refresh and explicitly review again.', INVALID_TOPOLOGY: 'This roster violates the one-upstream or no-cycle rule. Review the selected manager and members across teams.', ARCHIVED: 'An archived native Session cannot join. Remove it explicitly or choose another Session.', FORBIDDEN: 'This operation is not authorized for the current caller.', OWNER_REQUIRED: 'Team setup requires the authenticated owner.', NOT_FOUND: 'A referenced record or native Session is no longer available. Refresh first.', REVIEW_REQUIRED: 'Startup owner review is required; old work is not resumed.',
    exactSnapshot: 'Exact loaded snapshot', retained: 'Retained historical records', source: 'Source', details: 'Details', nativeList: 'Native workspace and Session list', };
  const ZH = { ...EN,
    title: '会话团队', intro: '先手动创建原生会话，再选择一位管理者和团队成员。工作通过会话对话管理。', refresh: '刷新', back: '返回对话', loading: '正在读取当前状态…', lastLoaded: '上次读取／已过期的快照', stale: '编辑或确认前请刷新。上次读取的内容仅供查看。', snapshotNote: '打开面板、连接重置、主动刷新及更改后读取。不会轮询、自动唤醒或批准执行。',
    setup: '团队设置 · 仅所有者', newTeam: '新建团队', editTeam: '编辑团队', chooseTeam: '选择团队设置', teamTitle: '团队名称', description: '一句话描述', descriptionHelp: '描述不是工作指令。管理者通过对话维护团队简报、职责和任务。', manager: '管理者 · 单选', members: '成员 · 添加或移除', pickerHelp: '使用同一选择器添加或移除成员。请先在原生侧边栏创建会话。各会话最多一个上级团队且不得成环。更换管理者时，原管理者默认保留为成员，除非明确取消选择。', ungrouped: '未分组会话', pendingCatalog: '原生会话或工作区仍在加载。空列表不代表已确认没有选择。', catalogError: '无法读取原生工作区列表。选择新会话前请刷新或重新连接。', noChoices: '没有可选的原生会话。请先在侧边栏创建独立会话。', missing: '当前原生列表中缺失 · 保留已保存的选择', pending: '加载中的列表尚未显示 · 保留选择', archived: '已归档 · 保留选择', subagent: '原生子代理 · 不可新增选择', incompatible: '需要迁移原生格式 · 保留选择', retainedWarning: '下方保留了不可用的已保存选择。若要移除请明确取消，不会静默丢弃。保存时 Host 会验证可用性。',
    previewButton: '预览本次更改', preview: '审核本次准确更改', previewHelp: '仅提交此暂存更改及其版本、代次和快照令牌。不会自动重试或重放。', apply: '应用本次更改', cancel: '取消预览', saveAction: '保存团队设置', retire: '停用团队', retireAction: '停用此团队', session: '会话', teams: '团队档案 · 只读', noTeams: '尚无团队。请使用下方设置。', profileHelp: '此处仅能编辑设置和原生标题。工作由管理者通过对话维护；身份和事实报告由各会话自行维护。', brief: '团队简报', responsibilities: '职责', assignments: '任务分配', reports: '报告及版本', comments: '评论', proposals: '提案及决定', history: '历史', identity: '身份', state: '状态', none: '暂无记录', open: '打开原生会话', latestReport: '最新报告', versions: '版本', responses: '回应', decisions: '决定', origin: '来源报告', concerned: '相关成员',
    held: '启动后协调暂停', heldHelp: '请审核下方当前成员和工作。暂停期间仍可编辑设置。审核不会恢复旧任务或旧同意，也不会批准执行。', available: '无需启动审核', reviewAck: '我已审核此准确快照中的成员、简报、任务、报告、提案及启动暂停状态。不会恢复旧任务或旧同意。', reviewButton: '预览启动审核', reviewAction: '解除本次已审核的启动暂停', revision: '版本', generation: '启动代次', ownerCommitted: '团队设置已提交。', reviewCommitted: '启动审核已提交。旧任务及旧同意未恢复。', operationFeedback: '操作结果', error_input: '请检查选择', help_input: '修正设置后重新预览准确更改。', error_read: '无法读取当前快照', help_read: '请刷新取得当前快照。读取失败不会使缓存变为最新。', error_mutation: '更改结果尚未确认', help_mutation: '请勿盲目重发。请刷新确认状态；传输失败不代表没有提交。', error_postCommit: '更改已提交，后续刷新失败', help_postCommit: '成功已确认。请刷新快照，不要重复本次更改。', error_connection: '连接已变化', help_connection: '旧代次、预览和审核勾选已失效。操作前请刷新当前状态。',
    INPUT_INVALID: '请选择一位管理者、不重复的成员、团队名称和一句话描述，并检查原生标题。', REFRESH_REQUIRED: '请先刷新快照。', PREVIEW_REQUIRED: '请先预览准确更改。', REVIEW_ACK_REQUIRED: '请先审核已加载快照并明确勾选确认。', INVALID_RESPONSE: 'Host 返回了无法识别的响应，不会视为可用当前状态。', CONNECTION_CHANGED: '连接重置使旧快照失效。', TRANSPORT_ERROR: '请求在传输边界失败。', active: '有效', idle: '已停用／历史', current: '当前', 'needs-review': '需要管理者重新审核', progress: '进展', blocked: '受阻', complete: '完成', availableState: '可用', missingState: '缺失', unknown: '未知', running: '运行中', unloaded: '未加载', agree: '同意', conditional: '有条件同意', object: '反对', accepted: '已接受', escalated: '已升级',
    openNativeFile: '打开原生文件引用', openSessionFiles: '打开会话文件（路径如下）', referenceHelp: '这是作者会话提供的未验证原样路径。仅在您点击后打开；读取或权限错误由原生预览处理。目录操作仅打开该会话的文件导航器，不会精确定位文件夹。', referenceNavigationFailed: '无法导航到来源会话或原生资源', dismiss: '关闭提示',
    responseNeededBy: '请求以下成员回应',
    team: '团队', managerChange: '管理者角色更改', reactivateAction: '重新启用已停用团队并保存此成员列表', draftStale: '读取的账本已变化，未保存的设置草稿已保留。请对比当前档案并重新预览；旧预览不可复用。', hostFailure: 'Host 未确认本次操作。', STALE: '账本已变化。请刷新并审核新的预览。', STALE_REVIEW: '启动代次或已审核快照已变化。请刷新并重新明确审核。', INVALID_TOPOLOGY: '此成员关系违反单一上级或无环规则。请检查各团队的管理者及成员。', ARCHIVED: '已归档原生会话不可加入。请明确移除或选择其他会话。', FORBIDDEN: '当前调用者无权执行本次操作。', OWNER_REQUIRED: '团队设置需要经过身份验证的所有者。', NOT_FOUND: '引用的记录或原生会话已不可用。请先刷新。', REVIEW_REQUIRED: '需要所有者启动审核；不会恢复旧工作。',
    text: '内容', titleField: '标题', status: '状态', authorId: '作者', targetId: '成员', sessionId: '会话', managerId: '管理者', memberIds: '成员', at: '记录时间', version: '版本', reportId: '报告', proposalId: '提案', reportVersion: '报告版本', proposalRevision: '提案版本', assignmentRevision: '任务版本', response: '回应', outcome: '结果', exceptionalRules: '可选自然语言规则', confirmed: '管理者已确认', tenure: '成员任期', tenures: '成员任期', observation: '原生状态', availability: '可用性', execution: '执行状态', archivedField: '已归档', identityHistory: '身份历史', acknowledgment: '关注事件确认', throughSequence: '截至序号', sequence: '序号', kind: '类别', reason: '原因', action: '动作', type: '记录类型', teamId: '团队', id: '记录', recipientId: '接收者', revisions: '修订', concernedIds: '相关成员', generationField: '代次', yes: '是', no: '否', removed: '已移除', added: '已添加', previousManagerId: '前管理者', freshWork: '当前工作通过对话管理；下方历史记录不是恢复执行的指令。', exactSnapshot: '准确的已加载快照', retained: '保留的历史记录', source: '来源', details: '详情', nativeList: '原生工作区和会话列表', };
  Object.assign(EN, { teams: 'Teams', setup: 'Team setup', noTeams: 'No teams yet.', profile: 'Overview', objective: 'Objective', backTeams: 'Back to teams', specificAssignment: 'Current assignment', noOverall: 'No overall assignment yet.', viewReport: 'Read report', recentProposals: 'Recent proposals and decisions', olderVersions: 'Older versions', referencedReport: 'Referenced report', rosterHistory: 'Team changes', visibleRunning: 'Running', visibleWaiting: 'Waiting', visibleIdle: 'Idle', visibleComplete: 'Complete', visibleUnavailable: 'Unavailable', heldHelp: 'Coordination is paused. Review current work before releasing the hold.', stale: 'Showing last loaded work. Refresh before making changes.', pendingCatalog: 'Native Sessions are still loading.', retainedWarning: 'Unavailable selections are retained. Remove them explicitly if intended.', draftStale: 'Setup changed elsewhere. Your draft is retained; compare and preview again.', });
  Object.assign(ZH, { teams: '团队', setup: '团队设置', noTeams: '尚无团队。', profile: '概览', objective: '目标', backTeams: '返回团队', specificAssignment: '当前具体任务', noOverall: '尚无总体分工。', viewReport: '阅读报告', recentProposals: '近期提案与决定', olderVersions: '较早版本', referencedReport: '引用的报告', rosterHistory: '团队变更', visibleRunning: '运行中', visibleWaiting: '等待中', visibleIdle: '空闲', visibleComplete: '已完成', visibleUnavailable: '不可用', heldHelp: '协调已暂停。请审核当前工作后解除暂停。', stale: '显示上次加载的工作。更改前请刷新。', pendingCatalog: '原生会话仍在加载。', retainedWarning: '不可用的选择已保留。若要移除，请明确取消。', draftStale: '设置已在别处更改。草稿已保留，请对比后重新预览。', });
  Object.assign(EN, {
    chooseManager: 'Choose manager', selectWorkspace: 'Select direct Sessions', blank: 'Unused blank Session · retained selection',
    detailsHistory: 'Details & History', backTeam: 'Back to team', loadingHistory: 'Loading team details and history…', historyFailed: 'Team history could not be loaded. Refresh to try again.',
    currentReports: 'Current worker reports', reportForAssignment: 'Report for this assignment', unassignedReport: 'Report without a specific assignment',
    citedUnavailable: 'The exact cited report text is unavailable. No newer version has been substituted.', currentProposal: 'Current proposal text', earlierProposal: 'Earlier proposal text',
    workAndReports: 'Work & reports', workProgress: 'Work progress', membership: 'Membership & team setup changes', assignmentSetup: 'Current assignment & setup',
    workerSetup: 'Worker setup', presetLabel: 'Preset', workingDirectory: 'Working directory', workspaceBoundary: 'Workspace boundary', sandboxLabel: 'Sandbox', approvalLabel: 'Approval policy', approvalChannel: 'Approval channel',
    registeredTools: 'Registered tools', writableRoots: 'Writable roots', toolsTruncated: 'Tool names are a limited summary.', setupLimits: 'Unknown means not established. Registered tools are not guaranteed to be admitted. Native permission checks still apply.',
    ready: 'Ready', waiting: 'Waiting', 'in-progress': 'In progress', noOverall: 'No responsibility recorded.', reports: 'Reports', profileHelp: 'Work is managed in conversation.', INPUT_INVALID: 'Choose one manager, distinct members, a team title and a one-line description.'
  });
  Object.assign(ZH, {
    chooseManager: '选择管理者', selectWorkspace: '选择直属会话', blank: '未使用的空白会话 · 保留选择',
    detailsHistory: '详情与历史', backTeam: '返回团队', loadingHistory: '正在加载团队详情与历史…', historyFailed: '无法加载团队历史，请刷新重试。',
    currentReports: '当前成员报告', reportForAssignment: '此任务对应的报告', unassignedReport: '未关联具体任务的报告',
    citedUnavailable: '引用的准确报告文本不可用，未以较新版本替代。', currentProposal: '当前提案文本', earlierProposal: '较早提案文本',
    workAndReports: '工作与报告', workProgress: '工作进展', membership: '成员与团队设置变更', assignmentSetup: '当前任务与设置',
    workerSetup: '成员设置', presetLabel: '预设', workingDirectory: '工作目录', workspaceBoundary: '工作区边界', sandboxLabel: '沙箱', approvalLabel: '审批策略', approvalChannel: '审批渠道',
    registeredTools: '已注册工具', writableRoots: '可写目录', toolsTruncated: '工具名称为有限摘要。', setupLimits: '未知表示尚未确认。已注册工具不代表一定获准使用，仍受原生权限检查约束。',
    ready: '就绪', waiting: '等待中', 'in-progress': '进行中', noOverall: '尚无职责记录。', reports: '报告', profileHelp: '工作通过对话管理。', INPUT_INVALID: '请选择一位管理者、不重复的成员、团队名称及一句话描述。'
  });
  Object.assign(EN, {
    visibleNeedsIntervention: 'Needs intervention', visibleApprovalNeeded: 'Approval needed', visibleWithUser: 'With user',
    retired: 'Retired', retiredTeams: 'Retired teams', reopenTeam: 'Reopen team', pauseAutomation: 'Pause automation', resumeAutomation: 'Resume automation',
    retireExplanation: 'Current assignments and pending proposals will stop being actionable. Sessions will not be archived or stopped. All records will be kept.',
    pauseExplanation: 'Pause new automatic team wake-ups. Current native runs are not stopped.', resumeExplanation: 'Resume eligible new automatic team wake-ups. Retired or stale work is not restarted.',
    coordinationStatus: 'Team status', statusUnknown: 'Status could not be refreshed. No Session has been started.', messages: 'Peer information & handoffs', alerts: 'Alerts', wakeups: 'Automatic delivery history',
    'proposalneeds-confirmation': 'Awaiting manager confirmation', 'proposalneeds-attention': 'Manager attention needed', 'proposalawaiting-responses': 'Awaiting responses', 'proposalready': 'Ready for manager decision', 'proposalclosed': 'Closed with team', 'proposalstale': 'No longer applicable',
    deliverypending: 'Queued', deliveryclaimed: 'Dispatching', deliverysent: 'Sent', deliverycancelled: 'Cancelled', deliveryfailed: 'Failed',
    information: 'Information', request: 'Request', reply: 'Reply', handoff: 'Handoff', alert: 'Alert',
    noActiveTeams: 'No active teams.', noCurrentWork: 'No current work', withUserHelp: 'Team delivery is deferred while this Session focuses on the user.', approvalHelp: 'A native approval request is currently pending.'
  });
  Object.assign(ZH, {
    visibleNeedsIntervention: '需要介入', visibleApprovalNeeded: '等待审批', visibleWithUser: '与用户交流',
    retired: '已停用', retiredTeams: '已停用团队', reopenTeam: '重新启用团队', pauseAutomation: '暂停自动协作', resumeAutomation: '恢复自动协作',
    retireExplanation: '当前任务和待定提案将不再生效。不会归档或停止原生会话，所有记录都会保留。',
    pauseExplanation: '暂停新的团队自动唤醒，不停止当前原生运行。', resumeExplanation: '恢复符合条件的新自动唤醒，不重新执行已停用或过期的工作。',
    coordinationStatus: '团队状态', statusUnknown: '无法刷新状态，未启动任何会话。', messages: '成员信息与交接', alerts: '提醒', wakeups: '自动投递历史',
    'proposalneeds-confirmation': '等待管理者确认', 'proposalneeds-attention': '需要管理者处理', 'proposalawaiting-responses': '等待回应', 'proposalready': '可由管理者决定', 'proposalclosed': '随团队关闭', 'proposalstale': '已不再适用',
    deliverypending: '排队中', deliveryclaimed: '投递中', deliverysent: '已发送', deliverycancelled: '已取消', deliveryfailed: '失败',
    information: '信息', request: '请求', reply: '回复', handoff: '交接', alert: '提醒',
    noActiveTeams: '暂无活动团队。', noCurrentWork: '暂无当前工作', withUserHelp: '此会话专注于用户，团队信息投递已延后。', approvalHelp: '当前有一项原生审批请求。'
  });
  Object.assign(EN, { dispatches: 'Dispatch previews & history', dispatchprepared: 'Prepared — not dispatched', dispatchconfirmed: 'Confirmed', dispatchExactPlan: 'Exact prepared plan', dispatchEvidence: 'Confirmation evidence', planVersion: 'Plan version', permissionExpectations: 'Permission expectations', dispatchConfirmationHelp: 'Confirmation happens in conversation after a fresh user reply. It does not grant native permissions.', returnedToCoordination: 'Returned to coordination', keptWithUser: 'Kept With user', discussionUserMessageId: 'Discussion user message', confirmationUserMessageId: 'Confirmation user message', afterSessionId: 'After teammate', identities: 'Identities', statuses: 'Task status changes', deliveryDiagnostics: 'Current delivery diagnostics', deliveryMeaning: 'Recorded = decision saved; pending = queued; claimed = native admission in progress; sent = native input admitted. None proves understanding or processing. Diagnostics are a point-in-time read.', deliveryrecorded: 'Recorded', deliverypending: 'Pending', deliveryclaimed: 'Claimed', deliverysent: 'Sent — native input admitted', heldReason: 'Held reason', deliveryFailed: 'Delivery diagnostics could not be read. Refresh to retry.', recordOnly: 'Record only — no continuation', continuation: 'Continuation intent', continuationWakeIds: 'Related delivery records', noContinuationWake: 'No continuation wake recorded' });
  Object.assign(ZH, { dispatches: '派工预览与历史', dispatchprepared: '已准备 — 尚未派工', dispatchconfirmed: '已确认', dispatchExactPlan: '准确的已准备计划', dispatchEvidence: '确认依据', planVersion: '计划版本', permissionExpectations: '权限预期', dispatchConfirmationHelp: '通过对话中的新用户回复确认，不授予原生权限。', returnedToCoordination: '已返回团队协调', keptWithUser: '继续与用户交流', discussionUserMessageId: '讨论用户消息', confirmationUserMessageId: '确认用户消息', afterSessionId: '前序成员', identities: '身份', statuses: '任务状态变更', deliveryDiagnostics: '当前投递诊断', deliveryMeaning: '已记录表示决定已保存；待投递表示排队；已认领表示正在原生准入；已发送表示原生输入已准入。均不证明已理解或处理。诊断仅代表读取时刻。', deliveryrecorded: '已记录', deliverypending: '待投递', deliveryclaimed: '已认领', deliverysent: '已发送 — 原生输入已准入', heldReason: '暂缓原因', deliveryFailed: '无法读取投递诊断，请刷新重试。', recordOnly: '仅记录 — 不继续唤醒', continuation: '继续执行意图', continuationWakeIds: '关联投递记录', noContinuationWake: '未记录继续执行唤醒' });
  const CSS = `
.sc9-page{box-sizing:border-box;height:100%;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);font:inherit}.sc9-body{max-width:960px;margin:auto;display:grid;gap:20px}.sc9-page h1{font-size:20px;line-height:28px;margin:0}.sc9-page h2{font-size:16px;line-height:24px;margin:0 0 10px}.sc9-page h3,.sc9-page h4{font-size:14px;line-height:22px;margin:8px 0}.sc9-page p{line-height:1.6;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.sc9-note{font-size:13px;color:var(--dsw-alias-label-secondary)}.sc9-card{min-width:0;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.sc9-warning{border-color:var(--dsw-alias-state-warn-primary)}.sc9-error{border-color:var(--dsw-alias-state-error-primary)}.sc9-success{color:var(--dsw-alias-state-success-primary)}.sc9-row,.sc9-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.sc9-row{justify-content:space-between}.sc9-form,.sc9-field{display:grid;gap:8px}.sc9-form{gap:16px}.sc9-field{font-size:13px}.sc9-page button,.sc9-page input,.sc9-page select{box-sizing:border-box;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base)}.sc9-page button{min-height:32px;padding:6px 12px;cursor:pointer}.sc9-page button:disabled{opacity:.5;cursor:default}.sc9-page input:not([type=checkbox]):not([type=radio]),.sc9-page select{width:100%;min-height:34px;padding:7px 10px}.sc9-page fieldset{margin:0;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px}.sc9-page legend{font-size:13px;padding:0 4px}.sc9-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:22px;padding:3px 0;overflow-wrap:anywhere}.sc9-check input{margin-top:4px;accent-color:var(--dsw-alias-brand-primary)}.sc9-picker-group{margin:8px 0}.sc9-item{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.sc9-page a{color:var(--dsw-alias-brand-primary)}.sc9-page :is(button,input,select,a,summary):focus-visible,.sc9-page [tabindex="-1"]:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.sc9-primary{font-weight:600;border-color:var(--dsw-alias-brand-primary)!important}.sc9-page summary{cursor:pointer;font-size:13px;padding:6px 0}.sc9-record{margin:6px 0;padding-left:12px;border-left:1px solid var(--dsw-alias-border-l1)}.sc9-page dl{margin:6px 0}.sc9-page dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:6px}.sc9-page dd{margin:2px 0 6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.sc9-page code{font-size:12px;overflow-wrap:anywhere}.sc9-empty{font-size:13px;color:var(--dsw-alias-label-secondary)}
.sc9-page button.sc9-reference{padding:0 2px;min-height:0;text-align:left;white-space:normal;overflow-wrap:anywhere;color:var(--dsw-alias-brand-primary);text-decoration:underline;border:0;background:none}
.sc9-members{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}.sc9-team-list{display:grid;gap:12px}.sc9-page button.sc9-team{text-align:left;padding:20px;background:var(--dsw-alias-bg-layer-1)}.sc9-team h2{margin-bottom:4px}.sc9-objective h3{color:var(--dsw-alias-label-secondary);font-size:13px}.sc9-objective>p{font-size:18px;line-height:1.6}.sc9-role{font-size:13px;color:var(--dsw-alias-brand-primary)}.sc9-badge{font-size:12px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);border-radius:20px;padding:2px 8px;color:var(--dsw-alias-label-secondary)}.sc9-badge[data-state=Running]{color:var(--dsw-alias-brand-primary)}.sc9-badge[data-state=Waiting]{color:var(--dsw-alias-state-warn-primary)}.sc9-badge[data-state=Complete]{color:var(--dsw-alias-state-success-primary)}.sc9-badge[data-state=Unavailable]{color:var(--dsw-alias-label-secondary)}.sc9-page summary{cursor:pointer;line-height:1.6}.sc9-overall{min-height:3em}.sc9-page button:focus-visible,.sc9-page summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}@media(max-width:560px){.sc9-page{padding:16px}.sc9-card{padding:14px}}
.sc9-setup>summary,.sc9-page h2.sc9-setup-heading{font-size:18px;font-weight:700;line-height:28px}.sc9-page .sc9-picker-label{font-size:15px;font-weight:700}.sc9-workspace-heading{display:flex;align-items:center;gap:8px;line-height:26px}.sc9-workspace-children{padding-left:18px}.sc9-workspace-heading input{accent-color:var(--dsw-alias-brand-primary)}
@media(pointer:coarse){.sc9-page button{min-height:40px}.sc9-page input,.sc9-page select{font-size:16px}}
`;
  function apply(ctx) {
    const React = require('react'), h = React.createElement, controllers = new Set(), navigation = createNavigation();
    ctx.effect(() => ctx.locale.register(NS, 'en', EN));
    ctx.effect(() => ctx.locale.register(NS, 'zh', ZH));
    ctx.effect(() => () => { for (const controller of controllers) controller.dispose(); controllers.clear(); });
    const transport = createTransport(ctx.connection), statusStore = createStatusStore(transport);
    ctx.effect(() => { statusStore.start(); const off = ctx.on('connection/reset', () => statusStore.reset()); return () => { off(); statusStore.dispose(); }; });
    const resourceNavigator = createResourceNavigator({ mounted: ctx.sidebarRight.mounted,
      openSession: sessionId => ctx.uiWorkspace.openSession(sessionId), openResource: (address, options) => ctx.sidebarRight.openResource(address, options),
      openTab: name => ctx.sidebarRight.openTab(name), returnToPanel: () => ctx.layout.selectPanel(PANEL) });
    ctx.effect(() => () => resourceNavigator.dispose());
    function StatusDot({ state, reason = '', t }) {
      const missing = state === 'Unavailable', label = statusLabel(state, t, reason);
      return h('span', { className: 'sc9-status', role: 'img', 'aria-label': label, title: label, 'data-state': state,
        style: { display: 'inline-block', flex: 'none', width: 7, height: missing ? 2 : 7, borderRadius: missing ? 1 : '50%', cornerShape: 'round', background: STATE_COLORS[state], verticalAlign: 'middle' } });
    }
    function SidebarStatus(props) {
      const status = React.useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot);
      const sessions = props.useSessions(value => value), nativeStatus = props.useSessionStatus(value => value.get(props.sessionId));
      const archived = props.useWorkspaces(value => value.archivedSessionIds?.includes(props.sessionId) === true);
      const projected = sidebarProjection(status, sessions, props.sessionId, nativeStatus, archived);
      return projected ? h(StatusDot, { ...projected, t: props.t }) : null;
    }
    function SidebarStatusHover(props) {
      const status = React.useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot);
      const sessions = props.useSessions(value => value), nativeStatus = props.useSessionStatus(value => value.get(props.sessionId));
      const archived = props.useWorkspaces(value => value.archivedSessionIds?.includes(props.sessionId) === true);
      const projected = sidebarProjection(status, sessions, props.sessionId, nativeStatus, archived);
      if (!projected) return null;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, h(StatusDot, { ...projected, t: props.t }),
        h('span', null, statusLabel(projected.state, props.t, projected.reason)));
    }
    function Icon({ size = 20 }) { return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('circle', { cx: 12, cy: 5, r: 2.5 }), h('circle', { cx: 5, cy: 18, r: 2.5 }), h('circle', { cx: 19, cy: 18, r: 2.5 }), h('path', { d: 'M12 7.5v5M5 15.5v-4h14v5' })); }
    function SessionPicker({ catalog, value, multiple = false, onChange, disabled, label, t, name, excludedId }) {
      const values = multiple ? value : value ? [value] : [], selected = new Set(values);
      const available = entry => entry.eligible || selected.has(entry.id);
      if (!multiple) return h('label', { className: 'sc9-field sc9-picker-label' }, label,
        h('select', { name, value, disabled: disabled || !catalog.ready, onChange: event => onChange(event.target.value) }, h('option', { value: '' }, t('chooseManager')),
          ...catalog.groups.filter(group => group.entries.some(available)).map(group => h('optgroup', { key: group.id, label: group.title ?? t('ungrouped') },
            ...group.entries.filter(available).map(entry => h('option', { key: entry.id, value: entry.id, disabled: !entry.eligible && !selected.has(entry.id) }, entry.label + (entry.reason ? ' · ' + t(entry.reason) : '')))))));
      const renderEntry = entry => h('label', { className: 'sc9-check', key: entry.id },
        h('input', { type: 'checkbox', name, value: entry.id, checked: selected.has(entry.id), disabled: !catalog.ready || !entry.eligible && !selected.has(entry.id),
          onChange: event => onChange(event.target.checked ? [...values, entry.id] : values.filter(value => value !== entry.id)) }),
        h('span', null, entry.label, entry.reason && h('span', { className: 'sc9-note' }, ' · ' + t(entry.reason))));
      const renderGroup = group => {
        const direct = group.entries.filter(entry => entry.id !== excludedId), selection = directSelection(group, values, excludedId);
        if (!direct.length && !group.children.length) return null;
        return h('div', { className: 'sc9-picker-group', key: group.id },
          h('div', { className: 'sc9-workspace-heading' }, selection.ids.length > 0 && h('input', { type: 'checkbox', checked: selection.checked, disabled: !catalog.ready,
            'aria-label': t('selectWorkspace') + ': ' + (group.title ?? t('ungrouped')), onChange: () => onChange(toggleDirect(group, values, excludedId)) }),
            h('strong', null, group.title ?? t('ungrouped'))),
          h('div', { className: 'sc9-workspace-children' }, ...group.children.map(renderGroup), ...direct.map(renderEntry)));
      };
      return h('fieldset', { disabled, 'aria-busy': !catalog.ready }, h('legend', { className: 'sc9-picker-label' }, label),
        !catalog.ready && h('p', { className: 'sc9-note', role: 'status' }, t(catalog.error ? 'catalogError' : 'pendingCatalog')),
        !catalog.tree.length && catalog.ready && h('p', { className: 'sc9-empty' }, t('noChoices')),
        catalog.entries.some(entry => selected.has(entry.id) && !entry.eligible) && h('p', { className: 'sc9-note' }, t('retainedWarning')),
        ...catalog.tree.map(renderGroup));
    }
    function TextRecord({ value, t, sources, sourceId }) {
      sourceId = recordSource(value, sourceId, sources);
      const text = typeof value === 'string' ? value : value?.text ?? '';
      return h('p', null, ...markdownReferences(text, sourceId).map((part, index) => part.reference ? h('button', { key: index, type: 'button', className: 'sc9-reference', title: t('referenceHelp'), onClick: () => resourceNavigator.navigate(part.reference) },
        (part.reference.kind === 'directory' ? t('openSessionFiles') + ': ' : t('openNativeFile') + ': ') + part.text + ' · ' + part.reference.path + (part.reference.line ? '#L' + part.reference.line : '')) : part.text));
    }
    function Proposal({ proposal, t, catalog, names, compact = true }) {
      const revision = latest(proposal.revisions), decision = currentDecision(proposal), sourceId = recordSource(revision, recordSource(proposal.origin, undefined, catalog.byId), catalog.byId);
      const summary = record => compact && record ? { ...record, text: shortSummary(record.text) } : record;
      return h('section', { className: 'sc9-item' },
        revision?.identityChange && h('h4', null, names(revision.identityChange.targetId) + ' → ' + revision.identityChange.identity),
        h(TextRecord, { value: summary(revision ?? proposal.origin), t, sources: catalog.byId, sourceId }),
        !decision && proposal.readiness && h('p', { className: 'sc9-note' }, t('proposal' + proposal.readiness) + (proposal.readiness === 'awaiting-responses' && proposal.missingResponses?.length ? ': ' + proposal.missingResponses.map(names).join(', ') : '')),
        decision && h('p', { className: 'sc9-note' }, names(decision.authorId) + ' · ' + t(decision.outcome)),
        decision?.text && h(TextRecord, { value: summary(decision), t, sources: catalog.byId }),
        proposal.origin?.reportId && h('button', { onClick: () => navigation.detail('history', proposal.origin.authorId, proposal.origin.reportId, proposal.origin.version) }, t('origin')));
    }
    function Reports({ state, team, history = false, t, catalog, names }) {
      const reports = history ? state.reports.filter(report => report.teamId === team.id) : currentWorkerReports(state, team);
      return h('section', { className: 'sc9-card' }, h('h2', null, t(history ? 'reports' : 'currentReports')), !reports.length && h('p', { className: 'sc9-note' }, t('none')),
        ...reports.slice().reverse().map(report => {
          const renderVersion = version => {
            const assignment = team.assignments.find(item => item.revision === version.assignmentRevision && item.targetId === report.authorId);
            return h(React.Fragment, null, h('p', { className: 'sc9-note' }, t(assignment ? 'reportForAssignment' : 'unassignedReport')),
              assignment && h(TextRecord, { value: assignment, t, sources: catalog.byId }),
              h(TextRecord, { value: version, t, sources: catalog.byId, sourceId: recordSource(report, undefined, catalog.byId) }));
          };
          return h('article', { id: reportAnchor(team.id, report.id), key: report.id, className: 'sc9-item' }, h('h3', null, names(report.authorId)),
            renderVersion(latest(report.versions)),
            history && report.versions.length > 1 && h('details', null, h('summary', null, t('olderVersions')), ...report.versions.slice(0, -1).reverse().map((version, index) => h('section', { className: 'sc9-item', key: index }, renderVersion(version)))));
        }));
    }
    function DispatchHistory({ state, team, t, names }) {
      const dispatches = state.dispatches.filter(item => item.teamId === team.id);
      return h('details', null, h('summary', null, t('dispatches')), !dispatches.length && h('p', { className: 'sc9-note' }, t('none')),
        ...dispatches.slice().reverse().map(dispatch => h('details', { key: dispatch.id, className: 'sc9-item' },
          h('summary', null, t('dispatch' + dispatch.status) + ' · ' + shortSummary(dispatch.summary)),
          h('p', null, dispatch.summary), h('p', { className: 'sc9-note' }, names(dispatch.managerId) + ' · ' + t('planVersion') + ' ' + dispatch.planVersion),
          h('p', { className: 'sc9-note' }, t('permissionExpectations') + ': ' + (dispatch.permissionExpectations || t('none'))),
          h('p', { className: 'sc9-note' }, t('dispatchConfirmationHelp')),
          dispatch.confirmation && h('p', { className: 'sc9-note' }, t(dispatch.confirmation.returnToCoordination ? 'returnedToCoordination' : 'keptWithUser')),
          dispatch.plan && h('details', null, h('summary', null, t('dispatchExactPlan')),
            dispatch.plan.objective && h('p', null, t('objective') + ': ' + dispatch.plan.objective),
            dispatch.plan.exceptionalRules && h('p', null, t('exceptionalRules') + ': ' + dispatch.plan.exceptionalRules),
            dispatch.plan.automation !== undefined && h('p', null, t(dispatch.plan.automation ? 'resumeAutomation' : 'pauseAutomation')),
            ...['identities', 'responsibilities', 'assignments', 'statuses'].flatMap(key => (dispatch.plan[key] ?? []).map((item, index) => h('section', { key: key + index, className: 'sc9-item' },
              h('h4', null, names(item.targetId) + ' · ' + t(key)), h('p', null, item.text ?? item.identity ?? ''),
              item.workStatus && h('p', null, t(item.workStatus)), item.waitingReason && h('p', null, item.waitingReason),
              item.afterSessionId && h('p', { className: 'sc9-note' }, t('afterSessionId') + ': ' + names(item.afterSessionId)),
              item.expectedAssignment && h('p', { className: 'sc9-note' }, t('assignmentRevision') + ': ' + item.expectedAssignment.assignmentRevision + ' · ' + t('version') + ': ' + item.expectedAssignment.assignmentVersion),
              item.assignmentRevision && h('p', { className: 'sc9-note' }, t('assignmentRevision') + ': ' + item.assignmentRevision + ' · ' + t('version') + ': ' + item.assignmentVersion))))),
          h('details', null, h('summary', null, t('dispatchEvidence')), h('p', { className: 'sc9-note' }, dispatch.id + ' · ' + dispatch.hash),
            h('p', { className: 'sc9-note' }, t('discussionUserMessageId') + ': ' + dispatch.discussionUserMessageId),
            dispatch.confirmation && h('p', { className: 'sc9-note' }, t('confirmationUserMessageId') + ': ' + dispatch.confirmation.userMessageId)))));
    }
    function DeliveryDetails({ team, t, names, model, controllerState }) {
      const delivery = controllerState.delivery, loaded = delivery?.teamId === team.id && delivery.view;
      return h('details', { onToggle: event => { if (event.currentTarget.open && !delivery) void model.loadDelivery(team.id); } }, h('summary', null, t('deliveryDiagnostics')),
        h('p', { className: 'sc9-note' }, t('deliveryMeaning')),
        delivery?.busy && h('p', { role: 'status' }, t('loading')),
        delivery?.error && h('p', { role: 'alert' }, t('deliveryFailed')),
        h('button', { disabled: !controllerState.fresh || !!delivery?.busy, onClick: () => void model.loadDelivery(team.id) }, t('refresh')),
        loaded && h(React.Fragment, null, !loaded.wakeups.length && !loaded.continuations.length && h('p', null, t('none')),
          ...loaded.wakeups.map(wake => h('p', { key: wake.id }, names(wake.sessionId) + ' · ' + t('delivery' + wake.status) + ' · ' + wake.reason + ' · ' + wake.id
            + (wake.heldReason ? ' · ' + t('heldReason') + ': ' + wake.heldReason : '') + (wake.error ? ' · ' + wake.error : ''))),
          ...loaded.continuations.map((item, index) => h('p', { key: 'decision' + index, className: 'sc9-note' }, item.proposalId + ' · ' + t('proposalRevision') + ' ' + item.proposalRevision + ' · ' + t('deliveryrecorded')
            + ' · ' + t(item.recordOnly ? 'recordOnly' : 'continuation') + ' · ' + item.continueAssignments.map(task => names(task.sessionId) + ' (' + t('assignmentRevision') + ' ' + task.assignmentRevision + ')').join(', ')
            + ' · ' + (item.wakeIds.length ? t('continuationWakeIds') + ': ' + item.wakeIds.join(', ') : t('noContinuationWake'))))));
    }
    function History({ state, team, t, catalog, names, route, model, controllerState }) {
      const textList = (key, values) => h('details', { key }, h('summary', null, t(key)), !values.length && h('p', { className: 'sc9-note' }, t('none')), ...values.slice().reverse().map((value, index) => h('section', { className: 'sc9-item', key: index },
        value.targetId && h('h4', null, names(value.targetId)), value.authorId && h('p', { className: 'sc9-note' }, names(value.authorId)), h(TextRecord, { value, t, sources: catalog.byId }),
        value.exceptionalRules && h(TextRecord, { value: { ...value, text: value.exceptionalRules }, t, sources: catalog.byId }),
        value.workStatus && h('p', { className: 'sc9-note' }, t(value.workStatus)), value.waitingReason && h('p', null, value.waitingReason),
        value.statusHistory?.length > 0 && h('details', null, h('summary', null, t('workProgress')), ...value.statusHistory.map((status, key) => h('p', { key }, names(status.authorId) + ' · ' + t(status.workStatus) + (status.waitingReason ? ' · ' + status.waitingReason : '')))))));
      const cited = route.reportId ? exactReport(state, team.id, route.reportId, route.reportVersion) : null;
      return h(React.Fragment, null,
        route.reportId && h('section', { className: 'sc9-card', role: 'region', 'aria-label': t('referencedReport') }, h('h2', null, t('referencedReport')),
          cited ? h(React.Fragment, null, h('h3', null, names(cited.report.authorId)), h(TextRecord, { value: cited.version, t, sources: catalog.byId, sourceId: recordSource(cited.report, undefined, catalog.byId) })) : h('p', null, t('citedUnavailable'))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('workAndReports')), h(DispatchHistory, { state, team, t, names }), textList('assignments', team.assignments), h('details', null, h('summary', null, t('reports')), h(Reports, { state, team, history: true, t, catalog, names }))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('proposals')), !state.proposals.length && h('p', { className: 'sc9-note' }, t('none')),
          ...state.proposals.filter(item => item.teamId === team.id).slice().reverse().map(proposal => h('details', { key: proposal.id }, h('summary', null, shortSummary(latest(proposal.revisions)?.text) || t('proposals')),
            h(Proposal, { proposal, t, catalog, names, compact: false }),
            ...proposal.revisions.slice().reverse().map((revision, key) => h('details', { key }, h('summary', null, t(key === 0 ? 'currentProposal' : 'earlierProposal')),
              h(TextRecord, { value: revision, t, sources: catalog.byId }), h('p', null, t('concerned') + ': ' + (revision.concerned?.map(member => names(member.id)).join(', ') || t('none'))),
              revision.identityChange && h('p', null, names(revision.identityChange.targetId) + ' → ' + revision.identityChange.identity),
              h('h4', null, t('responses')), ...proposal.responses.filter(response => response.proposalRevision === revision.revision).map((response, key) => h('section', { className: 'sc9-item', key }, h('p', null, names(response.sessionId) + ' · ' + t(response.response)), h(TextRecord, { value: response, t, sources: catalog.byId, sourceId: recordSource({ authorId: response.sessionId }, undefined, catalog.byId) }))),
              h('h4', null, t('decisions')), ...proposal.decisions.filter(decision => decision.proposalRevision === revision.revision).map((decision, key) => h('section', { className: 'sc9-item', key }, h('p', null, names(decision.authorId) + ' · ' + t(decision.outcome)), h(TextRecord, { value: decision, t, sources: catalog.byId })))))))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('messages')), !(state.messages ?? []).length && h('p', null, t('none')),
          ...(state.messages ?? []).filter(item => item.teamId === team.id).slice().reverse().map(message => h('section', { className: 'sc9-item', key: message.id },
            h('p', { className: 'sc9-note' }, names(message.authorId) + ' → ' + names(message.recipientId) + ' · ' + t(message.kind)),
            h(TextRecord, { value: message, t, sources: catalog.byId }),
            message.reportId && h('button', { onClick: () => navigation.detail('history', messageReportSource(state, message), message.reportId, message.reportVersion) }, t('referencedReport'))))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('alerts')), textList('alerts', (state.alerts ?? []).filter(item => item.teamId === team.id))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('wakeups')), h(DeliveryDetails, { team, t, names, model, controllerState }), ...(state.wakeups ?? []).filter(item => item.teamId === team.id).slice().reverse().map(wake =>
          h('p', { key: wake.id }, names(wake.sessionId) + ' · ' + String(wake.reason ?? '').replaceAll('-', ' ') + ' · ' + t('delivery' + wake.status) + (wake.error ? ' · ' + String(wake.error) : '')))),
        h('section', { className: 'sc9-card' }, h('h2', null, t('rosterHistory')), textList('objective', team.brief), textList('identity', team.identities), textList('responsibilities', team.responsibilities),
          h('details', null, h('summary', null, t('membership')), ...team.history.slice().reverse().map((entry, key) => h('section', { className: 'sc9-item', key }, h('h3', null, entry.title), h('p', null, entry.description), h('p', null, t('managerId') + ': ' + names(entry.managerId)), h('p', null, t('memberIds') + ': ' + entry.memberIds.map(names).join(', ')), h('p', null, t(entry.status))))), textList('comments', state.comments.filter(item => item.teamId === team.id))));
    }
    function WorkerSetup({ summary, t }) {
      const known = value => typeof value === 'string' && value.trim() ? value : t('unknown');
      const facts = [ ['presetLabel', summary?.preset?.title || summary?.preset?.id], ['workingDirectory', summary?.workingDirectory], ['workspaceBoundary', summary?.workspaceBoundary], ['sandboxLabel', summary?.sandbox?.mode], ['approvalLabel', summary?.approval?.policy], ['approvalChannel', summary?.approval?.availability] ];
      return h('section', null, h('h4', null, t('workerSetup')), ...facts.map(([label, value]) => h('p', { className: 'sc9-note', key: label }, t(label) + ': ' + known(value))),
        summary?.sandbox?.writableRoots?.length > 0 && h('p', { className: 'sc9-note' }, t('writableRoots') + ': ' + summary.sandbox.writableRoots.join(', ')),
        h('p', { className: 'sc9-note' }, t('registeredTools') + ': ' + (summary?.tools?.kind === 'registered' ? summary.tools.names.join(', ') || t('none') : t('unknown'))),
        summary?.tools?.truncated && h('p', { className: 'sc9-note' }, t('toolsTruncated')), h('p', { className: 'sc9-note' }, t('setupLimits')));
    }
    function Profile({ team, view, catalog, t, names, route, model, controllerState, nativeStatuses, coordination, stage, reopen }) {
      const state = view.state, objective = latest(team.brief), roster = [team.managerId, ...team.memberIds];
      if (route.view === 'history') {
        const history = controllerState.history, loaded = history?.teamId === team.id && history.view;
        return h(React.Fragment, null, h('header', { className: 'sc9-row' }, h('h2', null, t('detailsHistory')), h('button', { onClick: () => navigation.detail('profile') }, t('backTeam'))),
          history?.busy && h('p', { role: 'status' }, t('loadingHistory')),
          history?.error && h('section', { className: 'sc9-card sc9-error', role: 'alert' }, h('p', null, t('historyFailed')), h('button', { disabled: !controllerState.fresh, onClick: () => void model.loadHistory(team.id) }, t('refresh'))),
          loaded && h(History, { state: loaded.state, team: loaded.state.teams[0], t, catalog, names, route, model, controllerState }));
      }
      return h(React.Fragment, null,
        h('header', { className: 'sc9-row' }, h('div', null, h('h2', null, teamLabel(state.teams, team.id)), h('p', { className: 'sc9-note' }, team.description)),
          h('div', { className: 'sc9-actions' }, team.status === 'active'
            ? h(React.Fragment, null,
              h('button', { disabled: !controllerState.fresh || !!controllerState.busy || !!controllerState.pending, onClick: event => stage(prepareCommand('set-automation', { teamId: team.id, enabled: !team.automation }), event.currentTarget) }, t(team.automation ? 'pauseAutomation' : 'resumeAutomation')),
              h('button', { disabled: !controllerState.fresh || !!controllerState.busy || !!controllerState.pending, onClick: event => stage(prepareCommand('retire-team', { teamId: team.id }), event.currentTarget) }, t('retire')))
            : h('button', { disabled: !controllerState.fresh || !!controllerState.busy || !!controllerState.pending, onClick: () => reopen(team) }, t('reopenTeam')))),
        team.status === 'idle' && h('p', { className: 'sc9-note' }, t('retired')),
        h('section', { className: 'sc9-card sc9-objective' }, h('h3', null, t('objective')), objective ? h(TextRecord, { value: objective, t, sources: catalog.byId }) : h('p', { className: 'sc9-note' }, t('none')), objective?.exceptionalRules && h('details', null, h('summary', null, t('exceptionalRules')), h(TextRecord, { value: { ...objective, text: objective.exceptionalRules }, t, sources: catalog.byId }))),
        h('section', { className: 'sc9-members', 'aria-label': t('memberIds') }, ...roster.map(sessionId => {
          const member = memberProjection(state, team, sessionId, catalog, nativeStatuses?.get(sessionId), coordination?.ready && Object.hasOwn(coordination.statuses, sessionId) ? coordination.statuses[sessionId] : undefined), native = catalog.byId.get(sessionId);
          return h('article', { className: 'sc9-card', key: sessionId }, h('div', { className: 'sc9-row' }, h('h3', null, member.name), h('span', { className: 'sc9-badge', 'data-state': member.state }, h(StatusDot, { state: member.state, reason: member.reason, t }), ' ', t('visible' + member.state))),
            member.identity && h('p', { className: 'sc9-role' }, sessionId === team.managerId ? t('managerId') : member.identity),
            member.overall ? h(TextRecord, { value: member.overall, t, sources: catalog.byId }) : h('p', { className: 'sc9-overall' }, t('noOverall')),
            h('button', { onClick: () => ctx.uiWorkspace.openSession(sessionId), disabled: !native || native.missing || native.reason === 'archived' }, t('open')),
            h('details', null, h('summary', null, t('assignmentSetup')), h('h4', null, t('specificAssignment')),
              member.assignment ? h(TextRecord, { value: member.assignment, t, sources: catalog.byId }) : h('p', { className: 'sc9-note' }, t('none')),
              member.assignment?.waitingReason && h('p', { className: 'sc9-note' }, member.assignment.waitingReason), h(WorkerSetup, { summary: state.workerSetups?.[sessionId], t })));
        })),
        h('section', { className: 'sc9-card' }, h('h2', null, t('recentProposals')), ...recentProposals(state, team.id).map(proposal => h(Proposal, { key: proposal.id, proposal, t, catalog, names })), !recentProposals(state, team.id).length && h('p', { className: 'sc9-note' }, t('none'))),
        h(Reports, { state, team, t, catalog, names }),
        h('div', null, h('button', { onClick: () => navigation.detail('history') }, t('detailsHistory'))));
    }
    function OwnerForm({ view, model, state, sessions, workspaces, t, stage }) {
      const [setup, setSetup] = React.useState(() => model.getSetup() ?? setupFrom(null, view.state.revision));
      React.useEffect(() => { model.setSetup(setup); }, [setup]);
      const { teamId: editing, draft } = setup;
      const disabled = !!state.busy || !state.fresh || !!state.pending;
      const selectedIds = [...new Set([draft.managerId, ...draft.memberIds].filter(Boolean))];
      const catalog = buildCatalog(sessions, workspaces, selectedIds), uid = React.useId();
      React.useEffect(() => { if (state.fresh) setSetup(previous => refreshSetup(previous, view)); }, [view, state.fresh]);
      React.useEffect(() => {
        const commit = state.lastCommit; if (commit?.command.type !== 'save-team' || !model.claimSetupCommit(commit.serial)) return;
        const command = commit.command, saved = state.fresh && view.state.revision >= commit.revision ? view.state.teams.find(team => team.id === command.teamId) : null;
        setSetup(setupFrom(saved ?? { ...command, id: command.teamId }, saved ? view.state.revision : commit.revision));
      }, [state.lastCommit]);
      function change(key, value) { model.cancelStage(); setSetup(previous => changeSetup(previous, key, value)); }
      function choose(teamId) {
        const team = view.state.teams.find(team => team.id === teamId); model.cancelStage(); setSetup(setupFrom(team, view.state.revision));
      }
      function submit(event) {
        event.preventDefault();
        try {
          // New opaque ID is allocated once for this staged command, never typed by a human.
          const teamId = editing || 'team-' + crypto.randomUUID();
          stage(prepareCommand('save-team', { ...draft, teamId }), event.nativeEvent?.submitter);
        } catch { model.localError('INPUT_INVALID'); }
      }
      return h('section', { className: 'sc9-card' }, h('h2', { className: 'sc9-setup-heading' }, t('setup')),
        setup.stale && h('p', { className: 'sc9-note', role: 'status' }, t('draftStale')),
        h('form', { className: 'sc9-form', onSubmit: submit },
          h('label', { className: 'sc9-field' }, t('chooseTeam'), h('select', { disabled, value: editing, onChange: event => choose(event.target.value) }, h('option', { value: '' }, t('newTeam')), ...view.state.teams.map(team => h('option', { value: team.id, key: team.id }, teamLabel(view.state.teams, team.id) + (team.status === 'idle' ? ' · ' + t('retired') : ''))))),
          ...[['title', 'teamTitle', 200], ['description', 'description', 1000]].map(([key, label, maxLength]) => h('label', { className: 'sc9-field', key }, t(label), h('input', { value: draft[key], disabled, maxLength, required: key === 'title', onChange: event => change(key, event.target.value) }))),
          h(SessionPicker, { catalog, value: draft.managerId, onChange: value => change('managerId', value), label: t('manager'), disabled, t, name: uid + '-manager' }),
          h(SessionPicker, { catalog, excludedId: draft.managerId, value: draft.memberIds, multiple: true, onChange: value => change('memberIds', value), label: t('members'), disabled, t, name: uid + '-members' }),
          h('div', null, h('button', { type: 'submit', disabled: disabled || !catalog.ready || !draft.managerId }, t('previewButton')))),
        editing && view.state.teams.find(team => team.id === editing)?.status === 'active' && h('button', { disabled, onClick: event => stage(prepareCommand('retire-team', { teamId: editing }), event.currentTarget) }, t('retire')));
    }
    function Contents({ model, t, sessions, workspaces, nativeStatuses, coordination }) {
      const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), view = state.view;
      const route = React.useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
      const navigationError = React.useSyncExternalStore(resourceNavigator.subscribe, resourceNavigator.getSnapshot, resourceNavigator.getSnapshot);
      const preview = React.useRef(null), origin = React.useRef(null), feedback = React.useRef(null);
      const rosterIds = view ? [...new Set(view.state.teams.flatMap(team => [team.managerId, ...team.memberIds]))] : [];
      const catalog = buildCatalog(sessions, workspaces, rosterIds), busy = !!state.busy, disabled = busy || !state.fresh || !!state.pending;
      const names = sessionId => catalog.byId.get(sessionId)?.label ?? sessionId;
      const stage = (command, source) => { origin.current = source; model.stage(command); };
      const reopen = team => { model.cancelStage(); model.setSetup(setupFrom(team, view.state.revision)); navigation.setup(); };
      React.useEffect(() => { if (state.pending) { preview.current?.focus(); preview.current?.scrollIntoView({ block: 'nearest' }); } }, [state.pending]);
      React.useEffect(() => { if (!state.busy && (state.notice || state.error || navigationError)) feedback.current?.focus(); }, [state.notice, state.error, state.busy, navigationError]);
      const command = state.pending?.command, selectedTeam = view?.state.teams.find(team => team.id === route.teamId);
      React.useEffect(() => { if (state.lastCommit?.command.type === 'save-team') navigation.select(state.lastCommit.command.teamId); }, [state.lastCommit]);
      React.useEffect(() => {
        model.selectHistoryTeam(route.teamId && route.view === 'history' ? route.teamId : null);
        if (route.teamId && route.view === 'history' && state.fresh && !state.history) void model.loadHistory(route.teamId);
      }, [route.teamId, route.view, state.fresh, state.history]);
      function PreviewDetails() {
        if (command.type === 'save-team') {
          const previous = view.state.teams.find(team => team.id === command.teamId), delta = rosterDelta(previous, command);
          return h(React.Fragment, null, h('p', null, t(previous?.status === 'idle' ? 'reactivateAction' : 'saveAction') + ': ' + command.title),
            previous && h('p', { className: 'sc9-note' }, t('team') + ': ' + teamLabel(view.state.teams, previous.id)), h('p', null, command.description),
            h('p', null, t('managerId') + ': ' + names(command.managerId)),
            delta.previousManagerId && delta.previousManagerId !== delta.managerId && h('p', null, t('managerChange') + ': ' + names(delta.previousManagerId) + ' → ' + names(delta.managerId)),
            h('p', null, t('memberIds') + ': ' + (command.memberIds.map(names).join(', ') || t('none'))),
            h('p', null, t('added') + ': ' + (delta.added.map(names).join(', ') || t('none'))), h('p', null, t('removed') + ': ' + (delta.removed.map(names).join(', ') || t('none'))),
            previous?.status === 'idle' && h('p', { className: 'sc9-note' }, t('retired') + ' → ' + t('active')));
        }
        if (command.type === 'retire-team') return h(React.Fragment, null, h('p', null, t('retireAction') + ': ' + teamLabel(view.state.teams, command.teamId)), h('p', { className: 'sc9-note' }, t('retireExplanation')));
        if (command.type === 'set-automation') return h(React.Fragment, null, h('p', null, t(command.enabled ? 'resumeAutomation' : 'pauseAutomation') + ': ' + teamLabel(view.state.teams, command.teamId)), h('p', { className: 'sc9-note' }, t(command.enabled ? 'resumeExplanation' : 'pauseExplanation')));
        return h(React.Fragment, null, h('p', null, t('reviewAction')), ...view.state.teams.filter(team => team.status === 'active').map(team => h('div', { className: 'sc9-item', key: team.id }, h('h3', null, teamLabel(view.state.teams, team.id)), h('p', null, names(team.managerId) + ' → ' + team.memberIds.map(names).join(', ')), h(TextRecord, { value: latest(team.brief), t, sources: catalog.byId }), ...[team.managerId, ...team.memberIds].map(sessionId => h('section', { key: sessionId }, h('h4', null, names(sessionId)), h(TextRecord, { value: currentAssignment(view.state, team, sessionId), t, sources: catalog.byId }))))));
      }
      const teams = partitionTeams(view?.state.teams ?? []);
      const teamButton = team => h('button', { className: 'sc9-card sc9-team', key: team.id, onClick: () => navigation.select(team.id) }, h('h2', null, teamLabel(view.state.teams, team.id)), h('p', { className: 'sc9-note' }, team.description));
      return h('div', { className: 'sc9-body', 'aria-busy': busy },
        h('header', { className: 'sc9-row' }, h('h1', null, t('title')), h('div', { className: 'sc9-actions' }, route.teamId && h('button', { onClick: () => navigation.back() }, t('backTeams')), h('button', { disabled: busy, onClick: () => void model.load() }, t('refresh')), h('button', { onClick: () => ctx.layout.selectPanel(null) }, t('back')))),
        busy && h('p', { role: 'status', className: 'sc9-note' }, t('loading')),
        h('div', { ref: feedback, tabIndex: -1, role: 'region', 'aria-label': t('operationFeedback'), 'aria-live': 'polite' }, navigationError && h('section', { className: 'sc9-card sc9-error', role: 'alert' }, h('h2', null, t('referenceNavigationFailed')), h('p', null, navigationError.message), h('button', { onClick: () => resourceNavigator.dismiss() }, t('dismiss'))), state.notice && h('p', { className: 'sc9-success', role: 'status' }, t(state.notice)), state.error && h('section', { className: 'sc9-card sc9-error', role: 'alert' }, h('h2', null, t('error_' + state.error.phase)), h('p', null, t(EN[state.error.code] ? state.error.code : 'hostFailure')), !EN[state.error.code] && state.error.message && h('p', null, state.error.message.slice(0, 600)))),
        view && !state.fresh && !busy && h('p', { role: 'status', className: 'sc9-note' }, t('stale')),
        view?.state.reviewRequired && h('section', { className: 'sc9-card sc9-warning' }, h('h2', null, t('held')), h('p', { className: 'sc9-note' }, t('heldHelp'))),
        view && (selectedTeam ? h(Profile, { team: selectedTeam, view, catalog, t, names, route, model, controllerState: state, nativeStatuses, coordination, stage, reopen }) : h('section', { className: 'sc9-team-list', 'aria-label': t('teams') },
          !teams.active.length && h('p', { className: 'sc9-note' }, t(view.state.teams.length ? 'noActiveTeams' : 'noTeams')), ...teams.active.map(teamButton),
          teams.retired.length > 0 && h('details', { className: 'sc9-retired' }, h('summary', null, t('retiredTeams')), ...teams.retired.map(teamButton)))), 
        view?.state.reviewRequired && h('section', { className: 'sc9-card sc9-warning' }, h('label', { className: 'sc9-check' }, h('input', { type: 'checkbox', checked: state.acknowledged, disabled, onChange: event => model.acknowledge(event.target.checked) }), t('reviewAck')), h('button', { disabled: disabled || !state.acknowledged, onClick: event => { origin.current = event.currentTarget; model.confirm(); } }, t('reviewButton'))),
        view && !route.teamId && h('details', { className: 'sc9-setup', open: route.setupOpen || undefined }, h('summary', null, t('setup')), h(OwnerForm, { view, model, state, sessions, workspaces, t, stage })),
        command && h('section', { className: 'sc9-card sc9-warning', ref: preview, tabIndex: -1, role: 'region', 'aria-label': t('preview') }, h('h2', null, t('preview')), h(PreviewDetails), h('div', { className: 'sc9-actions' }, h('button', { className: 'sc9-primary', disabled: busy || !state.fresh, onClick: () => void model.apply() }, t(command.type === 'retire-team' ? 'retire' : command.type === 'set-automation' ? command.enabled ? 'resumeAutomation' : 'pauseAutomation' : 'apply')), h('button', { disabled: busy, onClick: () => { model.cancelStage(); if (origin.current?.isConnected) origin.current.focus(); } }, t('cancel')))));
    }

    function Panel(props) {
      const sessions = props.useSessions(state => state), workspaces = props.useWorkspaces(state => state), nativeStatuses = props.useSessionStatus(state => state), [model, setModel] = React.useState(null);
      const coordination = React.useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot);
      React.useEffect(() => {
        const controller = createController(transport); controllers.add(controller); setModel(controller); void controller.load();
        const off = ctx.on('connection/reset', () => { controller.invalidate(); void controller.load(); });
        return () => { off(); controller.dispose(); controllers.delete(controller); };
      }, []);
      return h('main', { className: 'sc9-page' }, h('style', null, CSS), model ? h(Contents, { model, t: props.t, sessions, workspaces, nativeStatuses, coordination }) : h('p', { role: 'status' }, props.t('loading')));
    }
    const t = ctx.locale.bind(NS);
    ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({ name: 'sidebar.session.row.trailing', id: PANEL + '-status', order: 30, locale: NS }, SidebarStatus));
    ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({ name: 'sidebar.session.row.hover', id: PANEL + '-status', order: 30, locale: NS }, SidebarStatusHover));
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: () => t('title') }, Icon));
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Panel));
  }
  return { inject: ['slots', 'locale', 'connection', 'layout', 'uiWorkspace', 'sidebarRight'], apply, currentDecision, historicalDecisions, visibleState, PRIMARY_STATES, STATE_COLORS, statusLabel, sidebarProjection, verifyStatuses, verifyDelivery, createStatusStore, partitionTeams, openIntervention, messageReportSource, currentAssignment, observedNative, memberProjection, recentProposals, createNavigation, shortSummary, createController, createTransport, workspaceTree, directSelection, toggleDirect, currentWorkerReports, exactReport, buildCatalog, prepareCommand, verifyView, reviewOf, setupFrom, changeSetup, refreshSetup, rosterDelta, teamLabel, latestReport, reportAnchor, nativeReference, markdownReferences, recordSource, createResourceNavigator, dictionaries: { en: EN, zh: ZH }, css: CSS };
});


