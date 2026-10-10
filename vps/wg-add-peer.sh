#!/usr/bin/env bash
# Add a MikroTik router as a WireGuard peer on the Hotzonex Cloud VPS.
# Usage: sudo ./wg-add-peer.sh <router-public-key> <tunnel-ip>   e.g. 10.99.0.12
set -euo pipefail

IFACE="${WG_IFACE:-wg0}"
PUB="${1:-}"
IP="${2:-}"

if [[ -z "$PUB" || -z "$IP" ]]; then
  echo "usage: sudo $0 <router-public-key> <tunnel-ip 10.99.0.2-254>" >&2
  exit 1
fi
if ! [[ "$IP" =~ ^10\.99\.0\.([2-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-4])$ ]]; then
  echo "tunnel IP must be in 10.99.0.2-10.99.0.254" >&2
  exit 1
fi
if wg show "$IFACE" allowed-ips | grep -q "$IP/32"; then
  echo "$IP is already assigned to another peer:" >&2
  wg show "$IFACE" allowed-ips | grep "$IP/32" >&2
  exit 1
fi

wg set "$IFACE" peer "$PUB" allowed-ips "$IP/32"
wg-quick save "$IFACE"

echo "Peer added on $IFACE for $IP"
echo "Waiting for handshake (router must be online)..."
for _ in $(seq 1 30); do
  HS="$(wg show "$IFACE" latest-handshakes | awk -v k="$PUB" '$1==k {print $2}')"
  if [[ -n "$HS" && "$HS" != "0" ]]; then echo "OK: handshake with $IP"; exit 0; fi
  sleep 2
done
echo "No handshake yet from $IP. Check the router's endpoint, the VPS public key and UDP 51820." >&2
exit 2
