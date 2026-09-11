import { CheckCircle2, XCircle } from 'lucide-react';
import type { SyncResult, TestConnectionResult, TestPermissionsResult } from '@hotzonex/shared/jobs';
import { MIKROTIK_ERROR_MESSAGES } from '@hotzonex/shared/errors';
import { formatBytes, formatDuration } from '@hotzonex/shared/time';
import type { MikrotikErrorCode } from '@hotzonex/mikrotik/errors';
import { Facts } from './ui/surface';

export function ConnectionResultView({ r }: { r: TestConnectionResult }) {
  const used = r.totalMemory > 0 ? Math.round((1 - r.freeMemory / r.totalMemory) * 100) : null;
  return (
    <div className="rounded-lg border bg-status-good-bg/40 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="size-4 text-status-good" aria-hidden /> Connected and logged in ({r.latencyMs} ms)
      </p>
      <Facts
        items={[
          { label: 'Identity', value: r.identity },
          { label: 'RouterOS version', value: r.routerOsVersion },
          { label: 'Board', value: r.boardName ?? '—' },
          { label: 'Architecture', value: r.architecture ?? '—' },
          { label: 'CPU load', value: `${r.cpuLoad}%` },
          { label: 'Memory', value: `${formatBytes(r.totalMemory - r.freeMemory)} of ${formatBytes(r.totalMemory)}${used === null ? '' : ` (${used}%)`}` },
          { label: 'Uptime', value: formatDuration(r.uptimeSeconds) },
        ]}
      />
    </div>
  );
}

export function PermissionsResultView({ r }: { r: TestPermissionsResult }) {
  const ok = r.missing.length === 0 && r.excess.length === 0 && r.checks.every((c) => c.ok);
  return (
    <div className="grid gap-3 rounded-lg border p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        {ok ? <CheckCircle2 className="size-4 text-status-good" aria-hidden /> : <XCircle className="size-4 text-status-critical" aria-hidden />}
        {ok ? 'The API user has exactly the access Hotzonex needs.' : 'The API user’s access needs attention.'}
      </p>
      <p className="text-muted-foreground">
        User <span className="font-mono">{r.username}</span> in group <span className="font-mono">{r.group}</span> · policies: {r.policies.join(', ') || 'none'}
      </p>
      {r.missing.length > 0 ? <p>Missing required policies: <strong>{r.missing.join(', ')}</strong>. Re-run the onboarding script to reset the group.</p> : null}
      {r.excess.length > 0 ? (
        <p>
          More access than needed: <strong>{r.excess.join(', ')}</strong>. Hotzonex should not hold these rights — remove them from the group on the router.
        </p>
      ) : null}
      <ul className="grid gap-1">
        {r.checks.map((c) => (
          <li key={c.operation} className="flex items-start gap-2">
            {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-good" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-status-critical" aria-hidden />}
            <span>
              {c.operation}
              {!c.ok && c.errorCode ? <span className="text-muted-foreground"> — {MIKROTIK_ERROR_MESSAGES[c.errorCode as MikrotikErrorCode]?.title ?? c.errorCode}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function counts(c: SyncResult['interfaces']): string {
  const parts = [c.added && `${c.added} new`, c.updated && `${c.updated} changed`, c.removed && `${c.removed} gone from router`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no changes';
}

export function SyncResultView({ r }: { r: SyncResult }) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <p className="mb-3 flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4 text-status-good" aria-hidden /> Discovery finished — nothing on the router was changed.
      </p>
      <Facts
        items={[
          { label: 'Identity', value: r.identity },
          { label: 'RouterOS version', value: r.routerOsVersion },
          { label: 'Board', value: r.boardName ?? '—' },
          { label: 'Architecture', value: r.architecture ?? '—' },
          { label: 'Interfaces', value: counts(r.interfaces) },
          { label: 'Hotspot servers', value: counts(r.hotspot_servers) },
          { label: 'Hotspot profiles', value: counts(r.hotspot_profiles) },
          { label: 'Drift recorded', value: r.drift_recorded > 0 ? `${r.drift_recorded} — see the Hotspot tab` : 'none' },
        ]}
      />
    </div>
  );
}
