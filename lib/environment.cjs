'use strict';

// Observation only: never resolve Tool activation callbacks, acquire an Agent or
// probe approval. Registration names are NOT a step's admitted/executable tools.
const MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const POLICIES = new Set(['ask', 'never']);
const PAGE = 512, MAX_SCAN = 65536, MAX_CACHE = 128;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0') ? value : null;
const names = values => [...new Set(values.map(text).filter(Boolean))].sort();
const clone = value => JSON.parse(JSON.stringify(value));
function service(ctx, name) {
  if (!ctx) return undefined;
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
}
function blank(id, state = 'unknown') {
  return { id, state, loaded: state === 'loaded', preset: { id: null, source: 'unknown' },
    workingDirectory: null, workspaceBoundary: null,
    sandbox: { mode: null, source: 'unknown' },
    approval: { policy: null, availability: 'unknown', source: 'unknown' },
    tools: { kind: 'unknown', names: [] }, evidence: [], unknownMarkers: [] };
}
function abort(signal) { if (signal?.aborted) { const error = new Error('Environment read aborted'); error.name = 'AbortError'; throw error; } }
function apply(facts, event) {
  switch (event.type) {
    case 'agent-preset/selected': facts.preset = text(event.data?.agentPreset); break;
    case 'working-directory/change': facts.cwd = text(event.data?.cwd); break;
    case 'sandbox/mode': facts.mode = MODES.has(event.data?.mode) ? event.data.mode : null; break;
    case 'approval/policy': facts.policy = POLICIES.has(event.data?.policy) ? event.data.policy : null; break;
  }
}

