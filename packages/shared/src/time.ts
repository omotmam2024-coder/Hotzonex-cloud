/** Time helpers used by the dashboard, router pages and the connector. */

/** "3d 4h", "12m 5s", "0s" — compact, largest two units. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const units: Array<[string, number]> = [
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  const s = Math.floor(totalSeconds);
  const first = units.findIndex(([, size]) => s >= size);
  if (first === -1) return '0s';
  const [label, size] = units[first] as [string, number];
  const major = Math.floor(s / size);
  const next = units[first + 1];
  const minor = next ? Math.floor((s - major * size) / next[1]) : 0;
  return next && minor > 0 ? `${major}${label} ${minor}${next[0]}` : `${major}${label}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
export function formatRelative(from: Date | string | null | undefined, now: Date = new Date()): string {
  if (!from) return 'never';
  const date = typeof from === 'string' ? new Date(from) : from;
  const diff = Math.round((now.getTime() - date.getTime()) / 1000);
  if (!Number.isFinite(diff)) return 'never';
  if (diff < 0) return 'just now';
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export type Freshness = 'fresh' | 'stale' | 'lost' | 'never';

/**
 * How current is "last seen"? fresh ≤ 1.5 poll intervals, stale ≤ 3, else lost.
 * Intervals come from settings, so the thresholds scale with slow polling.
 */
export function freshness(lastSeen: Date | string | null | undefined, pollIntervalSeconds: number, now: Date = new Date()): Freshness {
  if (!lastSeen) return 'never';
  const seen = typeof lastSeen === 'string' ? new Date(lastSeen) : lastSeen;
  const age = (now.getTime() - seen.getTime()) / 1000;
  if (age <= pollIntervalSeconds * 1.5) return 'fresh';
  if (age <= pollIntervalSeconds * 3) return 'stale';
  return 'lost';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
