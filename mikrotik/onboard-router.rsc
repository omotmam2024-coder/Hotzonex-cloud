# Hotzonex Cloud - router onboarding (RouterOS v7.x)
# Fill the five values below, then paste into the router terminal (or /import the file).
#   vpsEndpoint  : the VPS public IP
#   vpsPublicKey : output of `wg show wg0 public-key` on the VPS
#   tunnelIp     : a free address in 10.99.0.2-254, unique per router
#   apiUser/apiPass : a dedicated login for Hotzonex Cloud (long random password)
# After running, copy the printed router public key into wg-add-peer.sh on the VPS.

:local vpsEndpoint "203.0.113.10"
:local vpsPublicKey "PASTE_VPS_WG_PUBLIC_KEY"
:local tunnelIp "10.99.0.12"
:local apiUser "hzcloud"
:local apiPass "replace-with-a-long-random-password"

# 1) WireGuard tunnel: the router dials out, so Starlink CGNAT is not a problem
:if ([:len [/interface wireguard find name="wg-hzcloud"]] = 0) do={
  /interface wireguard add name=wg-hzcloud listen-port=13231 comment="Hotzonex Cloud"
}
:if ([:len [/interface wireguard peers find interface="wg-hzcloud"]] = 0) do={
  /interface wireguard peers add interface=wg-hzcloud public-key=$vpsPublicKey \
    endpoint-address=$vpsEndpoint endpoint-port=51820 allowed-address=10.99.0.1/32 \
    persistent-keepalive=25s comment="Hotzonex Cloud VPS"
}
:if ([:len [/ip address find interface="wg-hzcloud"]] = 0) do={
  /ip address add address=($tunnelIp . "/24") interface=wg-hzcloud comment="Hotzonex Cloud"
}

# 2) Restricted login that only works from the VPS tunnel address
:if ([:len [/user group find name="hzcloud"]] = 0) do={
  /user group add name=hzcloud policy=read,write,api,rest-api comment="Hotzonex Cloud"
}
:if ([:len [/user find name=$apiUser]] = 0) do={
  /user add name=$apiUser group=hzcloud password=$apiPass address=10.99.0.1/32 comment="Hotzonex Cloud"
} else={
  /user set [find name=$apiUser] group=hzcloud password=$apiPass address=10.99.0.1/32
}

# 3) Services: REST uses www (80), API uses 8728. Existing address limits are left alone;
#    if they are set, add 10.99.0.1/32 to them by hand.
/ip service set api disabled=no
/ip service set www disabled=no

# 4) Allow the VPS through the input firewall, ahead of any drop rules
:if ([:len [/ip firewall filter find comment="Hotzonex Cloud API"]] = 0) do={
  :if ([:len [/ip firewall filter find]] > 0) do={
    /ip firewall filter add chain=input in-interface=wg-hzcloud src-address=10.99.0.1 \
      protocol=tcp dst-port=80,8728 action=accept comment="Hotzonex Cloud API" place-before=0
  } else={
    /ip firewall filter add chain=input in-interface=wg-hzcloud src-address=10.99.0.1 \
      protocol=tcp dst-port=80,8728 action=accept comment="Hotzonex Cloud API"
  }
}

:put ("Router WireGuard public key: " . [/interface wireguard get [find name="wg-hzcloud"] public-key])
:put ("Add in Hotzonex Cloud -> host " . $tunnelIp . ", user " . $apiUser . ", REST port 80 or API port 8728")
