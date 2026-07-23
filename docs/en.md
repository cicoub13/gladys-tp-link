# TP-Link Kasa

Control your **TP-Link Kasa** smart plugs, switches and bulbs from Gladys, over
your local network. The integration runs in its own container and talks to your
devices using the classic Kasa LAN protocol.

## Supported devices

| Device             | Feature           |
| ------------------ | ----------------- |
| Plugs and switches | On/Off (`switch`) |
| Bulbs              | On/Off (`light`)  |

Other TP-Link types are detected during a scan and reported in the logs, but
they are not published because they have no controllable feature yet.

> **Local-only, legacy protocol.** This integration speaks the classic Kasa LAN
> protocol. Newer Kasa firmware that only exposes the encrypted KLAP protocol is
> not supported.

## How discovery works

Kasa devices only answer an **active discovery probe**, and the integration runs
in a sandboxed container that cannot broadcast onto your LAN. So the scan is
**mediated by Gladys**: the integration forges the encrypted Kasa discovery
request, the Gladys core (which sits on your home network) broadcasts it, and
relays the devices' replies back. You do not enter any IP address — the scan
finds your devices, and the IP each one answered from is remembered to control
it afterwards.

Give your Kasa devices a **DHCP reservation** on your router so their IP address
stays stable; if it changes, a new scan picks up the new address automatically.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Choose a **Refresh interval** — how often each device is polled to refresh
   its state (default: every minute). Save.
3. Open the **Discovery** tab and click **scan**: your Kasa devices appear.
4. Click **create** on the ones you want. They land in the **Devices** tab with
   an On/Off control.

Run a scan again anytime you add a new device.

## Troubleshooting

- **A device does not appear on scan.** Make sure it is powered on and on the
  same network/subnet as your Gladys host, then scan again. Only classic-protocol
  Kasa devices answer (see below).
- **A device appears but never changes state.** Its firmware may only speak the
  newer KLAP protocol, which is not supported.
- **Need more detail?** The integration logs everything it does. Check the
  integration logs from the Gladys UI (or `docker logs` on the host) with
  `LOG_LEVEL=debug` for the full detail.
