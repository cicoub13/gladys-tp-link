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

## Why you must enter IP addresses

The integration runs in a **sandboxed container**. From there it can reach a
device by **unicast** (a known IP address), but it cannot receive the UDP
broadcast responses that classic Kasa auto-discovery relies on. So the only
discovery path is the **configured IP list**.

Give your Kasa devices a **DHCP reservation** on your router so their IP address
stays stable.

## Configuration

1. Open the **Configuration** tab of the integration.
2. In **Device IP addresses**, enter your devices' IPs, separated by commas or
   spaces (for example `192.168.1.20, 192.168.1.21`).
3. Choose a **Refresh interval** — how often each device is polled to refresh
   its state (default: every minute).
4. Save.
5. Open the **Discovery** tab and click **scan**: each configured IP is probed
   and reachable devices appear.
6. Click **create** on the ones you want. They land in the **Devices** tab with
   an On/Off control.

## Actions

- **Test a device by IP** — enter an IP address and the integration performs a
  live unicast probe, confirming the device is reachable from the container
  before you add its IP to the configuration.

## Troubleshooting

- **A device does not appear on scan.** Confirm its IP with the **Test a device
  by IP** action. If the test fails, the container cannot reach that IP — check
  the address, the DHCP reservation, and that the device is on the same network.
- **A device appears but never changes state.** Its firmware may only speak the
  newer KLAP protocol, which is not supported.
- **Need more detail?** The integration logs everything it does. Check the
  integration logs from the Gladys UI (or `docker logs` on the host) with
  `LOG_LEVEL=debug` for the full detail.
