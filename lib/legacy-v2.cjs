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
const proposalRevision = obj({ ...work, concerned: z.array(roster), confirmed: z.boolean() });
const response = obj({ generation: integer, proposalRevision: positive, sessionId: id, tenure: positive, response: z.enum(['agree', 'conditional', 'object']), text, at: time });
const decision = obj({ ...stamp, proposalRevision: positive, outcome: z.enum(['accepted', 'escalated']), text });
const teamSchema = obj({ id, title: nonempty, description: text, managerId: id, memberIds: z.array(id), status: z.enum(['active', 'idle']), tenures: z.record(id, positive),
  brief: z.array(obj({ ...work, exceptionalRules: text })), responsibilities: z.array(obj({ ...work, targetId: id })), assignments: z.array(obj({ ...work, targetId: id, tenure: positive, status: z.enum(['current', 'needs-review']) })),
  history: z.array(obj({ ...stamp, revision: positive, title: nonempty, description: text, managerId: id, memberIds: z.array(id), status: z.enum(['active', 'idle']), roster: z.array(roster) })) });
const reportSchema = obj({ id, teamId: id, authorId: id, versions: z.array(reportVersion).min(1) });
const proposalSchema = obj({ id, teamId: id, origin: obj({ reportId: id, version: positive, authorId: id }), revisions: z.array(proposalRevision).min(1), responses: z.array(response), decisions: z.array(decision) });
const baseStateSchema = obj({ schemaVersion: z.literal(2), revision: integer, generation: integer, reviewRequired: z.boolean(),
  sessions: z.array(obj({ id, identity: text, identityHistory: z.array(obj({ ...work })), observation, acknowledgment: obj({ generation: integer, throughSequence: integer }) })),
  teams: z.array(teamSchema), reports: z.array(reportSchema), proposals: z.array(proposalSchema),
  comments: z.array(obj({ id, teamId: id, authorId: id, generation: integer, text: nonempty, proposalId: id.optional(), reportId: id.optional(), responseNeededBy: z.array(id).default([]), at: time })),
  attention: z.array(obj({ sequence: positive, generation: integer, recipientId: id, teamId: id, kind: z.enum(['work', 'roster', 'report', 'proposal', 'comment', 'discussion']), text, at: time })), nextSequence: positive });
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
    need(chronological(r.versions, 'version') && generationOK(r.versions) && r.versions.every(v => v.authorId === r.authorId && (v.assignmentRevision === 0 || t.assignments.some(a => a.revision === v.assignmentRevision && a.targetId === r.authorId && a.generation === v.generation))), 'Invalid report versions/assignment reference.');
  }
  for (const p of s.proposals) {
    const t = teams.get(p.teamId); const r = s.reports.find(r => r.teamId === p.teamId && r.id === p.origin.reportId);
    need(t && r && r.authorId === p.origin.authorId && r.versions.some(v => v.version === p.origin.version), 'Invalid exact proposal report reference.');
    need(chronological(p.revisions, 'revision') && generationOK([...p.revisions, ...p.responses, ...p.decisions]), 'Invalid proposal revisions/generations.');
    need(!p.revisions[0].confirmed && p.revisions[0].concerned.length === 0 && p.revisions[0].authorId === p.origin.authorId && r.versions[p.origin.version - 1].generation <= p.revisions[0].generation && p.revisions.slice(1).every(v => v.confirmed), 'Invalid proposal origin/confirmation history.');
    for (const v of p.revisions) {
      const confirmedRoster = v.concerned.some(c => c.id === v.authorId) && v.concerned.some(c => c.id === p.origin.authorId) && t.history.some(h => h.managerId === v.authorId && v.concerned.every(c => h.roster.some(r => r.id === c.id && r.tenure === c.tenure)));
      need(unique(v.concerned.map(c => c.id)) && v.concerned.every(c => historyMember(t, c.id, c.tenure)) && (!v.confirmed || confirmedRoster), 'Invalid concerned parties or confirmation.');
    }
    for (const v of p.responses) { const rev = p.revisions[v.proposalRevision - 1]; need(rev && rev.confirmed && rev.generation === v.generation && rev.concerned.some(c => c.id === v.sessionId && c.tenure === v.tenure), 'Invalid response reference.'); }
    need(unique(p.decisions.map(d => d.proposalRevision)), 'Duplicate proposal decision.');
    for (const d of p.decisions) {
      const rev = p.revisions[d.proposalRevision - 1]; need(rev && rev.confirmed && rev.generation === d.generation && (d.outcome === 'accepted' ? rev.authorId === d.authorId : t.history.some(h => h.managerId === d.authorId)), 'Invalid decision reference.');
      if (d.outcome === 'accepted') need(rev.concerned.every(c => { const vote = latest(p.responses.filter(v => v.proposalRevision === rev.revision && v.generation === rev.generation && v.sessionId === c.id && v.tenure === c.tenure)); return vote && vote.response === 'agree'; }), 'Accepted without unanimous exact votes.');
    }
  }
  for (const c of s.comments) { const t = teams.get(c.teamId); need(t && historyMember(t, c.authorId) && !(c.reportId && c.proposalId) && c.generation <= s.generation && unique(c.responseNeededBy) && t.history.some(h => h.roster.some(r => r.id === c.authorId) && c.responseNeededBy.every(who => h.roster.some(r => r.id === who))), 'Invalid comment author/response recipients.'); if (c.reportId) need(s.reports.some(r => r.teamId === c.teamId && r.id === c.reportId), 'Invalid comment report.'); if (c.proposalId) need(s.proposals.some(p => p.teamId === c.teamId && p.id === c.proposalId), 'Invalid comment proposal.'); }
  need(s.nextSequence === s.attention.length + 1 && s.revision >= s.generation, 'Invalid ledger counters.');
  let previous = 0;
  for (const e of s.attention) { need(e.sequence === previous + 1 && e.sequence < s.nextSequence && e.generation <= s.generation && sessions.has(e.recipientId) && teams.has(e.teamId) && historyMember(teams.get(e.teamId), e.recipientId), 'Invalid attention sequence/reference.'); previous = e.sequence; }
  for (const person of s.sessions) {
    need(person.acknowledgment.generation <= s.generation && person.acknowledgment.throughSequence < s.nextSequence && chronological(person.identityHistory, 'revision') && generationOK(person.identityHistory) && person.identityHistory.every(h => h.authorId === person.id), 'Invalid session history/ack.');
    need(person.identity === (latest(person.identityHistory)?.text || ''), 'Identity/history mismatch.');
    if (person.acknowledgment.throughSequence > 0) need(s.attention.some(e => e.recipientId === person.id && e.generation === person.acknowledgment.generation && e.sequence === person.acknowledgment.throughSequence), 'Ack not recipient sequence.');
  }
}
const stateSchema = baseStateSchema.superRefine((s, ctx) => { try { structural(s); } catch (e) { ctx.addIssue({ code: 'custom', message: e.message }); } });
const command = (type, fields = {}, revision = true) => obj({ type: z.literal(type), ...(revision ? { expectedRevision: integer } : {}), ...fields });
const ownerCommandSchema = z.discriminatedUnion('type', [command('save-team', { teamId: id, title: nonempty, description: text, managerId: id, memberIds: z.array(id) }), command('retire-team', { teamId: id }), command('review-startup', { expectedGeneration: integer, reviewToken: z.string().length(64) })]);
const workFields = { teamId: id, text };
const proposalFields = { teamId: id, proposalId: id, proposalRevision: positive };
const agentCommandSchema = z.discriminatedUnion('type', [
  command('identity', { identity: text }), command('set-brief', { ...workFields, exceptionalRules: text.optional() }), command('set-responsibility', { ...workFields, targetId: id }), command('set-assignment', { ...workFields, targetId: id }),
  command('report', { teamId: id, reportId: id, text: nonempty, status: z.enum(['progress', 'blocked', 'complete']) }), command('correct-report', { teamId: id, reportId: id, text: nonempty, status: z.enum(['progress', 'blocked', 'complete']) }),
  command('comment', { teamId: id, text: nonempty, proposalId: id.optional(), reportId: id.optional(), responseNeededBy: z.array(id).default([]) }),
  command('propose', { teamId: id, proposalId: id, reportId: id, reportVersion: positive, text: nonempty }),
  command('revise-proposal', { teamId: id, proposalId: id, text: nonempty, concernedIds: z.array(id).min(1) }),
  command('respond-proposal', { ...proposalFields, response: z.enum(['agree', 'conditional', 'object']), text: text.optional() }),
  command('accept-proposal', proposalFields), command('escalate-proposal', { ...proposalFields, text: nonempty }), command('acknowledge', { generation: integer, throughSequence: integer })
]);
const hostCommandSchema = command('observe', { observations: z.array(obj({ sessionId: id, availability: observation.shape.availability, execution: observation.shape.execution, archived: z.boolean() })) }, false);
const querySchema = z.discriminatedUnion('type', [obj({ type: z.literal('snapshot') }), obj({ type: z.literal('my-teams') }), obj({ type: z.literal('profile'), teamId: id.optional() }), obj({ type: z.literal('own-record') }), obj({ type: z.literal('report'), teamId: id, sessionId: id, reportId: id, version: positive.optional() }), obj({ type: z.literal('inbox') }), obj({ type: z.literal('proposal'), teamId: id, proposalId: id })]);
function parse(schema, value) { const parsed = schema.safeParse(value); if (!parsed.success) fail('INVALID', parsed.error.message); return parsed.data; }
function validateState(state) { const parsed = stateSchema.safeParse(state); if (!parsed.success) fail('INVALID_STATE', parsed.error.message); return clone(parsed.data); }
function initialState() { return { schemaVersion: 2, revision: 0, generation: 0, reviewRequired: false, sessions: [], teams: [], reports: [], proposals: [], comments: [], attention: [], nextSequence: 1 }; }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'; return JSON.stringify(value); }
function token(state) { return createHash('sha256').update(canonical(validateState(state))).digest('hex'); }
function start(state, nowISO) { parse(time, nowISO); const s = validateState(state); s.generation++; s.revision++; s.reviewRequired = s.teams.some(t => t.status === 'active'); for (const t of s.teams) for (const a of t.assignments) a.status = 'needs-review'; return validateState(s); }
function actorCheck(actor) { return parse(z.discriminatedUnion('kind', [obj({ kind: z.literal('owner') }), obj({ kind: z.literal('session'), id }), obj({ kind: z.literal('host') })]), actor); }
function teamFor(s, teamId, actor, active = true) { const t = s.teams.find(t => t.id === teamId); check(t, 'NOT_FOUND', 'Unknown team.'); check(actor.kind === 'owner' || (actor.kind === 'session' && activeMember(t, actor.id)), 'FORBIDDEN', 'Current immediate team membership required.'); if (active) check(t.status === 'active', 'INACTIVE', 'Team is retired.'); return t; }
function notify(s, t, kind, message, at, except) { for (const recipientId of currentIds(t)) if (recipientId !== except) s.attention.push({ sequence: s.nextSequence++, generation: s.generation, recipientId, teamId: t.id, kind, text: message, at }); }
function teamHistory(t, s, authorId, at) { t.history.push({ generation: s.generation, authorId, at, revision: t.history.length + 1, title: t.title, description: t.description, managerId: t.managerId, memberIds: [...t.memberIds], status: t.status, roster: currentIds(t).map(who => ({ id: who, tenure: t.tenures[who] })) }); }
function invalidate(t, previous, generation) { for (const a of t.assignments) if (t.status !== 'active' || a.generation !== generation || !activeMember(t, a.targetId) || a.tenure !== t.tenures[a.targetId] || previous.managerId !== t.managerId) a.status = 'needs-review'; }
function inbox(s, who) { const person = s.sessions.find(x => x.id === who); check(person, 'FORBIDDEN', 'Unknown session.'); const events = s.attention.filter(e => e.recipientId === who && e.generation === s.generation); const acknowledgedThrough = person.acknowledgment.generation === s.generation ? person.acknowledgment.throughSequence : 0; const pending = events.filter(e => e.sequence > acknowledgedThrough); return { latestSequence: latest(events)?.sequence || 0, acknowledgedThrough, events: pending.filter(e => e.kind !== 'comment'), routineCommentCount: pending.filter(e => e.kind === 'comment').length }; }
function transition(state, actor, commandValue, nowISO) {
  actor = actorCheck(actor); const c = parse(actor.kind === 'owner' ? ownerCommandSchema : actor.kind === 'host' ? hostCommandSchema : agentCommandSchema, commandValue); parse(time, nowISO);
  const s = validateState(state); const at = nowISO; let extra = {};
  if (actor.kind !== 'host') check(c.expectedRevision === s.revision, 'STALE', 'Refresh current revision before writing.');
  if (c.type === 'review-startup') {
    check(s.reviewRequired && c.expectedGeneration === s.generation && c.reviewToken === token(s), 'STALE_REVIEW', 'Review exact current startup snapshot.'); s.reviewRequired = false;
  } else if (c.type === 'observe') {
    check(unique(c.observations.map(o => o.sessionId)), 'INVALID', 'Duplicate observations.');
    for (const o of c.observations) { const person = s.sessions.find(x => x.id === o.sessionId); if (!person) continue; person.observation = { availability: o.availability, execution: o.execution, archived: o.archived, at }; if (!o.archived) continue;
      for (const t of s.teams.filter(t => activeMember(t, person.id))) { const previous = clone(t); if (t.managerId === person.id) t.status = 'idle'; else t.memberIds = t.memberIds.filter(x => x !== person.id); invalidate(t, previous, s.generation); teamHistory(t, s, 'host', at); notify(s, t, 'roster', 'Native archive changed team membership; retained records need review.', at); }
    }
  } else {
    check(!s.reviewRequired || actor.kind === 'owner' || ['acknowledge', 'identity', 'report', 'correct-report'].includes(c.type), 'REVIEW_REQUIRED', 'Owner startup review required; old work is not resumed.');
    if (c.type === 'save-team') {
      check(unique([c.managerId, ...c.memberIds]), 'INVALID_TOPOLOGY', 'Manager and members must be distinct.');
      for (const who of [c.managerId, ...c.memberIds]) { let person = s.sessions.find(x => x.id === who); if (!person) { person = { id: who, identity: '', identityHistory: [], observation: { availability: 'unknown', execution: 'unknown', archived: false, at }, acknowledgment: { generation: s.generation, throughSequence: 0 } }; s.sessions.push(person); } check(!person.observation.archived, 'ARCHIVED', 'Archived sessions cannot join.'); }
      let t = s.teams.find(t => t.id === c.teamId); const previous = t ? clone(t) : null;
      if (!t) { t = { id: c.teamId, title: c.title, description: c.description, managerId: c.managerId, memberIds: [], status: 'idle', tenures: {}, brief: [], responsibilities: [], assignments: [], history: [] }; s.teams.push(t); }
      const oldMembers = previous?.status === 'active' ? currentIds(previous) : [];
      for (const who of [c.managerId, ...c.memberIds]) if (!oldMembers.includes(who) || (previous && previous.managerId !== c.managerId && [previous.managerId, c.managerId].includes(who))) t.tenures[who] = tenureOf(t, who) + 1;
      Object.assign(t, { title: c.title, description: c.description, managerId: c.managerId, memberIds: [...c.memberIds], status: 'active' });
      invalidate(t, previous || t, s.generation); teamHistory(t, s, 'owner', at); notify(s, t, 'roster', 'Owner saved team membership or description.', at); extra = { teamId: t.id };
    } else if (c.type === 'retire-team') { const t = teamFor(s, c.teamId, actor); const previous = clone(t); notify(s, t, 'roster', 'Owner retired team; previous work must not continue.', at); t.status = 'idle'; invalidate(t, previous, s.generation); teamHistory(t, s, 'owner', at);
    } else {
      check(actor.kind === 'session', 'FORBIDDEN', 'Session operation required.'); const person = s.sessions.find(x => x.id === actor.id); check(person && !person.observation.archived, 'FORBIDDEN', 'Known unarchived session required.');
      if (c.type === 'identity') { person.identity = c.identity; person.identityHistory.push({ generation: s.generation, authorId: actor.id, at, revision: person.identityHistory.length + 1, text: c.identity });
      } else if (c.type === 'acknowledge') { const box = inbox(s, actor.id); check(c.generation === s.generation, 'STALE_GENERATION', 'Acknowledgment generation is stale.'); check(c.throughSequence <= box.latestSequence && (c.throughSequence === 0 || s.attention.some(e => e.sequence === c.throughSequence && e.recipientId === actor.id && e.generation === s.generation)), 'INVALID_ACK', 'Use your retrieved inbox sequence.'); person.acknowledgment = { generation: s.generation, throughSequence: Math.max(box.acknowledgedThrough, c.throughSequence) };
      } else {
        const t = teamFor(s, c.teamId, actor); const manager = () => check(t.managerId === actor.id, 'FORBIDDEN', 'Team manager operation.'); const makeWork = list => ({ generation: s.generation, authorId: actor.id, at, revision: list.length + 1, text: c.text });
        if (c.type === 'set-brief') { manager(); t.brief.push({ ...makeWork(t.brief), exceptionalRules: c.exceptionalRules || '' }); notify(s, t, 'work', 'Team brief changed.', at, actor.id);
        } else if (c.type === 'set-responsibility' || c.type === 'set-assignment') { manager(); check(activeMember(t, c.targetId), 'NOT_MEMBER', 'Target must be a current teammate.'); const list = c.type === 'set-assignment' ? t.assignments : t.responsibilities; if (c.type === 'set-assignment') for (const a of list) if (a.targetId === c.targetId) a.status = 'needs-review'; list.push({ ...makeWork(list), targetId: c.targetId, ...(c.type === 'set-assignment' ? { tenure: t.tenures[c.targetId], status: 'current' } : {}) }); notify(s, t, 'work', `${c.type === 'set-assignment' ? 'Assignment' : 'Responsibility'} for ${c.targetId} changed.`, at, actor.id);
        } else if (c.type === 'report' || c.type === 'correct-report') { let r = s.reports.find(r => r.teamId === t.id && r.id === c.reportId); if (c.type === 'report') { check(!r, 'EXISTS', 'Report ID exists; correct your report instead.'); r = { id: c.reportId, teamId: t.id, authorId: actor.id, versions: [] }; s.reports.push(r); } else check(r && r.authorId === actor.id, 'FORBIDDEN', 'Only your own report may be corrected.'); r.versions.push({ generation: s.generation, authorId: actor.id, at, version: r.versions.length + 1, assignmentRevision: latest(t.assignments.filter(a => a.targetId === actor.id && a.status === 'current' && a.generation === s.generation && a.tenure === tenureOf(t, actor.id)))?.revision || 0, text: c.text, status: c.status }); notify(s, t, 'report', `${actor.id} reported ${c.status}: ${c.text.slice(0, 400)}`, at, actor.id); extra = { reportId: r.id, version: r.versions.length };
        } else if (c.type === 'comment') {
          check(!(c.reportId && c.proposalId), 'INVALID', 'Comment has at most one reference.');
          check(unique(c.responseNeededBy) && c.responseNeededBy.every(who => activeMember(t, who)), 'NOT_MEMBER', 'Response recipients must be distinct current teammates.');
          if (c.reportId) check(s.reports.some(r => r.teamId === t.id && r.id === c.reportId), 'NOT_FOUND', 'Unknown report.');
          if (c.proposalId) check(s.proposals.some(p => p.teamId === t.id && p.id === c.proposalId), 'NOT_FOUND', 'Unknown proposal.');
          const commentId = `comment-${s.comments.length + 1}`;
          s.comments.push({ id: commentId, teamId: t.id, authorId: actor.id, generation: s.generation, text: c.text, responseNeededBy: [...c.responseNeededBy], ...(c.reportId ? { reportId: c.reportId } : {}), ...(c.proposalId ? { proposalId: c.proposalId } : {}), at });
          for (const recipientId of currentIds(t)) {
            const requested = c.responseNeededBy.includes(recipientId);
            if (requested || recipientId !== actor.id) s.attention.push({ sequence: s.nextSequence++, generation: s.generation, recipientId, teamId: t.id, kind: requested ? 'discussion' : 'comment', text: requested ? `${actor.id} requested your response to ${commentId}${c.proposalId ? ' on proposal ' + c.proposalId : c.reportId ? ' on report ' + c.reportId : ''}: ${c.text.slice(0, 400)}` : 'Routine comment retained.', at });
          }
        } else if (c.type === 'propose') { check(!s.proposals.some(p => p.teamId === t.id && p.id === c.proposalId), 'EXISTS', 'Proposal ID exists.'); const r = s.reports.find(r => r.teamId === t.id && r.id === c.reportId); check(r && r.authorId === actor.id && r.versions.some(v => v.version === c.reportVersion), 'INVALID_ORIGIN', 'Cite an exact version of your own report.'); const p = { id: c.proposalId, teamId: t.id, origin: { reportId: r.id, version: c.reportVersion, authorId: actor.id }, revisions: [{ ...makeWork([]), concerned: [], confirmed: false }], responses: [], decisions: [] }; s.proposals.push(p); notify(s, t, 'proposal', 'Proposal awaits manager confirmation of text and concerned parties.', at, actor.id); extra = { proposalId: p.id, proposalRevision: 1 };
        } else {
          const p = s.proposals.find(p => p.teamId === t.id && p.id === c.proposalId); check(p, 'NOT_FOUND', 'Unknown proposal.'); const v = latest(p.revisions);
          if (c.type === 'revise-proposal') { manager(); check(!p.decisions.some(d => d.proposalRevision === v.revision && d.outcome === 'accepted'), 'DECIDED', 'Accepted proposal is immutable; originate a new proposal.'); check(unique(c.concernedIds) && c.concernedIds.every(who => activeMember(t, who)) && c.concernedIds.includes(t.managerId) && c.concernedIds.includes(p.origin.authorId), 'NOT_MEMBER', 'Concerned parties must be distinct current teammates including manager and originator.'); p.revisions.push({ ...makeWork(p.revisions), concerned: c.concernedIds.map(who => ({ id: who, tenure: t.tenures[who] })), confirmed: true }); notify(s, t, 'proposal', 'Manager confirmed new proposal revision; fresh explicit responses requested.', at, actor.id);
          } else {
            check(c.proposalRevision === v.revision, 'STALE_PROPOSAL', 'Respond to the latest exact proposal revision.'); check(v.confirmed, 'UNCONFIRMED', 'Manager must first confirm proposal.'); check(v.generation === s.generation, 'STALE_GENERATION', 'Manager must reconfirm proposal in current generation.'); if (c.type !== 'escalate-proposal') check(v.authorId === t.managerId && v.concerned.every(x => activeMember(t, x.id) && tenureOf(t, x.id) === x.tenure), 'STALE_CONCERNED', 'Concerned membership changed; manager must revise proposal.'); check(!p.decisions.some(d => d.proposalRevision === v.revision), 'DECIDED', 'Proposal revision already decided.');
            if (c.type === 'respond-proposal') { const concerned = v.concerned.find(x => x.id === actor.id); check(concerned, 'NOT_CONCERNED', 'Only explicitly concerned parties may respond.'); p.responses.push({ generation: s.generation, proposalRevision: v.revision, sessionId: actor.id, tenure: concerned.tenure, response: c.response, text: c.text || '', at }); notify(s, t, 'proposal', `${actor.id} explicitly responded ${c.response} to proposal revision ${v.revision}.`, at, actor.id);
            } else { manager(); if (c.type === 'accept-proposal') check(v.concerned.every(x => latest(p.responses.filter(r => r.proposalRevision === v.revision && r.generation === s.generation && r.sessionId === x.id && r.tenure === x.tenure))?.response === 'agree'), 'NO_UNANIMITY', 'All concerned current identities must explicitly agree to this exact revision.'); const outcome = c.type === 'accept-proposal' ? 'accepted' : 'escalated'; p.decisions.push({ generation: s.generation, authorId: actor.id, at, proposalRevision: v.revision, outcome, text: c.text || '' }); notify(s, t, 'proposal', `Proposal revision ${v.revision} ${outcome}; decision is a record, not execution.`, at); }
          }
          extra = { proposalId: p.id, proposalRevision: latest(p.revisions).revision };
        }
      }
    }
  }
  s.revision++;
  // Open and commit use the same complete fail-closed validation boundary.
  let validated; try { validated = validateState(s); } catch (e) { if (c.type === 'save-team' && e.code === 'INVALID_STATE') fail('INVALID_TOPOLOGY', e.message); throw e; }
  return { state: validated, result: { revision: validated.revision, generation: validated.generation, ...extra } };
}
function read(state, actor, queryValue) {
  const s = validateState(state); actor = actorCheck(actor); const q = parse(querySchema, queryValue); const meta = { revision: s.revision, generation: s.generation, reviewRequired: s.reviewRequired };
  check(actor.kind !== 'host', 'FORBIDDEN', 'Host reads use owner snapshot internally.');
  if (q.type === 'snapshot') { check(actor.kind === 'owner', 'FORBIDDEN', 'Owner snapshot only.'); return s; }
  if (actor.kind === 'session') check(s.sessions.some(x => x.id === actor.id && !x.observation.archived), 'FORBIDDEN', 'Known current session required.');
  const mine = s.teams.filter(t => actor.kind === 'owner' || activeMember(t, actor.id)); const withRole = t => ({ ...t, role: t.managerId === actor.id ? 'manager' : 'member' });
  if (q.type === 'my-teams') return clone({ ...meta, teams: mine.map(withRole) });
  if (q.type === 'own-record') { check(actor.kind === 'session', 'FORBIDDEN', 'Session read only.'); return clone({ ...meta, session: s.sessions.find(x => x.id === actor.id), teams: mine.map(withRole), reports: s.reports.filter(r => r.authorId === actor.id && mine.some(t => t.id === r.teamId)) }); }
  if (q.type === 'inbox') { check(actor.kind === 'session', 'FORBIDDEN', 'Session inbox only.'); return clone({ ...meta, ...inbox(s, actor.id) }); }
  if (q.type === 'profile' && !q.teamId && mine.length !== 1) return clone({ ...meta, candidates: mine.map(t => ({ id: t.id, title: t.title, role: t.managerId === actor.id ? 'manager' : 'member' })) });
  const t = teamFor(s, q.teamId || mine[0]?.id, actor, false);
  if (q.type === 'profile') return clone({ ...meta, team: t, members: currentIds(t).map(who => { const x = s.sessions.find(x => x.id === who); return { id: who, identity: x.identity, observation: x.observation, role: who === t.managerId ? 'manager' : 'member' }; }), reports: s.reports.filter(r => r.teamId === t.id), proposals: s.proposals.filter(p => p.teamId === t.id), comments: s.comments.filter(c => c.teamId === t.id) });
  if (q.type === 'report') { const r = s.reports.find(r => r.teamId === t.id && r.id === q.reportId && r.authorId === q.sessionId); check(r, 'NOT_FOUND', 'Unknown report.'); const v = q.version === undefined ? latest(r.versions) : r.versions.find(v => v.version === q.version); check(v, 'NOT_FOUND', 'Unknown report version.'); return clone({ ...meta, report: r, version: v }); }
  const p = s.proposals.find(p => p.teamId === t.id && p.id === q.proposalId); check(p, 'NOT_FOUND', 'Unknown proposal.'); return clone({ ...meta, proposal: p, comments: s.comments.filter(c => c.teamId === t.id && c.proposalId === p.id) });
}
function context(state, sessionId) {
  try {
    const s = validateState(state); const person = s.sessions.find(x => x.id === sessionId); if (!person || person.observation.archived) return '';
    const teams = s.teams.filter(t => activeMember(t, sessionId)); if (!teams.length) return '';
    const short = (value, n = 400) => value.length > n ? value.slice(0, n) + '…' : value;
    const pieces = ['Session teams: shared coordination records, not execution approval. No automatic wake or delivery claim. Retrieve session_teams my-teams/profile/inbox for exact records; proposal/report queries provide history. Explicit acknowledge uses retrieved generation and throughSequence. Comments and conditional responses are not agreement.', s.reviewRequired ? 'OWNER STARTUP REVIEW HOLD: cross-session directions held; own factual identity/reports remain allowed. Never resume historical assignments or old proposal consent.' : 'Use session_teams queries to retrieve current revision before writes. Historical/needs-review assignments are not current instructions.'];
    for (const t of teams.slice(0, 10)) {
      const assignment = latest(t.assignments.filter(a => a.targetId === sessionId && a.status === 'current' && a.generation === s.generation && a.tenure === t.tenures[sessionId]));
      const brief = latest(t.brief); const responsibility = latest(t.responsibilities.filter(r => r.targetId === sessionId));
      pieces.push(`Team ${t.id}: ${short(t.title, 100)}. Role ${t.managerId === sessionId ? 'manager' : 'member'}; manager ${t.managerId}; members ${t.memberIds.slice(0, 20).join(', ')}. ${short(t.description, 180)}`);
      if (brief) pieces.push(`Shared brief: ${short(brief.text)}${brief.exceptionalRules ? '; exceptional rules (plain language): ' + short(brief.exceptionalRules, 200) : ''}`);
      if (responsibility) pieces.push(`Recorded responsibility (retrieve/review current applicability): ${short(responsibility.text, 240)}`);
      if (assignment && !s.reviewRequired) pieces.push(`Current assignment: ${short(assignment.text)}`); else if (t.assignments.some(a => a.targetId === sessionId)) pieces.push('Prior assignments retained for review, not automatic continuation.');
    }
    const box = inbox(s, sessionId); if (box.events.length) pieces.push('Pending significant updates (retrieve inbox for exact sequence/generation): ' + box.events.slice(-6).map(e => short(e.text, 260)).join(' | '));
    if (box.routineCommentCount) pieces.push('Routine comments are retained; retrieve shared profile/discussions to inspect them.');
    pieces.push('Queries: my-teams; profile {teamId?}; own-record; report {teamId,sessionId,reportId,version?}; proposal {teamId,proposalId}; inbox. Explicit acknowledge requires retrieved generation and throughSequence. Comments/conditional responses never imply agreement.');
    // UTF-8 limit, without cutting a surrogate pair or relying on a timestamp/global counter.
    let result = pieces.join('\n'); while (Buffer.byteLength(result, 'utf8') > 8000) result = result.slice(0, -100); return result;
  } catch { return ''; }
}
module.exports = { CoordinationError, stateSchema, ownerCommandSchema, agentCommandSchema, querySchema, initialState, validateState, start, token, transition, read, context };
