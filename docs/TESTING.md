# Source-repository testing

Tests/examples require the full repository, not only the installable runtime archive. They do not require real model credentials. Run on the declared DSH Desktop version; set `DSH_NODE_EXECUTABLE` to its Electron executable and `DSH_INSTALL_DIR` to its CLI package directory if not running from a DSH tool environment.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1
```

The runner redirects test storage/home/temp to ignored fixture locations. Scripted Native tests disable network and create synthetic Agents in an isolated composition. They do not load/resume live user Sessions or install into the profile. These are integration regressions, not proof of model understanding or GUI rendering.

## Manual acceptance scenarios

Use fresh test output folders in a chosen team workspace. Do not publish those outputs or Session histories; `.local-dev/` is reserved for private local work. Provide the manager the actual location of repository fixtures as needed; do not assume every teammate has the same cwd or permissions.

1. **Contract agreement and continuation:** Builder independently reads `tests/fixtures/contracts/producer-contract.json`; Tester independently reads `validator-contract.json`. Neither receives a manager pre-analysis. They discover the conflict, record justified agreement and directly hand off the actual payload and acceptance evidence. Preserve source inputs. An unassigned Reviewer stays idle.
2. **Parallel contribution and review:** Builder produces a tiny CSV summarizer/sample/usage note while Tester independently supplies tests. Reviewer requests one useful in-scope improvement, obtains the revision and validates the combined result. Builder retains responsibility through explicit acceptance. One bounded native helper may assist if available; its parent remains responsible. Do not manufacture a defect or require a helper when unavailable.
3. **Native restriction and fallback:** One worker attempts a harmless new Desktop sentinel only within an explicitly reviewed conditional plan. On denial or unavailable approval, the same worker stops outside attempts and writes a workspace-only fallback/explanation. No bypass, security change, alternate-session proxy or ritual retries. Denial, user refusal and unavailable approval are different observed causes.
4. **Retire/reopen/restart:** Finish current work, retire/reopen the team and inspect existing records read-only. Check preserved history and absence of current old assignments/wakes without claiming global absence of transient activity. Then create a genuinely fresh reviewed dispatch, obtain fresh user confirmation and deliver a new workspace greeting. Never reuse old consent as authority.

After each reviewed preview, a suitable actual user response is:

> Approved. Start the reviewed plan and return to automatic team coordination. Report completion or anything that genuinely needs my decision.

A prepared preview is not activation. User plan approval is not native operation approval. Sent is not read/understood/completed.

For retrospective reports, use existing records and factual worker reports. Separate direct observations from worker assertions; identify exact outcomes/artifacts, waits, interventions and unexercised branches. Do not repair/resume work or routinely reopen artifacts merely to produce the report. Do not estimate unavailable counts.

There is deliberately no dedicated user-interruption manual scenario. The two-sentence hand-back principle is in the README and behavior guide; low-level admission safety tests remain.
