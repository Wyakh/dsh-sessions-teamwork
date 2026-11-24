# Installation, moving and recovery

## Requirements

- DeepSeek Harness **0.2.2-rc.5**, with its Host and Web GUI services and supplied Node >=24.9.0.
- Verified on Windows Desktop. Other DSH versions/OS combinations are not claimed compatible.
- The shared peer versions in `package.json` must be supplied by that DSH installation. Optional-peer metadata avoids private duplicate dependency trees; it does not make imported packages unnecessary.

No external API key or additional server is configured by this plugin. Models, tools, presets and native permission policies remain those of each selected Session. No dependency install/build scripts are included.

## Install from the archive

1. Obtain the repository from GitHub or copy it to your computer. Git/SSH is only needed to clone/push, not to use the plugin.
2. Optionally verify the SHA-256 in `release/SHA256SUMS` against the archive. On Windows: `Get-FileHash -Algorithm SHA256 .\release\session-coordination-0.6.0.tgz`.
3. In DSH **Plugins → Add plugin**, enter the archive's absolute local path, such as `C:\path\to\dsh-sessions-teamwork\release\session-coordination-0.6.0.tgz`. Use DSH's native installer, not `npm install` in the profile and not hand edits to its package/patch files.
4. Inspect the native installation result. If activation is deferred or requires restart, restart DSH. Replacing an installed package needs a fresh module generation; refresh the existing GUI afterward.
5. Open **Session teams**, choose existing native Sessions, and confirm setup. Team setup confirmation and per-work dispatch confirmation are distinct.

Do not start a replacement Vite/Web server. This package uses the existing DSH GUI. Do not bypass an engine/version rejection or manually install duplicate DSH peers to force it to load.

## Moving the repository

The repository is an ordinary clone, not a linked Git worktree. Runtime files contain no build-machine installation path. All repository test/release paths are relative, with the DSH runtime selected through environment variables.

A **directory install links the source directory**: moving it can break that installation. Prefer the `.tgz` archive. An archive install materializes the runtime files under the installer's own package tree, so execution does not need the source checkout at its old location. The release verification covers an offline archive installation, removal of its original archive-source location by renaming, and native shared-runtime resolution. It does not simulate every DSH package-manager repair/update operation.

Package-manager metadata may retain the archive's original `file:` path for a later reinstall/repair. Keep a backup of the release archive; if a later operation cannot find it, select its current path again through DSH. This is not a promise that arbitrary profile directories themselves can be moved without native repair.

## Upgrade existing teams

1. Stop or finish active work deliberately; coordinate any pending approvals. Installing/upgrading is profile-wide, not limited to one Session.
2. Back up your DSH profile/storage and required Session data using your normal DSH backup procedure. A repository backup does not include live coordination data.
3. Install the new archive through Plugins. Preserve the existing technical package identity; do not install a renamed duplicate alongside it.
4. Restart when required. Startup review invalidates inherited work/consent and holds active teams for explicit owner review. Review does **not** restart old assignments.
5. Start genuinely new work through a new reviewed dispatch and fresh explicit user approval.

0.6.0 retains schema 6 and the 0.5.2 runtime implementation. Earlier schema 2–5 ledgers are validated and backed up before upgrade. Those backups are data-preservation measures, not a universal downgrade mechanism.

## Disable, rollback and recovery

- Pause team automation or disable the plugin through DSH when troubleshooting. Native Stop is required to interrupt an already-running tool; pausing coordination does not undo side effects.
- Retiring a team preserves records and does not delete/stop native Sessions.
- A failed or uncertain delivery needs factual inspection. Do not blindly retry work that might have executed.
- To roll back, first preserve the current profile/storage, then select the previously saved package via DSH. Only restore older data from a consistent backup if necessary and intentionally chosen. An older plugin may reject a newer schema; do not edit version fields or delete storage domains to force it to load.
- No one-click rollback, secure deletion, unlimited history retention policy or automatic crash replay is promised.

## What is not in the archive

User Sessions, coordination ledgers, credentials, raw cost exports, private handoff notes, generated test outputs and dependency implementations are excluded. Source-repository tests/examples are not needed for ordinary use and are available in a GitHub source download.
