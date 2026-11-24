# DSH Session teams

Coordinate existing, independent DeepSeek Harness Sessions without replacing their conversations, presets, models, working directories or native permissions.

**Version 0.6.0 · MIT · DSH 0.2.2-rc.5 only**

This is the release-organized form of the tested 0.5.2 implementation. Runtime JavaScript, internal service/package identities and schema 6 are preserved. It is a native Host + Web Client bundle, not a separate server or another agent framework.

## Install

1. Use **DSH 0.2.2-rc.5**, with its supplied runtime (Node >=24.9.0).
2. Download or clone this repository. In DSH **Plugins → Add plugin**, install the absolute path to the versioned archive under `release/`:
   `session-coordination-0.6.0.tgz`.
3. Follow DSH's installation result. Restart DSH when required; refresh its existing Web GUI after the restart. Do not start a separate Web server.
4. Open **Session teams** in the sidebar, select an existing manager and workers, and confirm the team setup.

No `npm install`, Python, MCP server, API key or separate database server is required for the plugin. DSH supplies the exact shared peers. This GitHub-only package is deliberately `private:true` to prevent accidental npm publication; local archive installation is supported.

See [installation, moving and recovery](docs/INSTALL.md) before upgrading an existing team.

## Use

Give the manager an outcome and acceptance criteria. It presents a reviewed dispatch, including expected native permission needs. Approve that exact plan and explicitly return to automatic coordination, for example:

> Approved. Start the reviewed plan and return to automatic team coordination. Report completion or anything that genuinely needs my decision.

Workers exchange evidence directly. A relevant decision, required reply or handoff can notify a waiting worker **to reassess**, not authorize it to ignore remaining prerequisites. Reports are normally trusted; ritual artifact re-reading and manager relay are unnecessary. Helpers remain the responsibility of their parent Session.

### After a user interruption

> After a user interruption, remain With user until the user clearly asks you to resume team coordination; then release your own hold using the latest actual user message ID before waiting for team updates. If intent is unclear, ask once whether to resume—never infer hand-back from silence or the end of a reply.

With user holds incoming team automation, not tools already running. Use native Stop when immediate interruption is needed.

## Trust and privacy

A team is a **sharing boundary, not a confidential messaging boundary**. Current immediate teammates can read team history (including history from before they joined), addressed peer exchanges and observed peer setup such as workspace paths and registered tools. Use only trusted teammates and do not place secrets in coordination text. Native permissions still govern each worker's execution; plan confirmation does not grant those permissions.

The plugin itself has no external telemetry or external HTTP client. Coordination text is sent to the model providers selected for the participating Sessions as part of normal DSH requests. History and migration backups are retained locally by DSH; retiring a team is not deletion. See [security and privacy](SECURITY.md).

## Documentation

- [Installation and recovery](docs/INSTALL.md)
- [Behavior, waiting and lifecycle](docs/BEHAVIOR.md)
- [Verification and known limits](docs/VERIFICATION.md)
- [Release notes](CHANGELOG.md)
- [Security policy and trust model](SECURITY.md)

## Repository and package

Runtime source is at the repository root (`index.js`, `client.cjs`, `lib/`, `locale/`). `tests/` contains synthetic verification code and examples; `scripts/` contains test/release tooling. These are not required for ordinary archive installation. `release/` contains the installable archive and SHA-256 manifest.

A clone may be moved as a normal Git repository. Install the archive rather than linking the source directory when you want runtime independence from the checkout's location. See the exact relocation verification limits in the installation guide.

The ignored `.local-dev/` directory is reserved for local-only handoff notes and private manual work. It is not in the installation archive or Git history. Do not publish a whole-folder ZIP from your personal checkout; use the supplied archive or a Git-generated source archive. Git ignore rules are not encryption and `git add -f` can override them.

## Development checks

From a DSH Desktop environment on Windows, use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1`. The runner uses `DSH_NODE_EXECUTABLE` and `DSH_INSTALL_DIR` from that installation; generated fixtures/results are ignored. It never resumes user Sessions or installs into the live profile. See [verification](docs/VERIFICATION.md) for scope and limitations.

To rebuild or check the deterministic archive from the source repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Check
```

These use `DSH_NODE_EXECUTABLE`, or an explicit `-NodeExecutable` pointing to Node >=24.9.0. No dependency installation is needed. Git attributes preserve tested source bytes; do not bulk-normalize historical runtime line endings. The archive contains only the explicit runtime/document allowlist, not the repository's tests, build scripts or private material.

## License

[MIT](LICENSE), Copyright (c) 2026 Wyakh. DSH and its shared dependencies retain their own licenses; they are not bundled into this archive.
