/**
 * Step illustrations for the router wizard.
 *
 * Inline SVG rather than photographs: a technician onboards routers on a cheap
 * phone over a metered Starlink link, so these cost no extra request, stay
 * crisp at any size, and follow the theme through CSS variables.
 *
 * All of them are decorative — every illustration repeats what the caption
 * beneath it already says in words — so they are hidden from screen readers.
 */

import type * as React from 'react';

const CARD = 'var(--card)';
const BORDER = 'var(--border)';
const MUTED = 'var(--muted)';
const MUTED_FG = 'var(--muted-foreground)';
const PRIMARY = 'var(--primary)';

function Svg({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 320 170" className="h-auto w-full max-w-sm" aria-hidden="true" focusable="false" data-illustration={label}>
      {children}
    </svg>
  );
}

/** The MikroTik body, shared by several steps. `port` highlights one ethernet port (1-5). */
function Mikrotik({ x, y, port }: { x: number; y: number; port?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="104" height="42" rx="6" fill={CARD} stroke={BORDER} />
      <line x1="0" y1="13" x2="104" y2="13" stroke={BORDER} />
      <text x="52" y="10" textAnchor="middle" fontSize="6.5" fill={MUTED_FG} letterSpacing="0.5">
        MikroTik
      </text>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={9 + i * 18} y="22" width="13" height="11" rx="2" fill={MUTED} stroke={BORDER} />
      ))}
      {port ? <rect x={6 + (port - 1) * 18} y="19" width="19" height="17" rx="3" fill="none" stroke={PRIMARY} strokeWidth="2" /> : null}
    </g>
  );
}

/** Step: plug the ISP's cable into ether1. */
export function ConnectToInternet() {
  return (
    <Svg label="connect-internet">
      {/* the internet, as a cloud feeding the provider's router */}
      <path
        d="M44 30c0-7 6-12 13-12 3-6 10-9 16-6 4-6 13-6 17 1 7 0 12 6 11 13 5 1 8 5 8 10H36c-5 0-8-3-8-7s5-8 16-9Z"
        fill={CARD}
        stroke={BORDER}
      />
      <text x="78" y="42" textAnchor="middle" fontSize="8" fill={MUTED_FG}>
        Internet
      </text>
      <path d="M78 46v10" stroke={BORDER} strokeWidth="2" strokeDasharray="3 3" />

      {/* provider's router */}
      <rect x="30" y="62" width="92" height="38" rx="9" fill={CARD} stroke={BORDER} />
      <circle cx="44" cy="74" r="2.5" fill="var(--status-good)" />
      <circle cx="53" cy="74" r="2.5" fill={MUTED} stroke={BORDER} strokeWidth="0.5" />
      <circle cx="62" cy="74" r="2.5" fill={MUTED} stroke={BORDER} strokeWidth="0.5" />
      <text x="76" y="116" textAnchor="middle" fontSize="8.5" fill={MUTED_FG}>
        Your provider
      </text>

      <Mikrotik x={192} y={62} port={1} />

      {/* the cable, plugged into the first port */}
      <path d="M118 88C140 122 168 126 200 96" fill="none" stroke={PRIMARY} strokeWidth="4.5" strokeLinecap="round" />
      <rect x="112" y="82" width="12" height="11" rx="2.5" fill={PRIMARY} />
      <rect x="196" y="79" width="12" height="11" rx="2.5" fill={PRIMARY} />

      <text x="228" y="120" fontSize="9" fontWeight="600" fill={PRIMARY}>
        ether 1
      </text>
      <path d="M226 116h-16" stroke={PRIMARY} strokeWidth="1.5" strokeDasharray="2 2" />
    </Svg>
  );
}

/** Step: find the sticker under the router. */
export function FactoryLabel() {
  const qr: readonly (readonly [number, number])[] = [
    [0, 0], [2, 0], [3, 0], [5, 0], [1, 1], [4, 1], [0, 2], [2, 2], [5, 2],
    [3, 3], [5, 3], [0, 4], [1, 4], [4, 4], [2, 5], [5, 5],
  ];
  return (
    <Svg label="factory-label">
      <g transform="rotate(-4 160 85)">
        <rect x="96" y="16" width="128" height="138" rx="10" fill={CARD} stroke={BORDER} />
        <path d="M96 26a10 10 0 0 1 10-10h108a10 10 0 0 1 10 10v16H96Z" fill={PRIMARY} opacity="0.16" />

        <text x="108" y="60" fontSize="8" fontWeight="600" fill={MUTED_FG} letterSpacing="0.3">
          Factory credentials
        </text>
        <text x="108" y="78" fontSize="9" fill="var(--foreground)">
          Username: admin
        </text>
        <text x="108" y="92" fontSize="9" fill="var(--foreground)">
          Password: ••••••••••
        </text>
        <rect x="102" y="66" width="116" height="32" rx="5" fill="none" stroke={PRIMARY} strokeWidth="2" />

        <text x="108" y="110" fontSize="7.5" fill={MUTED_FG}>
          Serial: 0123 4567 8901
        </text>

        {/* a QR code, suggested rather than encoded */}
        <g transform="translate(132 118)">
          {[[0, 0], [40, 0], [0, 40]].map(([fx, fy], i) => (
            <g key={i} transform={`translate(${fx} ${fy})`}>
              <rect width="16" height="16" rx="2" fill="none" stroke="var(--foreground)" strokeWidth="3" />
              <rect x="6" y="6" width="4" height="4" fill="var(--foreground)" />
            </g>
          ))}
          {qr.map(([cx, cy], i) => (
            <rect key={i} x={22 + cx * 5} y={22 + cy * 5} width="3.5" height="3.5" fill="var(--foreground)" />
          ))}
        </g>
      </g>
    </Svg>
  );
}

