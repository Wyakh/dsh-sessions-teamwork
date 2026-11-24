# Developer test suite

Run from a full source checkout with a compatible DeepSeek Harness Desktop runtime:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1 -Suite integration
```

The execution-policy flag applies only to that child process; it does not change Windows policy. The runner uses `DSH_NODE_EXECUTABLE` and `DSH_INSTALL_DIR`, or explicit `-NodeExecutable` / `-InstallDir` parameters. `-SharedNodePath` overrides the Desktop shared-module lookup path if the installation layout differs. The runtime must provide the exact DSH 0.2.2-rc.5 services and shared peer versions declared by the package. The fixture verifies Electron's Node mode; standalone Node alone is not sufficient. Only Windows Desktop execution has been verified.

## Inventory

| Suite | Checks | Scope |
| --- | ---: | --- |
| core | 78 | Pure state machine, guards, migration and reassessment |
| ui | 72 | Pure Client helpers/controllers and source contracts; no rendered browser |
| integration | 26 | Production adapter/wake through isolated real DSH services and scripted models |
| wake-native | 8 | Low-level Native admission/lifecycle wrapper, distinct from production integration |
| boundary | 3 | Cached owner status, focus retirement, wake burst bounds |
| package | 10 | Current manifest/resources, frozen runtime hashes, syntax and bounded evidence |
| resolution | 1 | Relocated package shares installed DSH runtime modules without NODE_PATH |
| **Total** | **198** | No external-model or live-profile installation acceptance |

The count is a regression inventory, not a claim that all old historical-tree assertions are identical. The port preserves the 188 non-package groups; the core's one old sibling-file comparison now checks a pinned digest instead. Ten package groups replace assertions about obsolete sibling development trees with pinned V0.5.2 runtime hashes and current V0.6 distribution contracts. Historical assertions that prior sibling trees remain unchanged are intentionally no longer applicable to this standalone repository. Baseline digests were copied from V0.5.2 build evidence, not generated from the new runtime after modification. Runtime modules must remain byte-identical for this packaging-only release; release metadata and public documentation may change.

## Isolation and output

Each suite runs in a fresh process. Test storage, temporary homes, generated native session records and domain fixtures live only beneath ignored `tests/.runtime`; reports live beneath ignored `tests/.results`. Native fixtures reject JS filesystem mutations outside those owned paths and reject network requests. They mount isolated Cordis compositions, not the active profile loader or HTTP server. These are JavaScript test guards, not an OS security boundary. Synthetic `10-` identifiers deliberately remain to avoid perturbing protocol scenarios. Contract JSON inputs under `fixtures/contracts` are passive, synthetic data.

The runner checks fresh outputs, exact expected counts and nonzero exits before writing a summary; detailed reports may contain synthetic native message evidence and local diagnostic paths and should not be published wholesale. Nothing here reads real user trajectories or billing exports. No profile reinstall, external model call or replacement web server is needed.

## Separate archive resolver gate

After a release process has installed a tgz into an isolated temporary project, point the resolver at its **actual installed package directory**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1 -Suite resolution -PackageRoot <installed-package-directory>
```

`TEAMWORK_PACKAGE_ROOT` is an equivalent environment override. It is permitted only with `-Suite resolution`, so this extra gate cannot silently replace the default relocated-source check in the 198-check run. The resolver directly reads the installed package rather than copying source files, disables `NODE_PATH`, checks shared peer identity, mounts the Host service and exercises owner setup and a participant Tool. All fixture writes remain under `tests/.runtime`.

This yields separate `resolution-archive.json` and `resolution-archive-summary.json` outputs. It still uses an isolated synthetic linked-root registration in the actual DSH resolver: it is not an installation into the user's current profile, GUI rendering acceptance or real-model validation. The caller is responsible for establishing that the supplied directory came from the actual tgz installation.
