'use strict';
// Pure coordination ledger. No persistence, native imports, timers, or implicit execution.
const { z } = require('zod');
const { createHash } = require('node:crypto');
class CoordinationError extends Error { constructor(code, message) { super(message); this.name = 'CoordinationError'; this.code = code; } }
const fail = (code, message) => { throw new CoordinationError(code, message); };
const check = (condition, code, message) => { if (!condition) fail(code, message); };
const clone = value => JSON.parse(JSON.stringify(value));
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const tenureOf = (team, who) => Object.hasOwn(team.tenures, who) ? team.tenures[who] : 0;
const text = z.string().max(16000);
const nonempty = text.min(1);
const integer = z.number().int().nonnegative().safe();
const positive = integer.min(1);
const time = z.string().datetime({ offset: true });
const obj = shape => z.object(shape).strict();
const observation = obj({ availability: z.enum(['available', 'missing', 'unknown']), execution: z.enum(['idle', 'running', 'unloaded', 'unknown']), archived: z.boolean(), at: time });
const stamp = { generation: integer, authorId: id, at: time };
const work = { ...stamp, revision: positive, text };
const roster = obj({ id, tenure: positive });
const reportVersion = obj({ ...stamp, version: positive, assignmentRevision: integer, text: nonempty, status: z.enum(['progress', 'blocked', 'complete']) });
const label = z.string().trim().min(1).max(80);
const workStatus = z.enum(['ready', 'waiting', 'in-progress', 'complete']);
const identityChange = obj({ targetId: id, fromIdentityRevision: integer, identity: label });
const proposalRevision = obj({ ...work, concerned: z.array(roster), confirmed: z.boolean(), identityChange: identityChange.optional(), targetTenure: positive.optional() });
const statusEntry = obj({ ...stamp, workStatus, waitingReason: text });
const identityEntry = obj({ ...work, targetId: id, tenure: positive, proposalId: id.optional(), proposalRevision: positive.optional() });
const response = obj({ generation: integer, proposalRevision: positive, sessionId: id, tenure: positive, response: z.enum(['agree', 'conditional', 'object']), text, at: time });
const decision = obj({ ...stamp, proposalRevision: positive, outcome: z.enum(['accepted', 'escalated']), text });
const teamSchema = obj({ id, planVersion: positive, title: nonempty, description: text, managerId: id, memberIds: z.array(id), status: z.enum(['active', 'idle']), tenures: z.record(id, positive),
  identities: z.array(identityEntry).default([]),
  brief: z.array(obj({ ...work, exceptionalRules: text })), responsibilities: z.array(obj({ ...work, targetId: id })), assignments: z.array(obj({ ...work, version: positive, targetId: id, tenure: positive, status: z.enum(['current', 'needs-review']), workStatus: workStatus.default('ready'), waitingReason: text.default(''), statusHistory: z.array(statusEntry).default([]) })),
  history: z.array(obj({ ...stamp, revision: positive, title: nonempty, description: text, managerId: id, memberIds: z.array(id), status: z.enum(['active', 'idle']), roster: z.array(roster) })) });
const reportSchema = obj({ id, teamId: id, authorId: id, versions: z.array(reportVersion).min(1) });
const proposalSchema = obj({ id, teamId: id, kind: z.enum(['work', 'identity']).default('work'), origin: obj({ reportId: id.optional(), version: positive.optional(), authorId: id }), revisions: z.array(proposalRevision).min(1), responses: z.array(response), decisions: z.array(decision) });
const baseStateSchema = obj({ schemaVersion: z.literal(4), revision: integer, generation: integer, reviewRequired: z.boolean(),
  sessions: z.array(obj({ id, identity: text, identityHistory: z.array(obj({ ...work })), observation, acknowledgment: obj({ generation: integer, throughSequence: integer }) })),
  teams: z.array(teamSchema), reports: z.array(reportSchema), proposals: z.array(proposalSchema),
  comments: z.array(obj({ id, teamId: id, authorId: id, generation: integer, text: nonempty, proposalId: id.optional(), reportId: id.optional(), responseNeededBy: z.array(id).default([]), at: time })),
  attention: z.array(obj({ sequence: positive, generation: integer, recipientId: id, teamId: id, kind: z.enum(['work', 'roster', 'report', 'proposal', 'comment', 'discussion']), text, at: time, sourceId: id.optional(), reportId: id.optional(), reportVersion: positive.optional(), proposalId: id.optional(), proposalRevision: positive.optional() })),  nextSequence: positive });
