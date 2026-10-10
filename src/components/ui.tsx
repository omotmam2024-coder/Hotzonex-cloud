import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { useApp } from '../lib/app';

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean; size?: 'sm' | 'md' | 'lg';
};
export function Button({ variant = 'primary', busy, size = 'md', className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5',
        size === 'lg' && 'px-5 py-3.5 text-lg',
        variant === 'primary' && 'bg-slate-900 text-white hover:bg-slate-800',
        variant === 'secondary' && 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('grid gap-1', className)}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx(inputCls, p.className)} />; }
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cx(inputCls, p.className)} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...p} className={cx(inputCls, p.className)} />; }

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'amber' | 'red' | 'sky' | 'violet'; children: ReactNode }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700', sky: 'bg-sky-100 text-sky-800', violet: 'bg-violet-100 text-violet-800',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export const voucherTone = { unused: 'slate', sold: 'sky', active: 'green', expired: 'amber', disabled: 'red' } as const;
export const routerTone = { online: 'green', offline: 'red', auth_failed: 'amber', unknown: 'slate' } as const;

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">{children}</div>;
}
export function InfoBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="size-5 animate-spin" />{label}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
      <div className="font-semibold text-slate-700">{title}</div>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-black tabular-nums', tone ?? 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

/** Site picker for admins (with "All sites"); pinned staff see their site name. */
export function SitePicker({ allowAll = true }: { allowAll?: boolean }) {
  const { sites, siteId, setSiteId, memberships, tenant } = useApp();
  const pinned = memberships.find((m) => m.tenant_id === tenant?.id)?.site_id;
  if (pinned) return <Badge tone="sky">{sites.find((s) => s.id === pinned)?.name ?? 'My site'}</Badge>;
  return (
    <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-auto min-w-40 py-2">
      {allowAll && <option value="">All sites</option>}
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <div className="p-6 text-center text-sm text-slate-500">Nothing here yet.</div>}
    </div>
  );
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('whitespace-nowrap px-3 py-2.5', className)}>{children}</td>;
}
