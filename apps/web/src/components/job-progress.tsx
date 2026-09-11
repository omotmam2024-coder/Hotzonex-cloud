import { CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { z } from 'zod';
import type { JobRow } from '@hotzonex/shared/database';
import { describeJobError } from '@hotzonex/shared/errors';
import { JOB_TYPES, jobResultSchemas, type JobType } from '@hotzonex/shared/jobs';
import { JOB_STATUS_LABEL, isActive, useJob } from '@/lib/queries/jobs';
import { useConnector } from '@/lib/queries/misc';
import { cn } from '@/lib/utils';
import { ErrorState } from './states';
import { RelativeTime } from './time';

function StatusLine({ job, connectorOnline }: { job: JobRow; connectorOnline: boolean }) {
  const label = JOB_TYPES[job.type as JobType]?.label ?? job.type;
  const waitingOffline = job.status === 'pending' && job.deferrals > 0 && job.last_error_code === 'UNREACHABLE';
  const waitingCreds = job.status === 'pending' && job.last_error_code === 'NO_CREDENTIALS';
  let icon: ReactNode = <Clock className="size-4 text-muted-foreground" aria-hidden />;
  let text = `${label}: ${JOB_STATUS_LABEL[job.status]}`;
  if (job.status === 'claimed' || job.status === 'running') icon = <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  if (job.status === 'succeeded') icon = <CheckCircle2 className="size-4 text-status-good" aria-hidden />;
  if (job.status === 'failed' || job.status === 'dead') icon = <XCircle className="size-4 text-status-critical" aria-hidden />;
  if (waitingOffline) {
    icon = <CircleDashed className="size-4 text-status-warning" aria-hidden />;
    text = `${label}: waiting for the router to come back online`;
  }
  if (waitingCreds) text = `${label}: waiting for credentials to be stored`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-live="polite">
      {icon}
      <span className="font-medium">{text}</span>
      <span className="text-xs text-muted-foreground">
        requested <RelativeTime value={job.created_at} />
        {job.attempts > 1 ? ` · attempt ${job.attempts} of ${job.max_attempts}` : ''}
      </span>
      {isActive(job.status) && !connectorOnline ? (
        <span className="w-full text-xs text-muted-foreground">
          The Hotzonex connector is not reporting in. This job stays queued and runs as soon as it reconnects.
        </span>
      ) : null}
      {waitingOffline ? (
        <span className="w-full text-xs text-muted-foreground">
          Offline routers are normal (power cuts, link drops). Hotzonex checks again automatically; you can leave this page.
        </span>
      ) : null}
    </div>
  );
}

/**
 * Live view of one queued router action: status, then either the typed
 * result (rendered by `children`) or a specific failure with the next step.
 */
export function JobProgress<T extends JobType>({
  jobId,
  type,
  children,
  onSucceeded,
  className,
}: {
  jobId: string;
  type: T;
  children: (result: z.infer<(typeof jobResultSchemas)[T]>, job: JobRow) => ReactNode;
  onSucceeded?: () => void;
  className?: string;
}) {
  const job = useJob(jobId);
  const connector = useConnector();
  const succeeded = job.data?.status === 'succeeded';
  useEffect(() => {
    if (succeeded) onSucceeded?.();
  }, [succeeded, onSucceeded]);
  if (job.isPending) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> Queuing…
      </div>
    );
  }
  if (job.isError) return <ErrorState error={job.error} onRetry={() => void job.refetch()} className={className} />;
  const row = job.data;
  const parsed = row.status === 'succeeded' ? jobResultSchemas[type].safeParse(row.result) : null;
  return (
    <div className={cn('grid gap-3', className)}>
      <StatusLine job={row} connectorOnline={connector.data?.online ?? false} />
      {row.status === 'succeeded' && parsed?.success ? children(parsed.data as never, row) : null}
      {row.status === 'succeeded' && parsed && !parsed.success ? (
        <ErrorState human={{ title: 'Unexpected result', explanation: 'The connector returned a result this version of the app does not understand.', nextAction: 'Reload the page; if it persists, the connector and web app versions may differ.' }} />
      ) : null}
      {row.status === 'failed' || row.status === 'dead' ? (
        <div className="grid gap-1">
          <ErrorState human={describeJobError(row.last_error_code)} />
          {row.last_error ? <p className="px-1 text-xs text-muted-foreground">Details: {row.last_error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