const unique = values => new Set(values).size === values.length;
const currentIds = team => [team.managerId, ...team.memberIds];
const activeMember = (team, who) => team.status === 'active' && currentIds(team).includes(who);
const latest = values => values[values.length - 1];
function structural(s) {
  const need = (ok, message) => check(ok, 'INVALID_STATE', message);
  need(unique(s.sessions.map(x => x.id)) && unique(s.teams.map(x => x.id)), 'Duplicate session/team IDs.');
  need(unique(s.reports.map(x => `${x.teamId}\0${x.id}`)) && unique(s.proposals.map(x => `${x.teamId}\0${x.id}`)) && unique(s.comments.map(x => x.id)), 'Duplicate record IDs.');
  const sessions = new Map(s.sessions.map(x => [x.id, x])); const teams = new Map(s.teams.map(x => [x.id, x]));
  const historyMember = (team, who, tenure) => team.history.some(h => h.roster.some(r => r.id === who && (tenure === undefined || r.tenure === tenure)));
  const chronological = (items, key) => items.every((x, i) => x[key] === i + 1 && (i === 0 || items[i - 1].generation <= x.generation));
  const generationOK = values => values.every(x => x.generation <= s.generation);
  const parent = new Map();
  for (const t of s.teams) {
    need(unique(currentIds(t)) && currentIds(t).every(x => sessions.has(x)), 'Invalid roster.');
    need(Object.keys(t.tenures).every(x => sessions.has(x)) && currentIds(t).every(x => t.tenures[x] > 0), 'Invalid tenure.');
    need(t.history.length > 0 && chronological(t.history, 'revision'), 'Invalid team history.');
    need(generationOK([...t.history, ...t.brief, ...t.assignments, ...t.responsibilities]), 'Future work generation.');
    for (const h of t.history) need(unique([h.managerId, ...h.memberIds]) && unique(h.roster.map(x => x.id)) && h.roster.length === h.memberIds.length + 1 && h.roster.every(r => sessions.has(r.id) && [h.managerId, ...h.memberIds].includes(r.id) && r.tenure <= t.tenures[r.id]), 'Invalid historical roster.');
    const knownTenures = new Map();
    for (let index = 0; index < t.history.length; index++) {
      const entry = t.history[index]; const previous = t.history[index - 1];
      need(['owner', 'host'].includes(entry.authorId), 'Invalid roster authority.');
      for (const member of entry.roster) {
        const wasPresent = previous && previous.status === 'active' && previous.roster.some(r => r.id === member.id);
        const changedRole = previous && previous.managerId !== entry.managerId && [previous.managerId, entry.managerId].includes(member.id);
        const expectedTenure = !knownTenures.has(member.id) ? 1 : entry.status === 'active' && (!wasPresent || changedRole) ? knownTenures.get(member.id) + 1 : knownTenures.get(member.id);
        need(member.tenure === expectedTenure, 'Nonmonotonic membership tenure history.'); knownTenures.set(member.id, member.tenure);
      }
    }
    need(Object.keys(t.tenures).length === knownTenures.size && [...knownTenures].every(([who, tenure]) => tenureOf(t, who) === tenure), 'Tenure map/history mismatch.');
    const h = latest(t.history);
    need(h.title === t.title && h.description === t.description && h.managerId === t.managerId && JSON.stringify(h.memberIds) === JSON.stringify(t.memberIds) && h.status === t.status && h.roster.every(r => t.tenures[r.id] === r.tenure), 'Roster/history mismatch.');
    for (const list of [t.brief, t.responsibilities, t.assignments]) {
      need(chronological(list, 'revision'), 'Invalid work revisions.');
      for (const w of list) need(t.history.some(hh => hh.managerId === w.authorId) && (!w.targetId || historyMember(t, w.targetId, w.tenure)), 'Invalid work attribution.');
    }
    need(chronological(t.identities, 'revision') && generationOK(t.identities), 'Invalid identity history.');
    for (const i of t.identities) {
      need(historyMember(t, i.targetId, i.tenure) && t.history.some(h => h.managerId === i.authorId && i.authorId !== i.targetId && h.roster.some(r => r.id === i.targetId && r.tenure === i.tenure)) && label.safeParse(i.text).success, 'Invalid identity attribution.');
      const prior = t.identities.filter(x => x.targetId === i.targetId && x.tenure === i.tenure && x.revision < i.revision);
      if (prior.length) need(!!i.proposalId && !!i.proposalRevision, 'Identity changes require accepted proposal.');
      if (i.proposalId) { const p = s.proposals.find(p => p.teamId === t.id && p.id === i.proposalId); const v = p?.revisions.find(v => v.revision === i.proposalRevision); need(p?.kind === 'identity' && v?.identityChange?.targetId === i.targetId && v.identityChange.identity === i.text && v.targetTenure === i.tenure && v.identityChange.fromIdentityRevision === (latest(prior)?.revision || 0) && p.decisions.some(d => d.proposalRevision === i.proposalRevision && d.outcome === 'accepted'), 'Invalid applied identity proposal.'); }
    }
    for (const a of t.assignments) { need(a.version >= Math.max(1, a.statusHistory.length), 'Assignment version predates status history.'); need(generationOK(a.statusHistory) && a.statusHistory.every(h => h.generation >= a.generation && historyMember(t, h.authorId) && (h.authorId === a.targetId || t.history.some(x => x.managerId === h.authorId)) && (h.workStatus !== 'waiting' || !!h.waitingReason.trim())), 'Invalid assignment status history.'); const h = latest(a.statusHistory); if (h) need(h.workStatus === a.workStatus && h.waitingReason === a.waitingReason, 'Assignment status/history mismatch.'); need(a.workStatus !== 'waiting' || !!a.waitingReason.trim(), 'Waiting requires reason.'); }
    need(unique(t.assignments.filter(a => a.status === 'current').map(a => a.targetId)), 'Duplicate current assignments.');
    for (const a of t.assignments) if (a.status === 'current') need(t.status === 'active' && a.authorId === t.managerId && a.generation === s.generation && activeMember(t, a.targetId) && a.tenure === tenureOf(t, a.targetId), 'Stale current assignment.');
    if (t.status === 'active') {
      need(currentIds(t).every(x => !sessions.get(x).observation.archived), 'Archived active member.');
      for (const worker of t.memberIds) { need(!parent.has(worker), 'Multiple upstream memberships.'); parent.set(worker, t.managerId); }
    }
  }
  for (const who of parent.keys()) { const seen = new Set(); let cursor = who; while (parent.has(cursor)) { need(!seen.has(cursor), 'Coordination cycle.'); seen.add(cursor); cursor = parent.get(cursor); } }
  for (const r of s.reports) {
    const t = teams.get(r.teamId); need(t && historyMember(t, r.authorId), 'Invalid report author.');
    need(chronological(r.versions, 'version') && generationOK(r.versions) && r.versions.every(v => v.authorId === r.authorId && (v.assignmentRevision === 0 || t.assignments.some(a => a.revision === v.assignmentRevision && a.targetId === r.authorId && a.generation <= v.generation))), 'Invalid report versions/assignment reference.');
  }
  for (const p of s.proposals) {
    const t = teams.get(p.teamId); const r = s.reports.find(r => r.teamId === p.teamId && r.id === p.origin.reportId);
    need(t && historyMember(t, p.origin.authorId), 'Invalid proposal originator.');
    if (p.kind === 'work') need(r && r.authorId === p.origin.authorId && r.versions.some(v => v.version === p.origin.version), 'Invalid exact proposal report reference.');
    else need((!p.origin.reportId && !p.origin.version) || (r && r.authorId === p.origin.authorId && r.versions.some(v => v.version === p.origin.version)), 'Invalid identity origin report.');
    need(chronological(p.revisions, 'revision') && generationOK([...p.revisions, ...p.responses, ...p.decisions]), 'Invalid proposal revisions/generations.');
    need(!p.revisions[0].confirmed && p.revisions[0].concerned.length === 0 && p.revisions[0].authorId === p.origin.authorId && (p.kind === 'identity' || r.versions[p.origin.version - 1].generation <= p.revisions[0].generation) && p.revisions.slice(1).every(v => v.confirmed), 'Invalid proposal origin/confirmation history.');
    for (const v of p.revisions) {
      if (p.kind === 'identity') { const i = v.identityChange; const first = p.revisions[0]; need(v.text.trim().length > 0 && i && first.identityChange && i.targetId === first.identityChange.targetId && i.fromIdentityRevision === first.identityChange.fromIdentityRevision && v.targetTenure === first.targetTenure, 'Identity revision changed origin target/base.'); need(i && v.targetTenure && historyMember(t, i.targetId, v.targetTenure) && i.fromIdentityRevision === (latest(t.identities.filter(x => x.targetId === i.targetId && x.tenure === v.targetTenure && x.revision <= i.fromIdentityRevision))?.revision || 0) && (!v.confirmed || (i.targetId !== v.authorId && v.concerned.some(c => c.id === i.targetId && c.tenure === v.targetTenure))), 'Invalid typed identity revision.'); }
      else need(!v.identityChange && !v.targetTenure, 'Work proposal has identity payload.');
      const confirmedRoster = v.concerned.some(c => c.id === v.authorId) && v.concerned.some(c => c.id === p.origin.authorId) && t.history.some(h => h.managerId === v.authorId && v.concerned.every(c => h.roster.some(r => r.id === c.id && r.tenure === c.tenure)));
      need(unique(v.concerned.map(c => c.id)) && v.concerned.every(c => historyMember(t, c.id, c.tenure)) && (!v.confirmed || confirmedRoster), 'Invalid concerned parties or confirmation.');
    }
    for (const v of p.responses) { const rev = p.revisions[v.proposalRevision - 1]; need(rev && rev.confirmed && rev.generation === v.generation && rev.concerned.some(c => c.id === v.sessionId && c.tenure === v.tenure), 'Invalid response reference.'); }
    need(unique(p.decisions.map(d => d.proposalRevision)), 'Duplicate proposal decision.');
    for (const d of p.decisions) {
      const rev = p.revisions[d.proposalRevision - 1]; need(rev && rev.confirmed && rev.generation === d.generation && (d.outcome === 'accepted' ? rev.authorId === d.authorId : t.history.some(h => h.managerId === d.authorId)), 'Invalid decision reference.');
      if (d.outcome === 'accepted' && p.kind === 'identity') need(t.identities.some(i => i.proposalId === p.id && i.proposalRevision === rev.revision && i.targetId === rev.identityChange.targetId && i.tenure === rev.targetTenure && i.text === rev.identityChange.identity && i.generation === d.generation && i.authorId === d.authorId && i.at === d.at), 'Accepted identity missing applied history.');
      if (d.outcome === 'accepted') need(rev.concerned.every(c => { const vote = latest(p.responses.filter(v => v.proposalRevision === rev.revision && v.generation === rev.generation && v.sessionId === c.id && v.tenure === c.tenure)); return vote && vote.response === 'agree'; }), 'Accepted without unanimous exact votes.');
    }
  }
  for (const c of s.comments) { const t = teams.get(c.teamId); need(t && historyMember(t, c.authorId) && !(c.reportId && c.proposalId) && c.generation <= s.generation && unique(c.responseNeededBy) && t.history.some(h => h.roster.some(r => r.id === c.authorId) && c.responseNeededBy.every(who => h.roster.some(r => r.id === who))), 'Invalid comment author/response recipients.'); if (c.reportId) need(s.reports.some(r => r.teamId === c.teamId && r.id === c.reportId), 'Invalid comment report.'); if (c.proposalId) need(s.proposals.some(p => p.teamId === c.teamId && p.id === c.proposalId), 'Invalid comment proposal.'); }
  need(s.nextSequence === s.attention.length + 1 && s.revision >= s.generation, 'Invalid ledger counters.');
  let previous = 0;
  for (const e of s.attention) { need(e.sequence === previous + 1 && e.sequence < s.nextSequence && e.generation <= s.generation && sessions.has(e.recipientId) && teams.has(e.teamId) && historyMember(teams.get(e.teamId), e.recipientId), 'Invalid attention sequence/reference.'); if (e.sourceId) need(historyMember(teams.get(e.teamId), e.sourceId), 'Invalid attention source.'); if (e.reportId || e.reportVersion) need(e.reportId && e.reportVersion && s.reports.some(r => r.teamId === e.teamId && r.id === e.reportId && r.versions.some(v => v.version === e.reportVersion && v.generation <= e.generation)), 'Invalid attention report ref.'); if (e.proposalId || e.proposalRevision) need(e.proposalId && e.proposalRevision && s.proposals.some(p => p.teamId === e.teamId && p.id === e.proposalId && p.revisions.some(v => v.revision === e.proposalRevision && v.generation <= e.generation)), 'Invalid attention proposal ref.'); previous = e.sequence; }
  for (const person of s.sessions) {
    need(person.acknowledgment.generation <= s.generation && person.acknowledgment.throughSequence < s.nextSequence && chronological(person.identityHistory, 'revision') && generationOK(person.identityHistory) && person.identityHistory.every(h => h.authorId === person.id), 'Invalid session history/ack.');
    need(person.identity === (latest(person.identityHistory)?.text || ''), 'Identity/history mismatch.');
    if (person.acknowledgment.throughSequence > 0) need(s.attention.some(e => e.recipientId === person.id && e.generation === person.acknowledgment.generation && e.sequence === person.acknowledgment.throughSequence), 'Ack not recipient sequence.');
  }
}
const stateSchema = baseStateSchema.superRefine((s, ctx) => { try { structural(s); } catch (e) { ctx.addIssue({ code: 'custom', message: e.message }); } });
const command = (type, fields = {}, revision = true) => obj({ type: z.literal(type), ...(revision ? { expectedRevision: integer } : {}), ...fields });
const ownerCommandSchema = z.discriminatedUnion('type', [command('save-team', { teamId: id, title: nonempty, description: text, managerId: id, memberIds: z.array(id) }), command('retire-team', { teamId: id }), command('review-startup', { expectedGeneration: integer, reviewToken: z.string().length(64) })]);
const proposalFields = { teamId: id, proposalId: id, proposalRevision: positive };
const agentCommand = (type, fields) => command(type, fields, false);
const assignmentGuard = obj({ assignmentRevision: positive, assignmentVersion: positive });
const agentCommandSchema = z.discriminatedUnion('type', [
  agentCommand('update-work', { teamId: id, expectedPlanVersion: positive, objective: text.optional(), exceptionalRules: text.optional(), identities: z.array(obj({ targetId: id, identity: label })).default([]), responsibilities: z.array(obj({ targetId: id, text })).default([]), assignments: z.array(obj({ targetId: id, text, expectedAssignment: assignmentGuard.nullable(), workStatus: z.enum(['ready', 'waiting']).optional(), waitingReason: text.optional() })).default([]), statuses: z.array(obj({ targetId: id, assignmentRevision: positive, assignmentVersion: positive, workStatus, waitingReason: text.optional() })).default([]), acknowledge: obj({ generation: integer, throughSequence: integer }).optional() }),
  agentCommand('set-objective', { teamId: id, expectedPlanVersion: positive, text: z.string().trim().min(1).max(500) }),
  agentCommand('set-work-status', { teamId: id, assignmentRevision: positive, assignmentVersion: positive, workStatus: z.enum(['ready', 'waiting', 'in-progress']), waitingReason: text.optional() }),
  agentCommand('finish-assignment', { teamId: id, assignmentRevision: positive, assignmentVersion: positive, reportId: id, text: nonempty, expectedReportVersion: positive.optional() }),
  agentCommand('propose-identity', { teamId: id, proposalId: id, targetId: id, identity: label, text: nonempty }),
  agentCommand('report', { teamId: id, reportId: id, text: nonempty, status: z.enum(['progress', 'blocked', 'complete']), assignmentRevision: integer.optional() }),
  agentCommand('correct-report', { teamId: id, reportId: id, expectedReportVersion: positive, text: nonempty, status: z.enum(['progress', 'blocked', 'complete']), assignmentRevision: integer.optional() }),
  agentCommand('comment', { teamId: id, text: nonempty, proposalId: id.optional(), reportId: id.optional(), responseNeededBy: z.array(id).default([]) }),
  agentCommand('propose', { teamId: id, proposalId: id, reportId: id, reportVersion: positive, text: nonempty }),
  agentCommand('revise-proposal', { ...proposalFields, text: nonempty, concernedIds: z.array(id).min(1), identity: label.optional() }),
  agentCommand('respond-proposal', { ...proposalFields, response: z.enum(['agree', 'conditional', 'object']), text: text.optional() }),
  agentCommand('accept-proposal', proposalFields), agentCommand('escalate-proposal', { ...proposalFields, text: nonempty }), agentCommand('acknowledge', { generation: integer, throughSequence: integer })
]);
const hostCommandSchema = command('observe', { observations: z.array(obj({ sessionId: id, availability: observation.shape.availability, execution: observation.shape.execution, archived: z.boolean() })) }, false);
const querySchema = z.discriminatedUnion('type', [obj({ type: z.literal('snapshot') }), obj({ type: z.literal('export') }), obj({ type: z.literal('history'), teamId: id }), obj({ type: z.literal('my-teams') }), obj({ type: z.literal('profile'), teamId: id.optional() }), obj({ type: z.literal('own-record') }), obj({ type: z.literal('report'), teamId: id, sessionId: id, reportId: id, version: positive.optional() }), obj({ type: z.literal('inbox') }), obj({ type: z.literal('updates') }), obj({ type: z.literal('proposal'), teamId: id, proposalId: id })]);
function parse(schema, value) { const parsed = schema.safeParse(value); if (!parsed.success) fail('INVALID', parsed.error.message); return parsed.data; }
function validateState(state) { const parsed = stateSchema.safeParse(state); if (!parsed.success) fail('INVALID_STATE', parsed.error.message); return clone(parsed.data); }
function upgradeV3(state) { const s = require('./legacy-v3.cjs').validateState(state); s.schemaVersion = 4; for (const t of s.teams) { t.planVersion = 1; for (const a of t.assignments) a.version = Math.max(1, a.statusHistory.length); } return validateState(s); }
function upgradeV2(state) { return upgradeV3(require('./legacy-v3.cjs').upgradeV2(state)); }
function initialState() { return { schemaVersion: 4, revision: 0, generation: 0, reviewRequired: false, sessions: [], teams: [], reports: [], proposals: [], comments: [], attention: [], nextSequence: 1 }; }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'; return JSON.stringify(value); }
function token(state) { return createHash('sha256').update(canonical(validateState(state))).digest('hex'); }
function start(state, nowISO) { parse(time, nowISO); const s = validateState(state); s.generation++; s.revision++; s.reviewRequired = s.teams.some(t => t.status === 'active'); for (const t of s.teams) { t.planVersion++; for (const a of t.assignments) if (a.status === 'current') { a.status = 'needs-review'; a.version++; } } return validateState(s); }
function actorCheck(actor) { return parse(z.discriminatedUnion('kind', [obj({ kind: z.literal('owner') }), obj({ kind: z.literal('session'), id }), obj({ kind: z.literal('host') })]), actor); }
function teamFor(s, teamId, actor, active = true) { const t = s.teams.find(t => t.id === teamId); check(t, 'NOT_FOUND', 'Unknown team.'); check(actor.kind === 'owner' || (actor.kind === 'session' && activeMember(t, actor.id)), 'FORBIDDEN', 'Current immediate team membership required.'); if (active) check(t.status === 'active', 'INACTIVE', 'Team is retired.'); return t; }
function notify(s, t, kind, message, at, except, refs = {}) { for (const recipientId of currentIds(t)) if (recipientId !== except) s.attention.push({ sequence: s.nextSequence++, generation: s.generation, recipientId, teamId: t.id, kind, text: message, at, ...refs }); }
const currentAssignment = (s, t, who) => latest(t.assignments.filter(a => a.targetId === who && a.status === 'current' && a.generation === s.generation && a.tenure === tenureOf(t, who)));
const currentIdentity = (t, who) => latest(t.identities.filter(i => i.targetId === who && i.tenure === tenureOf(t, who)));
function visibleState(observed, assignment) { if (observed?.observation) { assignment = assignment || observed.assignment || observed.currentAssignment; observed = observed.observation; } if (!observed || observed.archived || observed.availability !== 'available') return 'Unavailable'; if (observed.execution === 'running') return 'Running'; if (assignment?.status === 'current' && assignment.workStatus === 'waiting') return 'Waiting'; if (assignment?.status === 'current' && assignment.workStatus === 'complete') return 'Complete'; return 'Idle'; }
function setStatus(s, a, authorId, workStatus, waitingReason, at) { const reason = waitingReason || ''; check(workStatus !== 'waiting' || !!reason.trim(), 'INVALID', 'Waiting requires a reason.'); if (a.workStatus === workStatus && a.waitingReason === reason) return false; if (a.workStatus !== undefined) a.version++; a.workStatus = workStatus; a.waitingReason = reason; a.statusHistory.push({ generation: s.generation, authorId, at, workStatus, waitingReason: reason }); }
function acknowledge(s, person, c) { const box = inbox(s, person.id); check(c.generation === s.generation, 'STALE_GENERATION', 'Acknowledgment generation is stale.'); check(c.throughSequence <= box.latestSequence && (c.throughSequence === 0 || s.attention.some(e => e.sequence === c.throughSequence && e.recipientId === person.id && e.generation === s.generation)), 'INVALID_ACK', 'Use your retrieved inbox sequence.'); person.acknowledgment = { generation: s.generation, throughSequence: Math.max(box.acknowledgedThrough, c.throughSequence) }; }
function teamHistory(t, s, authorId, at) { t.history.push({ generation: s.generation, authorId, at, revision: t.history.length + 1, title: t.title, description: t.description, managerId: t.managerId, memberIds: [...t.memberIds], status: t.status, roster: currentIds(t).map(who => ({ id: who, tenure: t.tenures[who] })) }); }
function invalidate(t, previous, generation) { for (const a of t.assignments) if (a.status === 'current' && (t.status !== 'active' || a.generation !== generation || !activeMember(t, a.targetId) || a.tenure !== t.tenures[a.targetId] || previous.managerId !== t.managerId)) { a.status = 'needs-review'; a.version++; } }
function inbox(s, who) { const person = s.sessions.find(x => x.id === who); check(person, 'FORBIDDEN', 'Unknown session.'); const events = s.attention.filter(e => e.recipientId === who && e.generation === s.generation); const acknowledgedThrough = person.acknowledgment.generation === s.generation ? person.acknowledgment.throughSequence : 0; const pending = events.filter(e => e.sequence > acknowledgedThrough); return { latestSequence: latest(events)?.sequence || 0, acknowledgedThrough, events: pending.filter(e => e.kind !== 'comment'), routineCommentCount: pending.filter(e => e.kind === 'comment').length }; }
function transition(state, actor, commandValue, nowISO) {
  actor = actorCheck(actor); const c = parse(actor.kind === 'owner' ? ownerCommandSchema : actor.kind === 'host' ? hostCommandSchema : agentCommandSchema, commandValue); parse(time, nowISO);
  const s = validateState(state); const at = nowISO; let extra = {};
  if (actor.kind === 'owner') check(c.expectedRevision === s.revision, 'STALE', 'Refresh current owner snapshot before writing.');
  if (c.type === 'review-startup') {
    check(s.reviewRequired && c.expectedGeneration === s.generation && c.reviewToken === token(s), 'STALE_REVIEW', 'Review exact current startup snapshot.'); s.reviewRequired = false;
  } else if (c.type === 'observe') {
    check(unique(c.observations.map(o => o.sessionId)), 'INVALID', 'Duplicate observations.');
    let changed = false;
    for (const o of c.observations) { const person = s.sessions.find(x => x.id === o.sessionId); if (!person || person.observation.archived === o.archived) continue; changed = true; person.observation = { ...person.observation, archived: o.archived, at }; if (!o.archived) continue;
      for (const t of s.teams.filter(t => activeMember(t, person.id))) { const previous = clone(t); if (t.managerId === person.id) t.status = 'idle'; else t.memberIds = t.memberIds.filter(x => x !== person.id); t.planVersion++; invalidate(t, previous, s.generation); teamHistory(t, s, 'host', at); notify(s, t, 'roster', 'Native archive changed team membership; retained records need review.', at); }
    }
    if (!changed) return { state: s, result: { revision: s.revision, generation: s.generation } };
  } else {
    check(!s.reviewRequired || actor.kind === 'owner' || ['acknowledge', 'report', 'correct-report'].includes(c.type), 'REVIEW_REQUIRED', 'Owner startup review required; old work is not resumed.');
    if (c.type === 'save-team') {
      check(unique([c.managerId, ...c.memberIds]), 'INVALID_TOPOLOGY', 'Manager and members must be distinct.');
      for (const who of [c.managerId, ...c.memberIds]) { let person = s.sessions.find(x => x.id === who); if (!person) { person = { id: who, identity: '', identityHistory: [], observation: { availability: 'unknown', execution: 'unknown', archived: false, at }, acknowledgment: { generation: s.generation, throughSequence: 0 } }; s.sessions.push(person); } check(!person.observation.archived, 'ARCHIVED', 'Archived sessions cannot join.'); }
      let t = s.teams.find(t => t.id === c.teamId); const previous = t ? clone(t) : null;
      if (!t) { t = { id: c.teamId, planVersion: 1, title: c.title, description: c.description, managerId: c.managerId, memberIds: [], status: 'idle', tenures: {}, identities: [], brief: [], responsibilities: [], assignments: [], history: [] }; s.teams.push(t); }
      const oldMembers = previous?.status === 'active' ? currentIds(previous) : [];
      for (const who of [c.managerId, ...c.memberIds]) if (!oldMembers.includes(who) || (previous && previous.managerId !== c.managerId && [previous.managerId, c.managerId].includes(who))) t.tenures[who] = tenureOf(t, who) + 1;
      Object.assign(t, { title: c.title, description: c.description, managerId: c.managerId, memberIds: [...c.memberIds], status: 'active' });
      if (previous) t.planVersion++; invalidate(t, previous || t, s.generation); teamHistory(t, s, 'owner', at); notify(s, t, 'roster', 'Owner saved team membership or description.', at); extra = { teamId: t.id };
    } else if (c.type === 'retire-team') { const t = teamFor(s, c.teamId, actor); const previous = clone(t); notify(s, t, 'roster', 'Owner retired team; previous work must not continue.', at); t.status = 'idle'; t.planVersion++; invalidate(t, previous, s.generation); teamHistory(t, s, 'owner', at);
    } else {
      check(actor.kind === 'session', 'FORBIDDEN', 'Session operation required.'); const person = s.sessions.find(x => x.id === actor.id); check(person && !person.observation.archived, 'FORBIDDEN', 'Known unarchived session required.');
      if (c.type === 'acknowledge') { acknowledge(s, person, c);
      } else {
        const t = teamFor(s, c.teamId, actor); const manager = () => check(t.managerId === actor.id, 'FORBIDDEN', 'Team manager operation.'); const makeWork = list => ({ generation: s.generation, authorId: actor.id, at, revision: list.length + 1, text: c.text });
        const workEntry = (list, value) => ({ generation: s.generation, authorId: actor.id, at, revision: list.length + 1, text: value });
        const assignmentFor = (who, revision, version) => { const a = currentAssignment(s, t, who); check(a && a.revision === revision && a.version === version, 'STALE_ASSIGNMENT', 'Use exact current generation/tenure assignment revision and version.'); return a; };
        const planCheck = () => check(c.expectedPlanVersion === t.planVersion, 'STALE_PLAN', 'Use exact current team planVersion.');
        if (c.type === 'update-work') {
          manager(); planCheck(); let changed = false;
          for (const list of [c.identities, c.responsibilities, c.assignments, c.statuses]) { check(unique(list.map(x => x.targetId)), 'INVALID', 'Duplicate targets within update field.'); for (const x of list) check(activeMember(t, x.targetId), 'NOT_MEMBER', 'Target must be a current teammate.'); }
          check(!c.assignments.some(a => c.statuses.some(x => x.targetId === a.targetId)), 'INVALID', 'Cannot replace and change status of the same assignment.');
          if (c.acknowledge) acknowledge(s, person, c.acknowledge);
          if (c.objective !== undefined || c.exceptionalRules !== undefined) { const prev = latest(t.brief); const value = c.objective ?? prev?.text ?? ''; check(c.objective === undefined || !prev?.text.trim() || c.objective === prev.text, 'OBJECTIVE_CHANGE_EXPLICIT', 'Use set-objective to deliberately change an existing objective.'); check(c.objective === undefined || c.objective === prev?.text || c.objective.length <= 500, 'INVALID', 'New objective must be at most 500 characters; retain legacy long text unchanged.'); const rules = c.exceptionalRules ?? prev?.exceptionalRules ?? ''; if (!prev || prev.text !== value || prev.exceptionalRules !== rules) { t.brief.push({ ...workEntry(t.brief, value), exceptionalRules: rules }); changed = true; } }
          for (const x of c.identities) { if (x.targetId === t.managerId) { check(x.identity === 'Manager', 'INVALID_IDENTITY', 'Manager identity is derived.'); continue; } const prev = currentIdentity(t, x.targetId); check(!prev || prev.text === x.identity, 'IDENTITY_PROPOSAL_REQUIRED', 'Existing identity changes require unanimous proposal.'); if (!prev) { t.identities.push({ ...workEntry(t.identities, x.identity), targetId: x.targetId, tenure: tenureOf(t, x.targetId) }); changed = true; } }
          for (const x of c.responsibilities) { if (latest(t.responsibilities.filter(r => r.targetId === x.targetId))?.text === x.text) continue; t.responsibilities.push({ ...workEntry(t.responsibilities, x.text), targetId: x.targetId }); changed = true; }
          for (const x of c.assignments) { const previous = currentAssignment(s, t, x.targetId); check(x.expectedAssignment === null ? !previous : previous && previous.revision === x.expectedAssignment.assignmentRevision && previous.version === x.expectedAssignment.assignmentVersion, 'STALE_ASSIGNMENT', 'Replacement requires exact current assignment revision/version, or null when none is current.'); if (previous) { previous.status = 'needs-review'; previous.version++; } const a = { ...workEntry(t.assignments, x.text), version: 1, targetId: x.targetId, tenure: tenureOf(t, x.targetId), status: 'current', statusHistory: [] }; setStatus(s, a, actor.id, x.workStatus || 'ready', x.waitingReason, at); t.assignments.push(a); changed = true; }
          for (const x of c.statuses) { const a = assignmentFor(x.targetId, x.assignmentRevision, x.assignmentVersion); if (a.workStatus !== x.workStatus || a.waitingReason !== (x.waitingReason || '')) { setStatus(s, a, actor.id, x.workStatus, x.waitingReason, at); changed = true; } }
          check(changed || (c.acknowledge && JSON.stringify(person.acknowledgment) !== JSON.stringify(state.sessions.find(x => x.id === actor.id).acknowledgment)), 'NO_CHANGE', 'Empty or ineffective update.');
          if (changed) { t.planVersion++; notify(s, t, 'work', 'Manager updated team objective, identities or work; retrieve current profile.', at, actor.id); }
          extra = { planVersion: t.planVersion, assignments: c.assignments.concat(c.statuses).map(x => { const a = currentAssignment(s, t, x.targetId); return { targetId: x.targetId, assignmentRevision: a.revision, assignmentVersion: a.version, newAssignmentVersion: a.version }; }) };
        } else if (c.type === 'set-objective') {
          manager(); planCheck(); const previous = latest(t.brief); check(previous?.text !== c.text, 'NO_CHANGE', 'Objective is unchanged.'); t.brief.push({ ...workEntry(t.brief, c.text), exceptionalRules: previous?.exceptionalRules || '' }); t.planVersion++; notify(s, t, 'work', 'Manager deliberately changed team objective.', at, actor.id); extra = { planVersion: t.planVersion };
        } else if (c.type === 'set-work-status' || c.type === 'finish-assignment') {
          const a = assignmentFor(actor.id, c.assignmentRevision, c.assignmentVersion);
          if (c.type === 'set-work-status') { check(a.workStatus !== 'complete', 'ASSIGNMENT_COMPLETE', 'Manager must reopen completed work.'); setStatus(s, a, actor.id, c.workStatus, c.waitingReason, at); notify(s, t, 'work', `${actor.id} updated assignment work status.`, at, actor.id); }
          else { check(a.workStatus !== 'complete', 'ASSIGNMENT_COMPLETE', 'Assignment already complete.'); let r = s.reports.find(r => r.teamId === t.id && r.id === c.reportId); if (r) { check(r.authorId === actor.id, 'FORBIDDEN', 'Only your own report may be appended.'); check(c.expectedReportVersion === latest(r.versions).version, 'STALE_REPORT', 'Appending an existing report requires exact expectedReportVersion.'); } else { check(c.expectedReportVersion === undefined, 'STALE_REPORT', 'New report must not assert an existing version.'); r = { id: c.reportId, teamId: t.id, authorId: actor.id, versions: [] }; s.reports.push(r); } r.versions.push({ generation: s.generation, authorId: actor.id, at, version: r.versions.length + 1, assignmentRevision: a.revision, text: c.text, status: 'complete' }); setStatus(s, a, actor.id, 'complete', '', at); notify(s, t, 'report', `${actor.id} completed assigned work: ${c.text.slice(0, 400)}`, at, actor.id, { sourceId: actor.id, reportId: r.id, reportVersion: r.versions.length }); extra = { reportId: r.id, version: r.versions.length, reportVersion: r.versions.length }; }
          extra = { ...extra, assignmentRevision: a.revision, assignmentVersion: a.version, newAssignmentVersion: a.version, planVersion: t.planVersion };
        } else if (c.type === 'propose-identity') {
          check(!s.proposals.some(p => p.teamId === t.id && p.id === c.proposalId), 'EXISTS', 'Proposal ID exists.'); check(activeMember(t, c.targetId), 'NOT_MEMBER', 'Target must be current teammate.'); check(c.targetId !== t.managerId, 'INVALID_IDENTITY', 'Manager identity is derived.');
          const change = { targetId: c.targetId, fromIdentityRevision: currentIdentity(t, c.targetId)?.revision || 0, identity: c.identity }; check(currentIdentity(t, c.targetId)?.text !== c.identity, 'NO_CHANGE', 'Identity must change.');
          const p = { id: c.proposalId, teamId: t.id, kind: 'identity', origin: { authorId: actor.id }, revisions: [{ ...makeWork([]), concerned: [], confirmed: false, identityChange: change, targetTenure: tenureOf(t, c.targetId) }], responses: [], decisions: [] }; s.proposals.push(p); notify(s, t, 'proposal', 'Identity proposal awaits manager confirmation.', at, actor.id, { sourceId: actor.id, proposalId: p.id, proposalRevision: 1 }); extra = { proposalId: p.id, proposalRevision: 1 };
        } else if (c.type === 'report' || c.type === 'correct-report') { let r = s.reports.find(r => r.teamId === t.id && r.id === c.reportId); if (c.assignmentRevision) check(t.assignments.some(a => a.revision === c.assignmentRevision && a.targetId === actor.id), 'STALE_ASSIGNMENT', 'Reference exact own assignment.'); if (c.type === 'report') { check(!r, 'EXISTS', 'Report ID exists; correct your report instead.'); r = { id: c.reportId, teamId: t.id, authorId: actor.id, versions: [] }; s.reports.push(r); } else { check(r && r.authorId === actor.id, 'FORBIDDEN', 'Only your own report may be corrected.'); check(c.expectedReportVersion === latest(r.versions).version, 'STALE_REPORT', 'Correction requires exact expectedReportVersion.'); } r.versions.push({ generation: s.generation, authorId: actor.id, at, version: r.versions.length + 1, assignmentRevision: c.assignmentRevision ?? (c.type === 'correct-report' ? latest(r.versions).assignmentRevision : currentAssignment(s, t, actor.id)?.revision ?? 0), text: c.text, status: c.status }); notify(s, t, 'report', `${actor.id} reported ${c.status}: ${c.text.slice(0, 400)}`, at, actor.id, { sourceId: actor.id, reportId: r.id, reportVersion: r.versions.length }); extra = { reportId: r.id, version: r.versions.length, reportVersion: r.versions.length, planVersion: t.planVersion };
        } else if (c.type === 'comment') {
          check(!(c.reportId && c.proposalId), 'INVALID', 'Comment has at most one reference.');
          check(unique(c.responseNeededBy) && c.responseNeededBy.every(who => activeMember(t, who)), 'NOT_MEMBER', 'Response recipients must be distinct current teammates.');
          if (c.reportId) check(s.reports.some(r => r.teamId === t.id && r.id === c.reportId), 'NOT_FOUND', 'Unknown report.');
          if (c.proposalId) check(s.proposals.some(p => p.teamId === t.id && p.id === c.proposalId), 'NOT_FOUND', 'Unknown proposal.');
          const commentId = `comment-${s.comments.length + 1}`;
          s.comments.push({ id: commentId, teamId: t.id, authorId: actor.id, generation: s.generation, text: c.text, responseNeededBy: [...c.responseNeededBy], ...(c.reportId ? { reportId: c.reportId } : {}), ...(c.proposalId ? { proposalId: c.proposalId } : {}), at });
          for (const recipientId of currentIds(t)) {
            const requested = c.responseNeededBy.includes(recipientId);
            if (requested || recipientId !== actor.id) s.attention.push({ sequence: s.nextSequence++, generation: s.generation, recipientId, teamId: t.id, kind: requested ? 'discussion' : 'comment', text: requested ? `${actor.id} requested your response to ${commentId}${c.proposalId ? ' on proposal ' + c.proposalId : c.reportId ? ' on report ' + c.reportId : ''}: ${c.text.slice(0, 400)}` : 'Routine comment retained.', at, sourceId: actor.id, ...(c.reportId ? { reportId: c.reportId, reportVersion: latest(s.reports.find(r => r.teamId === t.id && r.id === c.reportId).versions).version } : {}), ...(c.proposalId ? { proposalId: c.proposalId, proposalRevision: latest(s.proposals.find(p => p.teamId === t.id && p.id === c.proposalId).revisions).revision } : {}) });
          }
        } else if (c.type === 'propose') { check(!s.proposals.some(p => p.teamId === t.id && p.id === c.proposalId), 'EXISTS', 'Proposal ID exists.'); const r = s.reports.find(r => r.teamId === t.id && r.id === c.reportId); check(r && r.authorId === actor.id && r.versions.some(v => v.version === c.reportVersion), 'INVALID_ORIGIN', 'Cite an exact version of your own report.'); const p = { id: c.proposalId, teamId: t.id, kind: 'work', origin: { reportId: r.id, version: c.reportVersion, authorId: actor.id }, revisions: [{ ...makeWork([]), concerned: [], confirmed: false }], responses: [], decisions: [] }; s.proposals.push(p); notify(s, t, 'proposal', 'Proposal awaits manager confirmation of text and concerned parties.', at, actor.id, { sourceId: actor.id, proposalId: p.id, proposalRevision: 1 }); extra = { proposalId: p.id, proposalRevision: 1 };
        } else {
          const p = s.proposals.find(p => p.teamId === t.id && p.id === c.proposalId); check(p, 'NOT_FOUND', 'Unknown proposal.'); const v = latest(p.revisions);
          if (c.type === 'revise-proposal') { manager(); check(c.proposalRevision === v.revision, 'STALE_PROPOSAL', 'Revise the exact latest proposal revision.'); check(p.kind === 'identity' || c.identity === undefined, 'INVALID', 'Identity payload only for identity proposal.'); if (p.kind === 'identity') { check(activeMember(t, v.identityChange.targetId) && v.identityChange.targetId !== t.managerId && tenureOf(t, v.identityChange.targetId) === v.targetTenure, 'STALE_IDENTITY', 'Identity target tenure changed.'); check(c.concernedIds.includes(v.identityChange.targetId), 'NOT_MEMBER', 'Identity target must be concerned.'); check((currentIdentity(t, v.identityChange.targetId)?.revision || 0) === v.identityChange.fromIdentityRevision, 'STALE_IDENTITY', 'Identity changed; originate a new proposal.'); } check(!p.decisions.some(d => d.proposalRevision === v.revision && d.outcome === 'accepted'), 'DECIDED', 'Accepted proposal is immutable; originate a new proposal.'); check(unique(c.concernedIds) && c.concernedIds.every(who => activeMember(t, who)) && c.concernedIds.includes(t.managerId) && c.concernedIds.includes(p.origin.authorId), 'NOT_MEMBER', 'Concerned parties must be distinct current teammates including manager and originator.'); check(!(v.confirmed && v.generation === s.generation && v.authorId === actor.id && v.text === c.text && v.concerned.length === c.concernedIds.length && v.concerned.every(x => c.concernedIds.includes(x.id) && tenureOf(t, x.id) === x.tenure) && (p.kind !== 'identity' || (c.identity ?? v.identityChange.identity) === v.identityChange.identity)), 'NO_CHANGE', 'Unchanged proposal text, parties and payload do not invalidate responses.'); p.revisions.push({ ...makeWork(p.revisions), concerned: c.concernedIds.map(who => ({ id: who, tenure: t.tenures[who] })), confirmed: true, ...(p.kind === 'identity' ? { identityChange: { ...v.identityChange, identity: c.identity ?? v.identityChange.identity }, targetTenure: v.targetTenure } : {}) }); notify(s, t, 'proposal', 'Manager confirmed new proposal revision; fresh explicit responses requested.', at, actor.id, { sourceId: actor.id, proposalId: p.id, proposalRevision: p.revisions.length });
          } else {
            check(c.proposalRevision === v.revision, 'STALE_PROPOSAL', 'Respond to the latest exact proposal revision.'); check(v.confirmed, 'UNCONFIRMED', 'Manager must first confirm proposal.'); check(v.generation === s.generation, 'STALE_GENERATION', 'Manager must reconfirm proposal in current generation.'); if (c.type !== 'escalate-proposal') check(v.authorId === t.managerId && v.concerned.every(x => activeMember(t, x.id) && tenureOf(t, x.id) === x.tenure), 'STALE_CONCERNED', 'Concerned membership changed; manager must revise proposal.'); check(!p.decisions.some(d => d.proposalRevision === v.revision), 'DECIDED', 'Proposal revision already decided.');
            if (c.type === 'respond-proposal') { const concerned = v.concerned.find(x => x.id === actor.id); check(concerned, 'NOT_CONCERNED', 'Only explicitly concerned parties may respond.'); p.responses.push({ generation: s.generation, proposalRevision: v.revision, sessionId: actor.id, tenure: concerned.tenure, response: c.response, text: c.text || '', at }); notify(s, t, 'proposal', `${actor.id} explicitly responded ${c.response} to proposal revision ${v.revision}.`, at, actor.id, { sourceId: actor.id, proposalId: p.id, proposalRevision: v.revision });
            } else { manager(); if (c.type === 'accept-proposal') check(v.concerned.every(x => latest(p.responses.filter(r => r.proposalRevision === v.revision && r.generation === s.generation && r.sessionId === x.id && r.tenure === x.tenure))?.response === 'agree'), 'NO_UNANIMITY', 'All concerned current identities must explicitly agree to this exact revision.'); const outcome = c.type === 'accept-proposal' ? 'accepted' : 'escalated'; if (outcome === 'accepted' && p.kind === 'identity') { const i = v.identityChange; check(i.targetId !== t.managerId && tenureOf(t, i.targetId) === v.targetTenure && (currentIdentity(t, i.targetId)?.revision || 0) === i.fromIdentityRevision, 'STALE_IDENTITY', 'Identity or target tenure changed.'); check(currentIdentity(t, i.targetId)?.text !== i.identity, 'NO_CHANGE', 'Identity must change.'); t.identities.push({ ...workEntry(t.identities, i.identity), targetId: i.targetId, tenure: v.targetTenure, proposalId: p.id, proposalRevision: v.revision }); t.planVersion++; } p.decisions.push({ generation: s.generation, authorId: actor.id, at, proposalRevision: v.revision, outcome, text: c.text || '' }); notify(s, t, 'proposal', `Proposal revision ${v.revision} ${outcome}${p.kind === 'identity' && outcome === 'accepted' ? '; typed team identity applied.' : '; work decision is a record, not execution.'}`, at, undefined, { sourceId: actor.id, proposalId: p.id, proposalRevision: v.revision }); }
          }
          extra = { proposalId: p.id, proposalRevision: latest(p.revisions).revision };
        }
      }
    }
  }
  s.revision++;
  // Open and commit use the same complete fail-closed validation boundary.
  let validated; try { validated = validateState(s); } catch (e) { if (c.type === 'save-team' && e.code === 'INVALID_STATE') fail('INVALID_TOPOLOGY', e.message); throw e; }
  return { state: validated, result: { ...(actor.kind === 'session' ? {} : { revision: validated.revision }), generation: validated.generation, ...(c.teamId ? { planVersion: validated.teams.find(t => t.id === c.teamId)?.planVersion } : {}), ...extra } };
}
// Projections are deliberately state-shaped, not complete ledgers; never validate/write them as storage.
function currentTeam(s, t) {
  const targets = currentIds(t);
  return { ...t, brief: t.brief.length ? [latest(t.brief)] : [], responsibilities: targets.map(who => latest(t.responsibilities.filter(r => r.targetId === who))).filter(Boolean), identities: targets.map(who => currentIdentity(t, who)).filter(Boolean), assignments: targets.map(who => currentAssignment(s, t, who)).filter(Boolean).map(a => ({ ...a, statusHistory: [] })), history: [] };
}
function currentReports(s, teams = s.teams) {
  const selected = [];
  for (const t of teams.filter(t => t.status === 'active')) for (const who of currentIds(t)) {
    const a = currentAssignment(s, t, who); if (!a && who !== t.managerId) continue;
    const candidates = s.reports.filter(r => r.teamId === t.id && r.authorId === who).map(r => ({ r, v: latest(r.versions.filter(v => v.assignmentRevision === (a?.revision || 0))) })).filter(x => x.v);
    candidates.sort((a, b) => a.v.at.localeCompare(b.v.at)); const item = latest(candidates);
    if (item) selected.push({ ...item.r, versions: [item.v] });
  }
  return selected;
}
function compactProposal(p) { const v = latest(p.revisions); const votes = new Map(); for (const r of p.responses.filter(r => r.proposalRevision === v.revision)) votes.set(r.sessionId, r); return { ...p, revisions: [v], responses: [...votes.values()], decisions: p.decisions.filter(d => d.proposalRevision === v.revision) }; }
function currentSnapshot(state) {
  const s = validateState(state);
  return clone({ ...s, snapshotKind: 'current', sessions: s.sessions.map(x => ({ ...x, identityHistory: [] })), teams: s.teams.map(t => currentTeam(s, t)), reports: currentReports(s), proposals: s.teams.flatMap(t => s.proposals.filter(p => p.teamId === t.id).slice(-10).map(compactProposal)), comments: [], attention: [] });
}
function historySnapshot(s, t) {
  const ids = new Set(t.history.flatMap(h => h.roster.map(r => r.id)));
  return clone({ ...s, snapshotKind: 'history', sessions: s.sessions.filter(x => ids.has(x.id)), teams: [t], reports: s.reports.filter(x => x.teamId === t.id), proposals: s.proposals.filter(x => x.teamId === t.id), comments: s.comments.filter(x => x.teamId === t.id), attention: s.attention.filter(x => x.teamId === t.id) });
}
function read(state, actor, queryValue) {
  const s = validateState(state); actor = actorCheck(actor); const q = parse(querySchema, queryValue); const meta = { ...(actor.kind === 'owner' ? { revision: s.revision } : {}), generation: s.generation, reviewRequired: s.reviewRequired };
  check(actor.kind !== 'host', 'FORBIDDEN', 'Host reads use owner snapshot internally.');
  if (q.type === 'snapshot' || q.type === 'export') { check(actor.kind === 'owner', 'FORBIDDEN', 'Owner snapshot/export only.'); return q.type === 'export' ? s : currentSnapshot(s); }
  if (actor.kind === 'session') check(s.sessions.some(x => x.id === actor.id && !x.observation.archived), 'FORBIDDEN', 'Known current session required.');
  const mine = s.teams.filter(t => actor.kind === 'owner' || activeMember(t, actor.id)); const withRole = t => ({ id: t.id, title: t.title, description: t.description, role: actor.kind === 'owner' ? 'owner' : t.managerId === actor.id ? 'manager' : 'member', planVersion: t.planVersion });
  if (q.type === 'my-teams') return clone({ ...meta, teams: mine.map(withRole) });
  if (q.type === 'own-record') { check(actor.kind === 'session', 'FORBIDDEN', 'Session read only.'); return clone({ ...meta, snapshotKind: 'current', session: { ...s.sessions.find(x => x.id === actor.id), identityHistory: [] }, teams: mine.map(withRole), reports: currentReports(s, mine).filter(r => r.authorId === actor.id) }); }
  if (q.type === 'updates') {
    check(actor.kind === 'session', 'FORBIDDEN', 'Session updates only.');
    const box = inbox(s, actor.id); const refs = box.events.filter(e => mine.some(t => t.id === e.teamId));
    const reports = []; const reportRefs = new Map(); for (const e of refs) if (e.reportId && e.reportVersion) { const key = `${e.teamId}\0${e.reportId}`; if (!reportRefs.has(key) || reportRefs.get(key).reportVersion < e.reportVersion) reportRefs.set(key, e); }
    for (const e of reportRefs.values()) { const r = s.reports.find(r => r.teamId === e.teamId && r.id === e.reportId); const v = r?.versions.find(v => v.version === e.reportVersion); if (v) reports.push({ id: r.id, teamId: r.teamId, authorId: r.authorId, version: v }); }
    const proposals = []; const proposalRefs = new Set(); for (const e of refs) if (e.proposalId) { const key = `${e.teamId}\0${e.proposalId}`; if (proposalRefs.has(key)) continue; proposalRefs.add(key); const p = s.proposals.find(p => p.teamId === e.teamId && p.id === e.proposalId); if (p) proposals.push({ id: p.id, teamId: p.teamId, kind: p.kind, origin: p.origin, revision: latest(p.revisions), decision: latest(p.decisions.filter(d => d.proposalRevision === latest(p.revisions).revision)) || null }); }
    return clone({ ...meta, ...box, reports, proposals, teams: mine.map(t => ({ id: t.id, planVersion: t.planVersion, assignments: currentIds(t).map(who => currentAssignment(s, t, who)).filter(Boolean).map(a => ({ targetId: a.targetId, assignmentRevision: a.revision, assignmentVersion: a.version, workStatus: a.workStatus })) })) });
  }
  if (q.type === 'inbox') { check(actor.kind === 'session', 'FORBIDDEN', 'Session inbox only.'); return clone({ ...meta, ...inbox(s, actor.id) }); }
  if (q.type === 'profile' && !q.teamId && mine.length !== 1) return clone({ ...meta, candidates: mine.map(withRole) });
  const t = teamFor(s, q.teamId || mine[0]?.id, actor, false);
  if (q.type === 'history') { const result = historySnapshot(s, t); if (actor.kind === 'session') delete result.revision; return result; }
  if (q.type === 'profile') return clone({ ...meta, snapshotKind: 'current', team: currentTeam(s, t), members: currentIds(t).map(who => { const x = s.sessions.find(x => x.id === who); const raw = currentAssignment(s, t, who); const assignment = raw ? { ...raw, statusHistory: [] } : null; const responsibility = latest(t.responsibilities.filter(r => r.targetId === who)) || null; return { id: who, identity: who === t.managerId ? 'Manager' : currentIdentity(t, who)?.text || '', responsibility, assignment, workStatus: assignment?.workStatus || null, visibleState: visibleState(x.observation, assignment), observation: x.observation, role: who === t.managerId ? 'manager' : 'member' }; }), reports: currentReports(s, [t]), proposals: s.proposals.filter(p => p.teamId === t.id).slice(-10).map(compactProposal), comments: [] });
  if (q.type === 'report') { const r = s.reports.find(r => r.teamId === t.id && r.id === q.reportId && r.authorId === q.sessionId); check(r, 'NOT_FOUND', 'Unknown report.'); const v = q.version === undefined ? latest(r.versions) : r.versions.find(v => v.version === q.version); check(v, 'NOT_FOUND', 'Unknown report version.'); return clone({ ...meta, report: r, version: v }); }
  const p = s.proposals.find(p => p.teamId === t.id && p.id === q.proposalId); check(p, 'NOT_FOUND', 'Unknown proposal.'); return clone({ ...meta, proposal: p, comments: s.comments.filter(c => c.teamId === t.id && c.proposalId === p.id) });
}
function context(state, sessionId) {
  try {
    const s = validateState(state); const person = s.sessions.find(x => x.id === sessionId); if (!person || person.observation.archived) return '';
    const teams = s.teams.filter(t => activeMember(t, sessionId)); if (!teams.length) return '';
    const short = (value, n = 400) => value.length > n ? value.slice(0, n) + '…' : value;
    const pieces = ['Session teams: shared coordination records, not execution approval. No automatic wake or delivery claim. Retrieve session_teams my-teams/profile/inbox for exact records; proposal/report queries provide history. Explicit acknowledge uses retrieved generation and throughSequence. Comments and conditional responses are not agreement.', s.reviewRequired ? 'OWNER STARTUP REVIEW HOLD: cross-session directions held; own factual reports remain allowed. Never resume historical assignments or old proposal consent.' : 'Use exact team planVersion for manager plan writes and assignment revision/version for worker writes; mutation receipts support consecutive writes without ritual rereads. Historical/needs-review assignments are not current instructions.'];
    for (const t of teams.slice(0, 10)) {
      const assignment = latest(t.assignments.filter(a => a.targetId === sessionId && a.status === 'current' && a.generation === s.generation && a.tenure === t.tenures[sessionId]));
      const brief = latest(t.brief); const responsibility = latest(t.responsibilities.filter(r => r.targetId === sessionId));
      pieces.push(`Team ${t.id}: ${short(t.title, 100)}. Role ${t.managerId === sessionId ? 'manager' : 'member'}; manager ${t.managerId}; members ${t.memberIds.slice(0, 20).join(', ')}. ${short(t.description, 180)}`);
      if (brief) pieces.push(`Shared brief: ${short(brief.text)}${brief.exceptionalRules ? '; exceptional rules (plain language): ' + short(brief.exceptionalRules, 200) : ''}`);
      if (responsibility) pieces.push(`Recorded responsibility (retrieve/review current applicability): ${short(responsibility.text, 240)}`);
      if (t.managerId === sessionId) pieces.push('Manager: initialize missing team identities, concise stable objective and responsibilities in one update-work; normally record your coordination responsibility, no self-assignment required. Change established objective only via explicit set-objective. Consider known worker setup limits before delegation; warn early about outside-boundary work. Executing worker still requests exact native permission and reports the outcome.');
      pieces.push(`Team identity: ${t.managerId === sessionId ? 'Manager' : currentIdentity(t, sessionId)?.text || '(not initialized)'}.`);
      if (assignment && !s.reviewRequired) pieces.push(`${['waiting', 'complete'].includes(assignment.workStatus) ? 'Context only; not an instruction to redo' : 'Current assignment'} [${assignment.workStatus}]: ${short(assignment.text)}${assignment.waitingReason ? '; waiting: ' + short(assignment.waitingReason, 180) : ''}`); else if (t.assignments.some(a => a.targetId === sessionId)) pieces.push('Prior assignments retained for review, not automatic continuation.');
    }
    const box = inbox(s, sessionId); if (box.events.length) pieces.push('Pending significant updates (retrieve inbox for exact sequence/generation): ' + box.events.slice(-6).map(e => short(e.text, 260)).join(' | '));
    if (box.routineCommentCount) pieces.push('Routine comments are retained; retrieve history {teamId} to inspect them.');
    pieces.push('Queries: my-teams; profile {teamId?}; history {teamId}; own-record; report {teamId,sessionId,reportId,version?}; proposal {teamId,proposalId}; updates; inbox; Host worker-setup {teamId,sessionId,detail?} for authorized native setup facts. Manager writes: update-work; set-objective for explicit mission changes. Worker writes: set-work-status; finish-assignment with exact assignmentRevision/assignmentVersion and own report evidence (expectedReportVersion when appending). No mandatory in-progress write. Waiting is not an instruction to start work; once the blocker is actually resolved, an already-obtained factual result remains recordable atomically without an intermediate status write. Correct reports using expectedReportVersion; revise proposals using proposalRevision. Completion is not independent verification. Identity changes use propose-identity and exact unanimous acceptance, never self-edit. Explicit acknowledge requires retrieved generation and throughSequence. Comments/conditional responses never imply agreement.');
    // UTF-8 limit, without cutting a surrogate pair or relying on a timestamp/global counter.
    let result = pieces.join('\n'); while (Buffer.byteLength(result, 'utf8') > 8000) result = result.slice(0, -100); return result;
  } catch { return ''; }
}
module.exports = { CoordinationError, stateSchema, ownerCommandSchema, agentCommandSchema, querySchema, initialState, validateState, start, token, transition, read, context, upgradeV2, upgradeV3, visibleState, currentSnapshot, currentReports };