function createEnvironmentReader(ctx) {
  const cache = new Map();
  let disposed = false;
  function save(id, value) {
    cache.delete(id); cache.set(id, value);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  }
  function live(worker, id) {
    const result = blank(id, 'loaded'), session = worker.session;
    const attempt = (key, fn) => { try { fn(); } catch { result.unknownMarkers.push(`${key}-read-failed`); } };
    let presets;
    attempt('preset', () => {
      presets = service(ctx, 'agentPresets');
      const composed = worker.ctx && presets?.composedPreset?.(worker.ctx);
      const recorded = composed == null ? presets?.presetForSession?.(session) : undefined;
      result.preset = { id: text(composed ?? recorded), source: composed != null ? 'live-composition' : recorded != null ? 'committed-session' : 'unknown' };
      if (result.preset.id) result.evidence.push('preset-safe-getter');
    });
    // Resolve inside the WORKER composition, never the inspecting manager's.
    const own = name => presets?.serviceFor?.(worker, name) ?? service(worker.ctx, name);
    attempt('working-directory', () => {
      result.workingDirectory = text(own('workingDirectory')?.get(session));
      if (result.workingDirectory) result.evidence.push('working-directory-safe-getter');
    });
    result.workspaceBoundary = text(session?.header?.cwd);
    attempt('sandbox', () => {
      const policy = own('sandboxPolicy')?.resolve({ session });
      if (!policy) return;
      result.sandbox = { mode: MODES.has(policy.mode) ? policy.mode : null, source: 'live-policy' };
      result.workspaceBoundary = text(policy.workspaceRoot) ?? result.workspaceBoundary;
      if (Array.isArray(policy.additionalWritableRoots)) result.sandbox.writableRoots = names(policy.additionalWritableRoots).slice(0, 64);
      result.evidence.push('sandbox-safe-getter');
    });
    attempt('approval', () => {
      const approval = own('approval');
      if (!approval) return;
      const policy = approval.overrideOf(session) ?? approval.config?.policy ?? 'ask';
      if (!POLICIES.has(policy)) return;
      result.approval = { policy, availability: policy === 'never' ? 'disabled' : 'unknown', source: 'live-policy' };
      result.evidence.push('approval-safe-getter');
    });
    attempt('tools', () => {
      const tools = own('tools');
      // definitions() does not clone full schemas and does not execute `when`.
      const definitions = typeof tools?.definitions === 'function' ? tools.definitions(worker) : tools?.schemas?.(worker);
      if (!Array.isArray(definitions)) return;
      const registered = names(definitions.map(definition => definition.name));
      result.tools = { kind: 'registered', names: registered, conditional: true };
      result.evidence.push('registered-tools-not-admission');
    });
    return result;
  }
  async function cold(id, signal) {
    const result = blank(id, 'cold');
    const persistence = service(ctx, 'sessionPersistence');
    if (!persistence?.stat || !persistence?.open) {
      result.unknownMarkers.push('cold-persistence-unavailable'); return result;
    }
    // Cache WARNING: a projection checkpoint/header alone is not freshness.
    // Each reuse validates the public backend identity AND opaque stat revision.
    // No cached result is returned when validation fails, including retries.
    const before = await persistence.stat(id, { signal }); abort(signal);
    if (!before || before.formatStatus === 'migration-required' || before.header?.id !== id || before.revision == null || persistence.identity == null) {
      cache.delete(id); result.unknownMarkers.push('cold-freshness-unverified'); return result;
    }
    const headerKey = JSON.stringify([before.header.id, before.header.createdAt, before.header.cwd, before.header.agentPreset]);
    let entry = cache.get(id);
    if (entry?.identity !== persistence.identity || entry?.headerKey !== headerKey || (Number.isInteger(before.eventCount) && before.eventCount < entry.seq)) entry = undefined;
    if (!entry || entry.revision !== before.revision) {
      // Unequal opaque revisions certify NOTHING about the previous prefix.
      // Rebuild even for an equal/greater eventCount and unchanged header: a
      // backend can replace/rewind a log. Only equal revisions permit reuse.
      entry = undefined;
      let handle;
      try {
        handle = await persistence.open(id, 'read', { signal }); abort(signal);
        if (JSON.stringify([handle.header?.id, handle.header?.createdAt, handle.header?.cwd, handle.header?.agentPreset]) !== headerKey) throw new Error('Header changed');
        const facts = { preset: text(handle.header.agentPreset), cwd: text(handle.header.cwd), boundary: text(handle.header.cwd), mode: null, policy: null };
        let seq = 0, scanned = 0;
        while (true) {
          abort(signal);
          const page = await handle.read(seq, PAGE, { signal });
          if (!Array.isArray(page.events) || page.events.length > PAGE) throw new Error('Invalid page');
          for (const event of page.events) {
            if (event.seq !== seq++) throw new Error('Noncontiguous log');
            apply(facts, event);
          }
          scanned += page.events.length;
          if (page.events.length < PAGE) break;
          if (scanned >= MAX_SCAN) throw new Error('Scan bound');
        }
        await handle.close(); handle = undefined;
        const after = await persistence.stat(id, { signal }); abort(signal);
        if (!after || before.revision !== after.revision || (Number.isInteger(after.eventCount) && after.eventCount !== seq)) throw new Error('Log changed during observation');
        entry = { identity: persistence.identity, headerKey, revision: after.revision, seq, facts };
        if (!disposed) save(id, entry);
      } finally { if (handle) await handle.close(); }
    } else if (!disposed) save(id, entry);
    const facts = entry.facts;
    result.preset = { id: facts.preset, source: 'committed-log' };
    result.workingDirectory = facts.cwd; result.workspaceBoundary = facts.boundary;
    result.sandbox = { mode: facts.mode, source: facts.mode ? 'committed-log-override' : 'unknown' };
    result.approval = { policy: facts.policy, availability: facts.policy === 'never' ? 'disabled' : 'unknown', source: facts.policy ? 'committed-log-override' : 'unknown' };
    result.evidence.push('committed-log-revision-validated');
    result.unknownMarkers.push('cold-runtime-defaults-and-grants-unknown', 'cold-tool-registrations-unknown');
    return result;
  }
  return {
    async read(sessionId, { detail = false, signal } = {}) {
      const id = text(sessionId);
      if (!id) throw new TypeError('A nonempty session id is required');
      abort(signal);
      if (disposed) { const result = blank(id); result.unknownMarkers.push('reader-disposed'); return result; }
      let result;
      try {
        const worker = service(ctx, 'agents')?.get(id);
        if (worker?.session) { cache.delete(id); result = live(worker, id); }
        else result = await cold(id, signal);
      } catch (error) {
        cache.delete(id); abort(signal);
        result = blank(id); result.unknownMarkers.push('environment-read-failed', 'cold-freshness-unverified');
      }
      abort(signal);
      if (disposed) { result = blank(id); result.unknownMarkers.push('reader-disposed'); }
      if (!result.preset.id) result.unknownMarkers.push('preset-unknown');
      if (!result.workingDirectory) result.unknownMarkers.push('working-directory-unknown');
      if (!result.workspaceBoundary) result.unknownMarkers.push('workspace-boundary-unknown');
      if (!result.sandbox.mode) result.unknownMarkers.push('sandbox-mode-unknown');
      if (!result.approval.policy) result.unknownMarkers.push('approval-policy-unknown');
      if (result.approval.availability !== 'disabled') result.unknownMarkers.push('approval-channel-not-verified');
      if (result.tools.kind === 'registered') {
        const limit = detail ? 200 : 12;
        if (result.tools.names.length > limit) { result.tools.names = result.tools.names.slice(0, limit); result.tools.truncated = true; }
      }
      result.evidence = names(result.evidence); result.unknownMarkers = names(result.unknownMarkers);
      return clone(result);
    },
    dispose() { disposed = true; cache.clear(); },
  };
}
module.exports = { createEnvironmentReader };
