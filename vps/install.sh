#!/usr/bin/env bash
# Hotzonex Cloud — one-shot VPS setup (Ubuntu 22.04/24.04 or Debian 12).
# Installs: WireGuard hub (10.99.0.1), Node 20, the router API as a systemd
# service, and Caddy for HTTPS.
#
# Usage (from the unzipped project folder, as root):
#   sudo API_DOMAIN=api.hotzonex.example bash vps/install.sh
#
# API_DOMAIN must already point (DNS A record) at this VPS so Caddy can get
# a certificate. Re-running is safe.
set -euo pipefail

API_DOMAIN="${API_DOMAIN:?set API_DOMAIN, e.g. API_DOMAIN=api.hotzonex.example}"
APP_DIR=/opt/hotzonex-router-api
TOOLS_DIR=/opt/hotzonex
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Packages"
apt-get update -y
apt-get install -y wireguard curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "==> WireGuard hub on 10.99.0.1/24, UDP 51820"
umask 077
if [[ ! -f /etc/wireguard/server.key ]]; then
  wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
fi
if [[ ! -f /etc/wireguard/wg0.conf ]]; then
  cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.99.0.1/24
ListenPort = 51820
PrivateKey = $(cat /etc/wireguard/server.key)
SaveConfig = true
EOF
fi
systemctl enable --now wg-quick@wg0
umask 022
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 51820/udp; ufw allow 80/tcp; ufw allow 443/tcp
fi

echo "==> Node.js 20"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Router API in $APP_DIR"
id hzapi >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" hzapi
mkdir -p "$APP_DIR"
cp -r "$HERE/router-api/." "$APP_DIR/"
chown -R hzapi:hzapi "$APP_DIR"
cd "$APP_DIR"
sudo -u hzapi npm install --omit=dev --no-audit --no-fund
if [[ ! -f .env ]]; then
  sudo -u hzapi cp .env.example .env
  KEY="$(sudo -u hzapi npm run -s genkey)"
  sed -i "s|^ROUTER_SECRET_KEY=.*|ROUTER_SECRET_KEY=$KEY|" .env
  chmod 600 .env
  echo "   Created $APP_DIR/.env with a fresh ROUTER_SECRET_KEY (back it up!)."
fi

echo "==> Peer helper in $TOOLS_DIR"
mkdir -p "$TOOLS_DIR"
install -m 755 "$HERE/vps/wg-add-peer.sh" "$TOOLS_DIR/wg-add-peer.sh"

echo "==> systemd service"
install -m 644 "$HERE/vps/hotzonex-router-api.service" /etc/systemd/system/hotzonex-router-api.service
systemctl daemon-reload
systemctl enable hotzonex-router-api

echo "==> Caddy (HTTPS for $API_DOMAIN)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
sed "s|api.example.com|$API_DOMAIN|" "$HERE/vps/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo
echo "============================================================"
echo " VPS WireGuard public key (paste into Hotzonex Cloud / Vercel"
echo " as VITE_VPS_WG_PUBLIC_KEY):"
echo "   $(cat /etc/wireguard/server.pub)"
echo
echo " Next:"
echo "  1. sudo nano $APP_DIR/.env   -> set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS"
echo "  2. sudo systemctl restart hotzonex-router-api"
echo "  3. curl https://$API_DOMAIN/health   -> {\"ok\":true}"
echo "  4. Open UDP 51820 and TCP 80/443 in your VPS provider's firewall"
echo "============================================================"
