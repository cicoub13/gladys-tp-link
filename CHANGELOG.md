# Changelog

All notable changes to this integration are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **A failed scan is no longer silent.** `onScanRequest` is an unacked SDK
  event, so anything it threw was swallowed: a rate-limited scan (the core
  allows one every 10 seconds — double-clicking "scan" is enough), a refused
  capture or a network error left the user with no feedback and no log line at
  all. Failures are now logged and reported through `setConnectionStatus`, with
  a dedicated message per cause.
- **The wrong device could be controlled after a DHCP lease change.** The
  serial number was stored but never checked, so once an IP was reassigned a
  poll published another device's state and a command switched another device.
  The identity is now verified before every read and every command.
- **An unusable refresh interval fell back to 1 second instead of the default.**
  An empty or corrupted `poll_frequency` produced the chattiest frequency of the
  set — 60x the intended network, history and trigger load — because every
  comparison against `NaN` is false. It now falls back to 60 seconds.
- **`'1'` as a string turned the device off.** The requested value was compared
  strictly against the number `1`; it is now coerced, and anything that is
  neither 0 nor 1 is rejected instead of silently meaning OFF.
- **The release workflow broke the CI it depends on.** The manifest rewritten by
  `jq` did not match Prettier, so every release turned `main` red on its own
  formatting gate. The workflow now formats the manifest before committing.
- `gladys_version` corrected from `>=4.62.0` to `>=4.84.0`, the release that
  actually introduced external integrations and mediated discovery.
- `cover.png` was a JPEG file with a `.png` extension, which the store validator
  can reject. It is now a real PNG.

### Added

- Devices are flagged `unreachable` in the Gladys UI when they stop answering,
  and back to `local` when they recover.
- Multi-outlet strips (HS300, HS107, KP303, KP400) are detected and skipped with
  an explicit message. They announce themselves as ordinary plugs but keep their
  state in `children[]`, so they were published as a single switch that turned
  the whole strip off at once.
- Poll and command failures are logged, and the raw driver error — multi-line,
  with the protocol JSON in it — is replaced by a short actionable sentence
  before reaching the user.
- Coverage thresholds enforced in CI, which now also runs on Node 20, 22 and 24
  (the range `engines` declares) and audits production dependencies.
- A test that keeps the manifest and the code in sync: discovery port, accepted
  poll frequencies, default value and version.

### Changed

- States are published only when they actually change. Gladys does not
  deduplicate — every state writes a history row, broadcasts a websocket event
  and re-evaluates every trigger, against a budget of 300 states per minute.
- A command now publishes the state read back from the device rather than the
  one requested, so a frame acked but not applied cannot show a state Gladys
  never verified.
- A poll that started before a command can no longer overwrite the state that
  command published, which made the switch visibly flip back in the UI.
- The driver timeout is set to 2 s (it defaulted to 10 s, twice per command)
  so a command fits inside the 5 s ack window and requests stop piling up on an
  unreachable device.
- `Dockerfile` no longer falls back to `npm install` when `npm ci` fails, which
  silently discarded the lockfile.

## [1.1.0]

- Replaced the IP-list configuration with the mediated `udp-active-broadcast`
  scan: no IP address to enter, the core broadcasts on the integration's behalf.

## [1.0.1]

- Fixed a silent discovery failure: `poll_frequency` must be in milliseconds,
  from the closed set Gladys core accepts.

## [1.0.0]

- First release: TP-Link Kasa plugs, switches and bulbs, On/Off control over the
  local network.
