import { AlertCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HumanError } from '@hotzonex/shared/errors';
import { userMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Skeleton } from './ui/surface';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Empty states say what to do next, never just "No data". */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {icon ? <div className="mb-1 text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Failure: what happened, why, and the next action. */
export function ErrorState({ error, human, onRetry, className }: { error?: unknown; human?: HumanError; onRetry?: () => void; className?: string }) {
  const title = human?.title ?? 'Could not load this';
  const explanation = human?.explanation ?? userMessage(error);
  return (
    <div role="alert" className={cn('flex gap-3 rounded-lg border border-status-critical/30 bg-status-critical-bg p-4', className)}>
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-status-critical" aria-hidden />
      <div className="grid gap-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-foreground/80">{explanation}</p>
        {human?.nextAction ? (
          <p className="text-foreground/80">
            <span className="font-medium">Next: </span>
            {human.nextAction}
          </p>
        ) : null}
        {onRetry ? (
          <div className="mt-1">
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw /> Try again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="grid gap-2 p-4" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-status-critical-bg px-3 py-2 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-critical" aria-hidden />
      {userMessage(error)}
    </p>
  );
}
