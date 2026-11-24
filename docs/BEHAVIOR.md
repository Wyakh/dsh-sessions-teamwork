# Session teams — behavior reference for 0.6.0

## Waiting is not deafness

A relevant accepted decision, exact required reply or handoff may notify a worker waiting on prerequisites, solely to reassess that wait. The notice includes exact task/evidence references and a prominent reassessment-only instruction; it never clears Waiting, overrides unanswered required requests or an unfinished predecessor, authorizes new execution, or grants native permissions. The worker uses trusted peer evidence to clear its own satisfied prerequisite wait with current guards; if conditions remain unmet, it keeps Waiting and stops. No polling, acknowledgment loop or manager acceptance-notification relay is required.

Explicit manager-reserved holds remain held until the manager releases them; worker waiting rewrites cannot erase that provenance. Same-task progress version changes do not discard handoff evidence, while replacement, completion, retirement, changed tenure and restart invalidate obsolete delivery. Native admission checks whether the event is work or reassessment before and after durable input admission; a mode change defers its own input rather than releasing outdated instructions. Existing With user, automation, review, approval, cold-session and burst protections remain unchanged. The schema stays6 and all earlier history is retained.

### Prompt principle after a user interruption

> After a user interruption, remain With user until the user clearly asks you to resume team coordination; then release your own hold using the latest actual user message ID before waiting for team updates. If intent is unclear, ask once whether to resume—never infer hand-back from silence or the end of a reply.

