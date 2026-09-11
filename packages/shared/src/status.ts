/** Router status vocabulary shared by the connector (which decides) and the UI (which shows). */
export const ROUTER_STATUSES = ['online', 'offline', 'warning', 'critical', 'unknown'] as const;
export type RouterStatus = (typeof ROUTER_STATUSES)[number];

export const ROUTER_STATUS_LABELS: Record<RouterStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
};

export interface HealthInput {
  cpuLoad: number;
  freeMemory: number;
  totalMemory: number;
  sensors: ReadonlyArray<{ name: string; value: number | null; state: string | null }>;
}

export interface HealthVerdict {
  status: Extract<RouterStatus, 'online' | 'warning' | 'critical'>;
  reason: string | null;
}

/** Thresholds for a reachable router. */
export const HEALTH_THRESHOLDS = {
  cpuWarning: 85,
  cpuCritical: 98,
  memoryWarning: 0.9,
  memoryCritical: 0.97,
  temperatureWarningC: 75,
  temperatureCriticalC: 90,
} as const;

export function assessHealth(h: HealthInput): HealthVerdict {
  const reasons: Array<{ level: 'warning' | 'critical'; text: string }> = [];
  if (h.cpuLoad >= HEALTH_THRESHOLDS.cpuCritical) reasons.push({ level: 'critical', text: `CPU at ${h.cpuLoad}%` });
  else if (h.cpuLoad >= HEALTH_THRESHOLDS.cpuWarning) reasons.push({ level: 'warning', text: `CPU at ${h.cpuLoad}%` });

  if (h.totalMemory > 0) {
    const used = 1 - h.freeMemory / h.totalMemory;
    const pct = Math.round(used * 100);
    if (used >= HEALTH_THRESHOLDS.memoryCritical) reasons.push({ level: 'critical', text: `memory ${pct}% used` });
    else if (used >= HEALTH_THRESHOLDS.memoryWarning) reasons.push({ level: 'warning', text: `memory ${pct}% used` });
  }

  for (const s of h.sensors) {
    if (s.state && !['ok', 'normal', 'true'].includes(s.state.toLowerCase())) {
      reasons.push({ level: 'critical', text: `${s.name} reports "${s.state}"` });
    }
    if (s.value !== null && /temperature/i.test(s.name)) {
      if (s.value >= HEALTH_THRESHOLDS.temperatureCriticalC) reasons.push({ level: 'critical', text: `${s.name} ${s.value}°C` });
      else if (s.value >= HEALTH_THRESHOLDS.temperatureWarningC) reasons.push({ level: 'warning', text: `${s.name} ${s.value}°C` });
    }
  }

  const critical = reasons.filter((r) => r.level === 'critical');
  if (critical.length > 0) return { status: 'critical', reason: critical.map((r) => r.text).join(', ') };
  if (reasons.length > 0) return { status: 'warning', reason: reasons.map((r) => r.text).join(', ') };
  return { status: 'online', reason: null };
}

/**
 * After a failed poll: WARNING (missed a poll) until `offlineAfter`
 * consecutive failures, then OFFLINE. `failuresSoFar` excludes this one.
 * A router never seen before stays UNKNOWN until it crosses the threshold.
 */
export function statusAfterFailure(previous: RouterStatus, failuresSoFar: number, offlineAfter: number): RouterStatus {
  const failures = failuresSoFar + 1;
  if (failures >= offlineAfter || previous === 'offline') return 'offline';
  if (previous === 'unknown') return 'unknown';
  if (previous === 'critical') return 'critical';
  return 'warning';
}
