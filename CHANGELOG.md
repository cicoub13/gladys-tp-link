# Changelog

All notable changes to this integration are documented here. This project
follows [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [1.2.2] - 2026-08-14

### Removed

- **The `/data` volume ownership workaround.** The fix introduced in 1.2.1 is
  no longer needed — the underlying permission issue is now handled by Gladys
  Core.

## [1.2.1] - 2026-08-01

### Fixed

- **The data volume is now writable at runtime.** Declaring `/data` left its
  directory owned by root while the container runs as an unprivileged user,
  causing a permission error on the one location the image documents as
  writable. The directory is now created and owned by the runtime user.

## [1.2.0] - 2026-08-01

### Added

- **Unreachable devices are flagged in Gladys** and switch back to `local`
  automatically once they respond again.
- **Multi-outlet power strips (HS300, HS107, KP303, KP400) are detected and
  skipped** with a clear message, instead of appearing as a single switch that
  would turn the whole strip off at once.
- **Failures are logged**, and raw driver errors are turned into short,
  actionable messages before they reach the user.
- **Test coverage thresholds are enforced in CI**, which also runs on Node 20,
  22 and 24 and audits production dependencies.

### Changed

- **State is published only when it actually changes**, cutting redundant
  history rows, websocket events and trigger re-evaluations.
- **A command reports the state the device confirmed**, not merely the one
  requested, so a command that was not applied cannot show a false state.
- **A poll started before a command can no longer overwrite its result** and
  make the switch visibly flip back in the UI.
- **Commands respond faster** (2 s driver timeout), so they fit the
  acknowledgement window and requests stop piling up on unresponsive devices.
- **The Docker image always builds from the lockfile**, no longer falling back
  to `npm install`.

### Fixed

- **Scans always report their result.** A rate-limited scan (one every 10 s), a
  refused capture or a network error used to fail silently; the cause is now
  logged and shown through the connection status.
- **The right device is always controlled.** The serial number was stored but
  never verified, so after a DHCP lease change a poll or command could act on
  another device. Identity is now checked before every read and every command.
- **An invalid refresh interval now falls back to the 60-second default**
  instead of polling every second.
- **`'1'` as a string no longer turns a device off.** Values are coerced, and
  anything that is neither 0 nor 1 is rejected.
- **The release workflow no longer breaks CI** — the manifest is now formatted
  before committing.
- **The manifest declares the correct minimum Gladys version** (`>=4.84.0`).
- **The catalog cover is now a real PNG**, not a JPEG with a `.png` extension.

## [1.1.0] - 2026-07-23

### Added

- **Discovery without IP addresses.** The IP-list configuration is replaced by
  Gladys' mediated `udp-active-broadcast` scan: the integration finds Kasa
  devices on the local network automatically, with no address to enter.
- **User documentation** in English and French.

## [1.0.1] - 2026-07-22

### Fixed

- **Scanning now works out of the box.** The refresh interval was sent in the
  wrong unit, so Gladys silently rejected every discovered device and the
  Discovery tab stayed empty. The interval is now expressed correctly.

### Changed

- **The refresh interval is now a fixed set of choices** (1, 2, 10, 15, 30 or
  60 seconds) instead of a free number field.

[Unreleased]: https://github.com/cicoub13/gladys-tp-link/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/cicoub13/gladys-tp-link/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/cicoub13/gladys-tp-link/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/cicoub13/gladys-tp-link/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/cicoub13/gladys-tp-link/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/cicoub13/gladys-tp-link/releases/tag/v1.0.1
