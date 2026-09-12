import { ArrowLeft, Info, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Layout for the router wizard: one task per screen.
 *
 * A technician does this standing next to a router, on a phone, often in the
 * sun. So each screen carries a single instruction, a picture of the thing
 * being described, and exactly one obvious button — which stays pinned to the
 * bottom of the viewport rather than hiding below a wall of text.
 */

export function WizardHeader({
  title,
  step,
  total,
  onBack,
}: {
  title: string;
  step: number;
  total: number;
  onBack: () => void;
}) {
  const pct = Math.round(((step + 1) / total) * 100);
  return (
    <div className="sticky top-12 z-20 -mx-3 -mt-4 mb-5 border-b bg-card/95 backdrop-blur sm:-mx-6 sm:-mt-6">
      <div className="mx-auto flex h-12 w-full max-w-xl items-center gap-1 px-1 sm:px-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <span className="ml-auto shrink-0 pr-2 text-xs tabular-nums text-muted-foreground">
          {step + 1} / {total}
        </span>
      </div>
      <div
        className="h-1 w-full bg-muted"
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label="Onboarding progress"
      >
        <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * One step. `illustration` sits in a tinted panel above the caption, matching
 * the order a person reads in: what am I doing → what does it look like → why.
 */
export function WizardScreen({
  title,
  caption,
  illustration,
  children,
}: {
  title: string;
  caption?: React.ReactNode;
  illustration?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h2 className="text-center text-lg font-semibold text-balance sm:text-xl">{title}</h2>
      {illustration ? (
        <div className="mt-5 flex justify-center rounded-xl bg-accent px-4 py-6">{illustration}</div>
      ) : null}
      {caption ? <p className="mt-4 text-center text-sm text-pretty text-muted-foreground sm:text-base">{caption}</p> : null}
      {children ? <div className="mt-5 grid gap-4">{children}</div> : null}
    </div>
  );
}

/** An aside that is worth reading but is not the instruction itself. */
export function WizardNote({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-sm',
        tone === 'warning' ? 'border-transparent bg-status-warning-bg' : 'bg-card',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'warning' ? 'text-status-warning' : 'text-primary')} aria-hidden />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  );
}

/**
 * The step's action, pinned to the bottom of the viewport. `secondary` renders
 * underneath as a quiet link so it never competes with the main action.
 */
export function WizardFooter({ children, secondary }: { children: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-3 -mb-4 mt-8 border-t bg-card/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
      <div className="mx-auto grid w-full max-w-xl gap-2">
        {children}
        {secondary ? <div className="flex justify-center">{secondary}</div> : null}
      </div>
    </div>
  );
}

/** The single primary action. Full width, so it is reachable with a thumb. */
export function WizardAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="lg" className={cn('h-11 w-full text-base', className)} {...props} />;
}
