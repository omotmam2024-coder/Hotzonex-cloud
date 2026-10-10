export function formatDuration(sec: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${s}s`;
}

export function formatMoney(amount: number | null | undefined, currency = 'SSP'): string {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-SS', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

export function formatBytes(b: number | null | undefined): string {
  let n = Number(b) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Juba',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Today's date (YYYY-MM-DD) in Juba time. */
export function todayJuba(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Juba' }).format(d);
}

/** Parse "1h30m", "2d", "45m", "90" (minutes) into seconds. */
export function parseDurationInput(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60;
  let total = 0, matched = false;
  for (const [, n, u] of s.matchAll(/(\d+)\s*(w|d|h|m)/g)) {
    matched = true;
    total += Number(n) * { w: 604800, d: 86400, h: 3600, m: 60 }[u as 'w' | 'd' | 'h' | 'm'];
  }
  return matched && total > 0 ? total : null;
}

export function toDurationInput(sec: number | null | undefined): string {
  if (!sec) return '';
  return formatDuration(sec).replace(/\s/g, '');
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const q = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function randomPassword(len = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
