# Security and privacy

## Supported target

0.6.0 is declared for DSH 0.2.2-rc.5. Other DSH releases and operating systems beyond the documented verification environment are unverified. Do not bypass DSH compatibility guards to install it on an unsupported runtime.

## Trust boundaries

- Team agents are trusted collaborators, not mutually hostile tenants. A manager attests that a fresh actual user message approves the exact prepared plan. `approved:true` is semantic attestation, not an adversarial-proof natural-language consent verifier.
- Native DSH owner and live-Agent identity checks gate commands. Native sandbox/approval policies remain authoritative. A plan, proposal vote, peer report or wake notice grants no filesystem or tool permission.
- Current immediate teammates can query full team records, including pre-join history and peer messages addressed to another member. Recorded/observed setup may reveal cwd, workspace/writable-root paths, preset identity and registered tool names. A registered tool does not establish executable permission.
- History and migration backups are retained by DSH storage. Retirement, removal and Git cleanup are not secure deletion or a documented retention policy.
- Teammate text and artifact references can influence model behavior. Treat untrusted external text as data, not instructions. Review who joins a team; do not coordinate confidential adversaries in one team.
- Same-profile Host plugins and the local machine owner are trusted by the DSH runtime. This plugin does not create isolation from them.

## Data flow

The plugin has no external HTTP client or telemetry endpoint. Its Host–Client traffic uses DSH's connection. Coordination excerpts and context become part of participating Sessions' normal model requests, which may leave the machine for the configured provider. Do not put credentials, secrets or private information you cannot share with those providers in team records.

The installable archive contains code, metadata, icons, locale data and essential documentation only. It contains no live ledger, Session history, credentials or original cost exports. Tests use synthetic data and their generated runtime/results are ignored by Git and excluded from the installable archive.

## Local development material

`.local-dev/`, root `AGENTS.md`/`CLAUDE.md`, generated results and environment files are ignored. This is an accidental-publication guard, not access control: forced staging or manually archiving the whole checkout can disclose them. Build with the release script and inspect staged content before pushing. Never commit private keys or tokens, even to a private repository.

## Reporting a vulnerability

Do not open a public issue containing secrets, private Session text or an unredacted exploit against a live user. Use the repository's private vulnerability-reporting option if GitHub offers it. If unavailable, open a minimal issue requesting a private reporting channel without disclosing the vulnerability details. No private contact address or guaranteed response time is currently promised.

## Review limits

Source review and synthetic regressions reduce risk; they are not a penetration test or proof of security. Delivery admitted/sent is not evidence of understanding, execution or completion. Native admission is designed to avoid duplicate execution on ambiguity, not to promise distributed exactly-once processing. See `docs/VERIFICATION.md` for the supported evidence and unexercised branches.
