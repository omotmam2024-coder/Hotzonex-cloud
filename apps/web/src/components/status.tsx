import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, KeyRound, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ROUTER_STATUS_LABELS, type RouterStatus } from '@hotzonex/shared/status';
import { cn } from '@/lib/utils';

/** Router status: color + icon + label, never color alone. */
const STATUS_STYLE: Record<RouterStatus, { icon: typeof CheckCircle2; tone: string; bg: string }> = {
  online: { icon: CheckCircle2, tone: 'text-status-good', bg: 'bg-status-good-bg' },
  warning: { icon: AlertTriangle, tone: 'text-status-warning', bg: 'bg-status-warning-bg' },
  critical: { icon: AlertOctagon, tone: 'text-status-serious', bg: 'bg-status-serious-bg' },
  offline: { icon: WifiOff, tone: 'text-status-critical', bg: 'bg-status-critical-bg' },
  unknown: { icon: CircleHelp, tone: 'text-status-unknown', bg: 'bg-status-unknown-bg' },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const key = (status in STATUS_STYLE ? status : 'unknown') as RouterStatus;
  const s = STATUS_STYLE[key];
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-foreground', s.bg, className)}>
      <Icon className={cn('size-3.5', s.tone)} aria-hidden />
      {ROUTER_STATUS_LABELS[key]}
    </span>
  );
}

/** Demo routers are badged everywhere they appear and never counted as real. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center rounded border border-dashed border-muted-foreground/50 px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground', className)}
      title="Demo router served by the mock provider. Not counted in any metric."
    >
      Demo
    </span>
  );
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'info'; className?: string }) {
  const tones = {
    neutral: 'bg-muted text-foreground',
    good: 'bg-status-good-bg text-foreground',
    warning: 'bg-status-warning-bg text-foreground',
    critical: 'bg-status-critical-bg text-foreground',
    info: 'bg-accent text-accent-foreground',
  } as const;
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function CredentialsBadge({ status }: { status: string }) {
  if (status === 'set') return <Pill tone="good"><KeyRound className="size-3.5 text-status-good" aria-hidden />Credentials set</Pill>;
  if (status === 'pending') return <Pill tone="info"><KeyRound className="size-3.5" aria-hidden />Storing credentials…</Pill>;
  if (status === 'rejected') return <Pill tone="critical"><KeyRound className="size-3.5 text-status-critical" aria-hidden />Credentials rejected</Pill>;
  return <Pill><KeyRound className="size-3.5 text-muted-foreground" aria-hidden />Credentials not set</Pill>;
}