Prepared-dispatch approval is the existing special atomic path: use `confirm-dispatch` rather than releasing focus first. No dedicated user-interruption test is part of the manual test programme; existing low-level admission safety regressions are retained. See the [source-only manual test guide](<https://github.com/Wyakh/dsh-sessions-teamwork/blob/v0.6.0/docs/TESTING.md>) for all other targets and honest pass/not-exercised criteria.


## Preview, confirm, then coordinate

Before new/replacement assignments activate, the manager uses `prepare-dispatch` to store the exact immutable plan and presents its summary, scope, expected native approvals, and the default hand-back to automatic coordination. Preparation validates but activates nothing. The user then explicitly approves that preview in a fresh actual native user message. `confirm-dispatch` binds that exact current message ID, unchanged preview authority/plan/task guards and `approved:true` (the manager's semantic attestation). It applies the exact plan and releases the manager's With user hold in one atomic business mutation. Message arrival alone, silence and the original request do not confirm a prepared plan. `returnToCoordination:false` explicitly starts the workers but keeps automatic manager follow-up held. Do not release focus first. A later message or material guard change rejects stale confirmation; prepare a new preview when needed.

New/replacement tasks and reopening completed work cannot bypass confirmation through direct `update-work`. Metadata planning remains available. Ordinary handoffs and releases within a confirmed existing chain do not require another confirmation. Missing manager responsibility receives one concise coordination responsibility, never a synthetic manager assignment. Expected native approval is a preview, not an approval grant or a guarantee that an approval channel is available. Executing workers retain their own exact native permission process.

For normal work-proposal acceptance, the manager supplies `continueAssignments` containing the exact affected current unfinished task revision/version for each relevant session. Acceptance and bounded continuation intents commit together. `recordOnly:true` explicitly accepts without continuation. No work is broadened and no wait/blocker is overwritten. Intent remains pending while a member runs or is held; idle/release events reconsider it. Progress-only version bumps do not lose the accepted direction. Finish/replacement/retirement/restart invalidates obsolete intent instead of replaying work. Native delivery contains bounded accepted-decision text and exact references; if coalesced excerpts exceed the bound, an explicit message-ID lookup instruction identifies the remaining decisions before action.

Workers may use `suggestedConcernedIds` as advisory information; only the manager confirms parties. Confirmation explicitly includes mandatory manager/originator/identity-target parties. This never invents a vote. Current-tenure explicit unanimity still applies.

Existing Details & History lazily exposes immutable dispatch previews/confirmations and delivery facts. `delivery` records pending/claimed/sent/cancelled/failed plus an ephemeral `heldReason`; sent means native input admitted, NOT read, processed, understood or completed. Running-member, With user, native interaction, automation and work prerequisite holds are distinguished without extra model calls. Sidebar trailing/hover indicators now render only for active-team participants, including membership in another still-active team; unrelated and retired-only sessions show no plugin dot or dash. Native leading status remains untouched.


Coordinates independently created native Sessions, retaining their own conversations, presets, working directories, tools and permissions. V5 adds record-first direct peer flow, selective bounded automatic wake-up, conversational **With user**, work-specific waiting, retirement and small colored sidebar/profile dots. It does not create replacement Sessions, proxy approvals or grant native execution permissions.

## Normal use

Choose existing native Sessions in the unchanged landing-page Team setup: one manager dropdown, nested workspace members, direct-only binary workspace checkboxes. Blank-session filtering uses native metadata, never a title blacklist. Setup remains hidden inside a selected profile. The existing objective → member cards → proposals → current reports → Details & History layout is retained.

Give the manager an outcome. Record one stable short objective, identities, responsibilities and useful assignments—not a step-by-step script unless necessary. Reports are trustworthy normal evidence; the manager need not reopen every artifact. Ask the worker a specific question or use a focused native subagent check when there is an actual uncertainty. Native subagents are welcome for both manager and workers; their parent retains the team's responsibility and publishes useful results. Helpers do not automatically become team members or agree on somebody else's behalf.

The manager's ordinary role is coordination, not a synthetic self-task. Detailed setup reads, todo bookkeeping, in-progress writes and final manager reports are optional. A compact profile already supplies bounded worker setup facts. Unknown capabilities stay unknown; registered Tools are not guaranteed admitted, and an ask policy does not promise a human answerer. The executing worker requests its own exact native permission.

## Direct cooperation and waiting

`message` records a current teammate exchange before delivery: information, request, reply, handoff or alert. All meaningful peer exchanges remain retrievable by the manager. Informational records do not automatically cost a manager model turn.

A request may explicitly reference `blockingAssignment` with the requester's exact own assignment revision/version. Only that actual work enters Waiting. A reply refers to the exact request. It releases only the same still-applicable task, and only when its other recorded blockers are resolved. Optional questions and unrelated proposal votes do not freeze file work or an entire session. Replacement instructions and explicit manager status changes do not inherit old blocking provenance.

Manager assignment entries can use `afterSessionId`, binding the predecessor's exact current assignment at commit. The predecessor's successful `finish-assignment` directly releases ordinary bound downstream dependency waits and records a handoff. If other explicit, unresolved or ambiguous prerequisites remain, it instead preserves Waiting and delivers that handoff for reassessment. The next worker uses the report and its own acceptance criteria; the manager need not inspect/relay each intermediate stage. This cannot override a manager-reserved release or arbitrary waiting instruction. General working exceptions remain concise plain-language exceptionalRules, not another scope/permission matrix.

Default team automation is enabled for fresh actionable records. `update-work` may change automation; the profile's automation action lets the owner pause/resume it. Native permission/approval remains unchanged.

## Wake-up defaults and limits

Automatic delivery considers new ready assignments, required peer requests/replies/handoffs, exact proposal responses, manager decisions needing handling, final relevant completion and explicit alerts. Intermediate completion with a direct downstream handoff does not routinely wake the manager. Reads, acknowledgments, optional information and record-only decisions do not create wake loops. Native running/idle changes only reconsider existing pending intent; they do not create new business work.

The outbox and business event are one durable atomic state. Wakes are grouped by recipient. Busy Sessions, queued native input, pending native interactions and With user are held rather than interrupted. Cold ordinary Sessions resume through the native Session controller, which restores their recorded preset/model/cwd rather than borrowing the manager's configuration. The producer uses a distinct non-user message source.

Admission uses native true-idle maintenance: append input, require native flush acknowledgment, recheck current work/tenure/epoch/focus, settle its receipt, then release the loop. If a user arrives during this window, remove only this producer's still-pending input, persist the removal and defer its outbox entry. Human input stays intact. Native input durability is not model understanding, task completion or agreement. The design is at-most-once on ambiguity, not a distributed exactly-once promise.

A failed/uncertain delivery creates a visible intervention record instead of blindly retrying a possibly executed task. A configurable `maxAutomaticWakesPerBurst` defaults to 24 per team between direct user interactions, preventing unlimited autonomous ping-pong; reaching it fails further delivery visibly. Explicit user hand-back can resume still-applicable own work. Native maintenance contention gets bounded one-shot idle watches, not model polling. No native approval is requested as a capability probe.

## Conversational With user

Actual direct user input (including native retry) to a known team Session immediately latches a session-wide hold across its teams and durably records the exact input ID. No focus toggle. The current agent is instructed to prioritize that user conversation and defer unsolicited team work; incoming coordination stays in the ledger, not injected into a running user discussion.

When the user clearly hands back—“continue with the team,” for example—the session calls `set-user-focus` with its exact latest `expectedUserMessageId`. Another session cannot release it. Silence, switching tabs or finishing a reply is not hand-back. Explicit reads/replies/subagent use for the user's task remain allowed. With user survives restart. Previously known inactive members can release their own focus without acquiring general retired-team mutation authority.

Focus does not silently cancel an already-running tool or native turn. Use native Stop for immediate interruption. It controls this plugin's team delivery, not unrelated native automation or all built-in subagent notifications. Leaving focus neither answers a request nor casts a vote; dependents resume only after the actual needed information/decision arrives.

## Manager proposals and local guards

Manager-originated `propose`/`propose-identity` may include exact `concernedIds` and explicit `ownResponse:'agree'` to create confirmed revision1 and the manager's own vote atomically. A worker's suggestion remains a draft. `revise-proposal` can also include explicit own agreement. Current responses, missing responses, readiness and decision appear in compact reads/receipts, avoiding ceremonial revision2 and repeated full-history inspections. Concerned-party explicit current-tenure unanimity and final acceptance remain; silence/conditional agreement is not consent, material changes invalidate votes.

The internal global serial is not an agent work guard. Manager planning uses expectedPlanVersion; task writes use assignmentRevision/assignmentVersion, report corrections their own version, proposal edits their own revision. Reuse receipts; no ritual profile rereads. Optional explicit acknowledgment can accompany work/report/finish/message/vote. Reading never acknowledges. `set-objective` deliberately changes the mission; routine handoffs cannot rewrite it. Correcting an old report preserves its previous assignment association by default.

## Retirement and reopening

The selected team header exposes **Retire team** through one concise owner preview/apply confirmation. The manager can also retire its own team as an ordinary management action, without unanimous permission or a compulsory closeout report. Workers cannot retire it unilaterally.

Retirement releases active links, withdraws current assignments without claiming completion, closes pending proposal/request applicability and cancels old wake intent. Records, accepted decisions, identities and roster history remain. Native Sessions are not archived, deleted or stopped; other teams are unaffected. Running member sessions are mentioned in the UI confirmation when known.

A narrow in-memory permit captures the exact already-running native agent/task at retirement. It may save one final factual result as historical evidence, including a blocked outcome, while that same native run remains active. It cannot execute fresh team commands or revive work; the permit ends at idle/disposal. No general historical write capability is granted.

Retired teams live in a collapsed section. Their profile and lazy Details & History remain readable. **Reopen team** routes to the same owner Team setup for a fresh roster confirmation. New epoch/tenures and fresh assignments prevent replay of old tasks, votes, requests or notifications. Old objectives/responsibilities are historical reference, not automatic new work.

## Clean primary states

A single small solid round 7px coordination dot uses the same shape for Needs intervention(deep red), Approval needed(red), With user(purple), Running(blue), Waiting(orange), Complete(green), Idle(gray). Missing/unavailable falls back to a neutral dash. Actual pending native approval is distinct from merely restrictive policy. Native questions/plan review needing the user show intervention. Required information can cause Waiting; an optional question cannot.

State precedence is unavailable fallback, intervention, actual native approval, With user, running, actual work waiting, completed current work, idle. Team profile and sidebar share the primary-state function. Tooltip/hover content identifies state/reason; no permanent explanatory row text or focus switches.

The live native sidebar offers an added trailing-icon and hover-card extension. Its existing hardcoded leading status marker remains; V5 does not hide it with CSS or replace the sidebar. Native trailing icons hide while hover actions are shown, with explanation in the hover card. One apply-scoped event-driven long-poll shares small cached coordination facts across all rows; native running/interaction facts come from the native selector. Rendering never binds, loads or starts a Session. Long-poll is a held cache read, not model polling or per-row history/environment scans.

## Data, migration and restart

The physical hot domain remains `session_teams_v2` version2; inner schema6. Exact validated schema2/3/4/5 originals and existing hot backups are durably copied/verified under content-addressed keys in `session_teams_backups` version1 per-record **before** upgrade or hot backup removal. Earlier source packages stay untouched. There is no full-state snapshot per serial or distributed per-session transaction layer.

Business histories remain one atomic aggregate; meaningful writes still rewrite its native JSON unit. Native running/idle/loaded observations are ephemeral. Native archive latches remain durable; unarchive never rejoins or resumes old work. Cold setup uses unchanged-revision cache reuse but fully rebuilds committed facts from sequence0 on any changed opaque revision.

Startup advances generation/plan versions, invalidates inherited work/consent, closes old requests/cancels old pending/claimed wakes, and holds inherited active teams for explicit owner review. **Review does not resume old assignments.** Persisted producer inputs are stripped during native Agent creation; human input is preserved. No historical task is automatically replayed.

## Verification boundary

Focused reused pure/controller tests plus actual installed Native services, JSONL, loader/presets and public controller are exercised with deterministic scripted models and workspace-only test data. Those automated fixtures use no external model, live Desktop write or test-created user-profile team. Separate real-model manual scenarios subsequently exercised the documented acceptance flow, including a respected Desktop sandbox denial. Distribution and relocated actual runtime resolver checks validate portable shared imports. Live Host/Client registration is not a rendered browser, accessibility or color acceptance test. See [verification and limits](VERIFICATION.md).