/** Step: paste the setup script into a terminal. */
export function TerminalScript() {
  const lines = [
    { w: 176, accent: true },
    { w: 132, accent: false },
    { w: 198, accent: false },
    { w: 108, accent: true },
    { w: 186, accent: false },
    { w: 148, accent: false },
  ];
  return (
    <Svg label="terminal-script">
      <rect x="26" y="20" width="268" height="130" rx="9" fill={CARD} stroke={BORDER} />
      <path d="M26 29a9 9 0 0 1 9-9h250a9 9 0 0 1 9 9v14H26Z" fill={MUTED} />
      <circle cx="41" cy="32" r="3.5" fill="var(--status-critical)" opacity="0.7" />
      <circle cx="53" cy="32" r="3.5" fill="var(--status-warning)" opacity="0.7" />
      <circle cx="65" cy="32" r="3.5" fill="var(--status-good)" opacity="0.7" />
      <text x="160" y="35" textAnchor="middle" fontSize="8" fill={MUTED_FG}>
        New Terminal
      </text>

      {lines.map((l, i) => (
        <g key={i}>
          <text x="42" y={62 + i * 15} fontSize="9" fill={PRIMARY} opacity="0.8" fontFamily="monospace">
            &gt;
          </text>
          <rect x="54" y={56 + i * 15} width={l.w} height="6" rx="3" fill={l.accent ? PRIMARY : MUTED_FG} opacity={l.accent ? 0.55 : 0.3} />
        </g>
      ))}
      <rect x="54" y={56 + 6 * 15} width="7" height="9" rx="1.5" fill={PRIMARY} />
    </Svg>
  );
}

/** Step: copy the key the router printed back into Hotzonex. */
export function PasteKeyBack() {
  return (
    <Svg label="paste-key">
      {/* what the router printed */}
      <rect x="22" y="14" width="180" height="84" rx="8" fill={CARD} stroke={BORDER} />
      <path d="M22 22a8 8 0 0 1 8-8h164a8 8 0 0 1 8 8v11H22Z" fill={MUTED} />
      <circle cx="34" cy="24" r="2.6" fill={MUTED_FG} opacity="0.5" />
      <circle cx="43" cy="24" r="2.6" fill={MUTED_FG} opacity="0.5" />
      <rect x="34" y="44" width="120" height="5" rx="2.5" fill={MUTED_FG} opacity="0.3" />
      <rect x="34" y="56" width="88" height="5" rx="2.5" fill={MUTED_FG} opacity="0.3" />
      <rect x="30" y="70" width="164" height="18" rx="4" fill={PRIMARY} opacity="0.14" />
      <rect x="30" y="70" width="164" height="18" rx="4" fill="none" stroke={PRIMARY} strokeWidth="1.5" />
      <text x="38" y="82" fontSize="7" fontFamily="monospace" fill={PRIMARY}>
        HOTZONEX-WG-PUBLIC-KEY=…
      </text>

      {/* carried into the field below */}
      <defs>
        <marker id="wz-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill={PRIMARY} />
        </marker>
      </defs>
      <path d="M206 82C238 82 232 108 246 120" fill="none" stroke={PRIMARY} strokeWidth="2" strokeDasharray="4 4" markerEnd="url(#wz-arrow)" />

      <text x="130" y="126" fontSize="8.5" fill={MUTED_FG}>
        Paste it here
      </text>
      <rect x="120" y="132" width="176" height="26" rx="6" fill={CARD} stroke={PRIMARY} strokeWidth="2" />
      <text x="130" y="149" fontSize="7" fontFamily="monospace" fill={MUTED_FG}>
        HOTZONEX-WG-PUBLIC-KEY=…
      </text>
    </Svg>
  );
}

/** Step: the connector reaches the router through its tunnel. */
export function TunnelCheck() {
  return (
    <Svg label="tunnel-check">
      <Mikrotik x={22} y={64} />
      <text x="74" y="120" textAnchor="middle" fontSize="8.5" fill={MUTED_FG}>
        Router
      </text>

      <path
        d="M232 52c0-8 7-14 15-13 3-7 11-10 18-7 5-6 15-6 19 2 8 0 14 7 13 15 6 1 9 6 9 11h-84c-6 0-10-4-10-9s6-9 20-10Z"
        fill={CARD}
        stroke={BORDER}
      />
      <text x="254" y="120" textAnchor="middle" fontSize="8.5" fill={MUTED_FG}>
        Hotzonex
      </text>

      <path d="M132 85C160 85 196 78 222 70" fill="none" stroke={PRIMARY} strokeWidth="2" strokeDasharray="5 4" />

      {/* the tunnel is encrypted, and the router dials out — never the other way round */}
      <circle cx="176" cy="82" r="17" fill={CARD} stroke={PRIMARY} strokeWidth="2" />
      <rect x="169" y="79" width="14" height="11" rx="2" fill={PRIMARY} />
      <path d="M172 79v-4a4 4 0 0 1 8 0v4" fill="none" stroke={PRIMARY} strokeWidth="2" />
    </Svg>
  );
}
