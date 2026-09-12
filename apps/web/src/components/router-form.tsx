import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { defaultPortFor, routerSchema, type RouterInput } from '@hotzonex/shared/schemas';
import type { LocationRow } from '@hotzonex/shared/database';
import { InlineError } from './states';
import { Button } from './ui/button';
import { Field, Input, Select, Textarea, fieldA11y } from './ui/form-controls';

type FormValues = z.input<typeof routerSchema>;

const PROTOCOL_HINT: Record<string, string> = {
  api: 'Recommended. RouterOS API on 8728, carried inside the encrypted WireGuard tunnel. No certificate needed.',
  api_ssl: 'API over TLS on 8729. Needs a certificate assigned on the router (RouterOS uses self-signed certificates).',
  rest: 'RouterOS v7 REST API over the www-ssl (HTTPS) or www (HTTP, 7.9+) service.',
};

export function RouterForm({
  defaults,
  locations,
  showLocation,
  submitLabel,
  onSubmit,
  error,
  pending,
  id,
  hideSubmit,
  advancedCollapsed,
}: {
  defaults?: Partial<RouterInput>;
  locations?: Pick<LocationRow, 'id' | 'name'>[];
  showLocation: boolean;
  submitLabel: string;
  onSubmit: (values: RouterInput) => void;
  error?: unknown;
  pending?: boolean;
  /** Lets a submit button live outside the form, via `form="…"`. */
  id?: string;
  hideSubmit?: boolean;
  /** Onboarding asks for a name and nothing else; the defaults are right for almost every router. */
  advancedCollapsed?: boolean;
}) {
  const form = useForm<FormValues, unknown, RouterInput>({
    resolver: zodResolver(routerSchema),
    defaultValues: {
      name: defaults?.name ?? '',
      location_id: defaults?.location_id ?? null,
      api_protocol: defaults?.api_protocol ?? 'api',
      api_port: defaults?.api_port ?? 8728,
      use_ssl: defaults?.use_ssl ?? false,
      notes: defaults?.notes ?? '',
    },
  });
  const { errors } = form.formState;
  const protocol = useWatch({ control: form.control, name: 'api_protocol' }) as RouterInput['api_protocol'];
  const useSsl = useWatch({ control: form.control, name: 'use_ssl' });

  const onProtocolChange = (next: RouterInput['api_protocol']) => {
    const ssl = next === 'api_ssl' ? true : next === 'api' ? false : useSsl;
    form.setValue('api_protocol', next);
    form.setValue('use_ssl', ssl);
    form.setValue('api_port', defaultPortFor(next, ssl));
  };

  const connection = (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="API protocol" htmlFor="api_protocol" hint={PROTOCOL_HINT[protocol]}>
          <Select id="api_protocol" value={protocol} onChange={(e) => onProtocolChange(e.target.value as RouterInput['api_protocol'])}>
            <option value="api">API (8728)</option>
            <option value="api_ssl">API-SSL (8729)</option>
            <option value="rest">REST</option>
          </Select>
        </Field>
        <Field label="Port" htmlFor="api_port" error={errors.api_port?.message}>
          <Input inputMode="numeric" {...fieldA11y('api_port', errors.api_port?.message)} {...form.register('api_port')} />
        </Field>
      </div>
      {protocol === 'rest' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={Boolean(useSsl)}
            onChange={(e) => {
              form.setValue('use_ssl', e.target.checked);
              form.setValue('api_port', defaultPortFor('rest', e.target.checked));
            }}
          />
          Use HTTPS (www-ssl). Plain HTTP stays inside the encrypted tunnel but needs RouterOS 7.9+.
        </label>
      ) : null}
      <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
        <Textarea rows={2} {...fieldA11y('notes', errors.notes?.message)} {...form.register('notes')} />
      </Field>
    </>
  );

  return (
    <form id={id} className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <Field label="Router name" htmlFor="name" error={errors.name?.message} hint="How your team refers to this site, e.g. “Lologo Gate”." required>
        <Input autoComplete="off" {...fieldA11y('name', errors.name?.message)} {...form.register('name')} />
      </Field>
      {showLocation ? (
        <Field label="Location" htmlFor="location_id" error={errors.location_id?.message}>
          <Select
            {...fieldA11y('location_id', errors.location_id?.message)}
            {...form.register('location_id', { setValueAs: (v: string) => (v === '' ? null : v) })}
          >
            <option value="">Unassigned</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {advancedCollapsed ? (
        <details className="rounded-lg border bg-card px-3 py-2 [&[open]>summary]:mb-3">
          <summary className="cursor-pointer text-sm font-medium">Connection settings</summary>
          <div className="grid gap-4 pb-1">
            <p className="text-xs text-muted-foreground">The defaults suit almost every router. Change them only if this one is set up differently.</p>
            {connection}
          </div>
        </details>
      ) : (
        connection
      )}
      <InlineError error={error} />
      {hideSubmit ? null : (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
