import { useEffect, useState } from 'react';
import { formatRelative, freshness, type Freshness } from '@hotzonex/shared/time';
import { cn } from '@/lib/utils';
import { Tooltip } from './ui/overlays';

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function RelativeTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const now = useNow();
  if (!value) return <span className={cn('text-muted-foreground', className)}>never</span>;
  return (
    <Tooltip content={new Date(value).toLocaleString()}>
      <time dateTime={value} className={className}>
        {formatRelative(value, now)}
      </time>
    </Tooltip>
  );
}

const FRESHNESS_STYLE: Record<Freshness, { dot: string; label: string }> = {
  fresh: { dot: 'bg-status-good', label: 'Fresh' },
  stale: { dot: 'bg-status-warning', label: 'Stale' },
  lost: { dot: 'bg-status-critical', label: 'Lost contact' },
  never: { dot: 'bg-status-unknown', label: 'Never seen' },
};

/** "Last seen" with a freshness dot relative to the poll interval (dot + words, not color alone). */
export function LastSeen({ value, pollIntervalSeconds }: { value: string | null; pollIntervalSeconds: number }) {
  const now = useNow();
  const f = freshness(value, pollIntervalSeconds, now);
  const s = FRESHNESS_STYLE[f];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
      <span className="sr-only">{s.label}: </span>
      {value ? <RelativeTime value={value} /> : <span className="text-muted-foreground">never</span>}
    </span>
  );
}
