import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10 rounded-lg" />
          <div className="leading-tight">
            <p className="text-lg font-semibold">Hotzonex Cloud</p>
            <p className="text-xs text-muted-foreground">MikroTik Hotspot Management &amp; WiFi Platform</p>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          <h1 className="text-base font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Hotzonex WiFi/IT Solutions · Juba, South Sudan</p>
      </div>
    </div>
  );
}
