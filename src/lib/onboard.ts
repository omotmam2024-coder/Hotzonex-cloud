/** Builds the RouterOS v7 onboarding script (mirrors mikrotik/onboard-router.rsc). */
export function buildOnboardScript(o: {
  vpsEndpoint: string; vpsPublicKey: string; tunnelIp: string; apiUser: string; apiPass: string;
}): string {
  const esc = (s: string) => s.replace(/["\\$]/g, (c) => `\\${c}`);
  return `# Hotzonex Cloud - router onboarding (RouterOS v7.x)
# Paste into Winbox > New Terminal, or upload and run: /import hotzonex-onboard.rsc
:local vpsEndpoint "${esc(o.vpsEndpoint)}"
:local vpsPublicKey "${esc(o.vpsPublicKey)}"
:local tunnelIp "${esc(o.tunnelIp)}"
:local apiUser "${esc(o.apiUser)}"
:local apiPass "${esc(o.apiPass)}"

:if ([:len [/interface wireguard find name="wg-hzcloud"]] = 0) do={
  /interface wireguard add name=wg-hzcloud listen-port=13231 comment="Hotzonex Cloud"
}
:if ([:len [/interface wireguard peers find interface="wg-hzcloud"]] = 0) do={
  /interface wireguard peers add interface=wg-hzcloud public-key=$vpsPublicKey \\
    endpoint-address=$vpsEndpoint endpoint-port=51820 allowed-address=10.99.0.1/32 \\
    persistent-keepalive=25s comment="Hotzonex Cloud VPS"
}
:if ([:len [/ip address find interface="wg-hzcloud"]] = 0) do={
  /ip address add address=($tunnelIp . "/24") interface=wg-hzcloud comment="Hotzonex Cloud"
}
:if ([:len [/user group find name="hzcloud"]] = 0) do={
  /user group add name=hzcloud policy=read,write,api,rest-api comment="Hotzonex Cloud"
}
:if ([:len [/user find name=$apiUser]] = 0) do={
  /user add name=$apiUser group=hzcloud password=$apiPass address=10.99.0.1/32 comment="Hotzonex Cloud"
} else={
  /user set [find name=$apiUser] group=hzcloud password=$apiPass address=10.99.0.1/32
}
/ip service set api disabled=no
/ip service set www disabled=no
:if ([:len [/ip firewall filter find comment="Hotzonex Cloud API"]] = 0) do={
  :if ([:len [/ip firewall filter find]] > 0) do={
    /ip firewall filter add chain=input in-interface=wg-hzcloud src-address=10.99.0.1 \\
      protocol=tcp dst-port=80,8728 action=accept comment="Hotzonex Cloud API" place-before=0
  } else={
    /ip firewall filter add chain=input in-interface=wg-hzcloud src-address=10.99.0.1 \\
      protocol=tcp dst-port=80,8728 action=accept comment="Hotzonex Cloud API"
  }
}
:put ("Router WireGuard public key: " . [/interface wireguard get [find name="wg-hzcloud"] public-key])
`;
}

/** Next free 10.99.0.x address (2–254) not used by an existing router. */
export function nextTunnelIp(hosts: string[]): string {
  const used = new Set(hosts.map((h) => /^10\.99\.0\.(\d+)$/.exec(h)?.[1]).filter(Boolean).map(Number));
  for (let i = 2; i <= 254; i++) if (!used.has(i)) return `10.99.0.${i}`;
  return '10.99.0.';
}
