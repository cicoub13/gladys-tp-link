# TP-Link Kasa — Gladys external integration

Control your **TP-Link Kasa** smart plugs, switches and bulbs from
[Gladys Assistant](https://gladysassistant.com), over your local network — as an
[external integration](https://gladysassistant.com) running in its own container.

It is a port of the built-in Gladys `tp-link` service to the external-integration
model built on the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
starting from the official
[integration template](https://github.com/GladysAssistant/integration-template-js).
Under the hood it uses the same driver as the core service,
[`tplink-smarthome-api`](https://github.com/plasticrake/tplink-smarthome-api).

## Supported devices

| TP-Link type (`sysinfo.type`)                        | Gladys device | Feature           |
| ---------------------------------------------------- | ------------- | ----------------- |
| `IOT.SMARTPLUGSWITCH`, `IOT.RANGEEXTENDER.SMARTPLUG` | Plug / switch | On/Off (`switch`) |
| `IOT.SMARTBULB`                                      | Bulb          | On/Off (`light`)  |

Other TP-Link types are detected during a scan and reported in the logs, but not
published (no controllable feature). This matches what the core service handles.

> **Local-only, legacy protocol.** Like the core service, this integration speaks
> the classic Kasa LAN protocol. Newer Kasa firmware that only exposes the
> encrypted KLAP protocol is not supported by `tplink-smarthome-api`.

## How discovery works (important)

The integration runs in a **sandboxed bridge-network container**. From there it
can reach a device by **unicast** (a known IP address), but it usually **cannot
receive the UDP broadcast responses** that classic Kasa auto-discovery relies on.

So there are two discovery paths:

1. **Configured IP list (recommended, reliable).** Enter your devices' IP
   addresses in the integration configuration (`Device IP addresses`). On a scan,
   each IP is probed by unicast and the device is published to the **Discovery**
   tab. Give your Kasa devices a DHCP reservation so their IP is stable.
2. **LAN broadcast (best-effort bonus).** If your deployment gives the container
   access to LAN broadcasts (e.g. host networking), the `broadcast_discovery`
   option adds any device that answers the broadcast.

Use the **Test a device by IP** action button in the Configuration screen to
confirm a device is reachable from the container before adding its IP.

## Usage in Gladys

1. Install the integration (developer mode or from the catalog).
2. Open its **Configuration** tab, fill in `Device IP addresses`, save.
3. Open its **Discovery** tab and click **scan** — your devices appear.
4. Click **create** on the ones you want. They land in the **Devices** tab with
   an On/Off control, and are polled every `poll_frequency` seconds.

## Configuration

| Key                   | Type    | Default | Description                                                      |
| --------------------- | ------- | ------- | ---------------------------------------------------------------- |
| `device_ips`          | string  | `''`    | Comma / space separated list of device IP addresses.             |
| `poll_frequency`      | number  | `60`    | How often each device is polled, in seconds (10–3600).           |
| `broadcast_discovery` | boolean | `true`  | Also attempt a LAN UDP-broadcast scan (works only if reachable). |
| `discovery_timeout`   | number  | `5`     | Broadcast scan duration, in seconds (1–30).                      |

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no device logic)
├─ src/
│  ├─ config.js                      # config defaults, normalization, IP parsing
│  ├─ constants.js                   # external-id kinds, feature keys, param names
│  ├─ utils.js                       # mapLimit (bounded-concurrency probing)
│  ├─ discovery.js                   # scan: broadcast + IP probe -> discovery payloads
│  ├─ deviceLookup.js                # resolve a device's IP and ON/OFF feature
│  ├─ setValue.js                    # onSetValue: ON/OFF command
│  ├─ poll.js                        # onPoll: refresh state
│  ├─ actions.js                     # "Test a device by IP" manifest action
│  └─ tplink/
│     ├─ client.js                   # thin wrapper around tplink-smarthome-api
│     └─ model.js                    # sysinfo -> Gladys discovery payload
├─ gladys-assistant-integration.json # manifest (name, config schema, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ .github/workflows/                # CI + multi-arch build + UI-driven release
├─ test/                             # unit tests (node --test)
└─ cover.png                         # catalog cover, 800×534 px, ≤150 KB
```

## Develop locally

```bash
npm install

GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token-from-dev-install>" \
GLADYS_INTEGRATION_SELECTOR="tp-link" \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # unit tests (node --test)
```

Validate the manifest/image/cover the way the store does, before tagging:

```bash
npx github:GladysAssistant/integration-store .
```

## Publish

1. Push this repo to GitHub and add the topic `gladys-assistant-integration`.
2. Replace `your-github-username` in `docker_image` and `cover_image`
   (`gladys-assistant-integration.json`) with your GitHub namespace.
3. **Actions → Release → Run workflow** (`patch` / `minor` / `major`): it bumps
   the version everywhere, tags `vX.Y.Z`, and publishes the multi-arch image
   (`linux/amd64` + `linux/arm64`) to `ghcr.io`. The decentralized indexer then
   offers a one-click install/update in Gladys.

> Replace `cover.png` with your own 800×534 px image (≤150 KB) before publishing;
> the bundled one is the template's gradient placeholder.

## License

Apache-2.0
