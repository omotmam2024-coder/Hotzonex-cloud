# Onboarding a MikroTik router

## Requirements

- RouterOS **v7** (WireGuard is built in). The script refuses to run on v6.
- The router has internet access (Starlink or any uplink). No public IP and no
  port forwarding are needed — the router dials out.
- Someone on site (or remotely via WinBox) who can paste into the router terminal.
- For a **hotspot**: a hotspot server already configured on the router
  (IP → Hotspot → Hotspot Setup). Hotzonex discovers it; it does not create one.

## The wizard, step by step

1. **Router details** — name and API protocol. Keep **API (8728)**: traffic
   already runs inside the encrypted tunnel, and no certificate is needed.
   Hotzonex assigns the router a tunnel address such as `10.77.0.5`.
2. **Connect router** — Hotzonex generates a strong password for a restricted API
   user, encrypts it in your browser to the connector's key, and shows a one-time
   script. Copy it, open **WinBox → New Terminal**, paste, press Enter. The last
   line printed looks like:

   ```
   HOTZONEX-WG-PUBLIC-KEY=kA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=
   ```

   Paste that line back into the wizard. Within ~15 seconds the tunnel shows
   **"Tunnel is up — last handshake …"**.
3. **Test connection** — the connector logs in over the tunnel and reads identity,
   version, board, CPU, memory and uptime. **Test permissions** checks that the API
   user can do exactly what Hotzonex needs, and flags extra rights.
4. **Discover** — reads interfaces, hotspot servers and hotspot user profiles.
   Read-only: nothing on the router changes.
5. **Hotspot** — pick the hotspot server and default user profile Hotzonex will
   use (for user management in a later release). You can skip and choose later.
6. **Location** — assign the site.
7. **Finish** — health polling starts (every 5 minutes by default).

You can leave at any point; "Resume onboarding" on the router page continues
where you stopped. If you lost the script, go back to *Connect router* and
generate a new password — running the script again updates the existing user.

## What the script does

| Step | RouterOS change | Why |
|---|---|---|
| Version check | none | Stops on RouterOS v6 |
| `/interface wireguard add name=hotzonex-wg` | New interface; the router generates its own private key | The private key never leaves the router |
| `/interface wireguard peers add … persistent-keepalive=25s` | Peer = Hotzonex VPS, allowed address `10.77.0.1/32` | Keepalive holds the Starlink CGNAT mapping open |
| `/ip address add address=10.77.0.x/32 network=10.77.0.1` | Point-to-point tunnel address | Does not touch LAN addressing |
| `/ip firewall filter add chain=input … src-address=10.77.0.1 dst-port=8728 place-before=…` | Accept API only from the connector, only via the tunnel, above any drop rules | Default configs drop input from non-LAN interfaces |
| `/ip service set api … address=10.77.0.1/32` | API reachable only from the connector | If LAN tools also use the API, add their subnet to `address=` |
| `/user group add name=hotzonex-api policy=read,write,api,test` | Restricted group — no `policy`, `ftp`, `ssh`, `winbox`, `reboot`, `sensitive` | Hotzonex never needs admin rights (`write` is for Phase 2 hotspot users) |
| `/user add name=hotzonex-api … address=10.77.0.1/32` | API user that can log in only from the tunnel | Never hand over the admin account |
| `:put HOTZONEX-WG-PUBLIC-KEY=…` | none | Public key for the wizard |

Every `add` is guarded by a `find`, so running the script twice updates instead of
duplicating. REST mode uses the `rest-api` policy instead of `api` and leaves
WebFig access unchanged.

## Troubleshooting

| Result | Meaning | Fix |
|---|---|---|
| Router unreachable — "not completed a WireGuard handshake" | The tunnel never came up | Check the router has internet; `/interface wireguard peers print` shows the endpoint; the VPS allows UDP 51820 |
| Router unreachable (after it worked before) | Router off or link down | Wait; Hotzonex retries automatically |
| API port blocked | Tunnel up, API dropped by the router firewall | Move "Hotzonex Cloud API via tunnel" to the top of `/ip firewall filter` |
| API service refused the connection | API disabled or restricted elsewhere | `/ip service print` — enable `api`, include `10.77.0.1` in `address` |
| Login rejected | Wrong password | Re-run the script, or Replace credentials |
| Not enough permissions | Group lacks a policy | Run *Test permissions*; re-run the script |
| Secure connection failed | api-ssl/HTTPS without a usable certificate | Switch to API (8728) |
| Router did not understand the request | RouterOS too old or package missing | Upgrade to current v7 stable |

## Removing a router

Delete it in Hotzonex (admins only). This removes Hotzonex's records; to disconnect
the router itself, remove `hotzonex-wg`, the `Hotzonex Cloud API via tunnel` rule,
and the `hotzonex-api` user and group on the router.
