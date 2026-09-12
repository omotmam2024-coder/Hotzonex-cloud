import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { defaultPortFor, routerConnectionSchema, type RouterConnectionInput } from '@hotzonex/shared/schemas';
import { InlineError } from './states';
import { Button } from './ui/button';
import { Field, Input, Select, Textarea, fieldA11y } from './ui/form-controls';

type FormValues = z.input<typeof routerConnectionSchema>;

const PROTOCOL_HINT: Record<string, string> = {
  api: 'RouterOS API on 8728. Enabled out of the box on most boards.',
  api_ssl: 'API over TLS on 8729. Needs a certificate assigned on the router.',
  rest: 'REST API over HTTPS (www-ssl) or HTTP (www) — RouterOS v7 only.',
};

/**
 * Adding a router that is on the same network: its address and a login that
 * already works, exactly as a technician standing next to it would type them.
 */
export function RouterConnectForm({
  id,
  onSubmit,
  error,
  pending,
  defaults,
  lockName,
  connectors,
}: {
  id?: string;
  onSubmit: (values: RouterConnectionInput) => void;
  error?: unknown;
  pending?: boolean;
  defaults?: Partial<RouterConnectionInput>;
  /** Reconnecting an existing router: its name is already set and renaming it here would be a surprise. */
  lockName?: boolean;
  /** Connectors that have reported in. Only shown when there is a choice to make. */
  connectors?: { id: string; online: boolean }[];
}) {
  const form = useForm<FormValues, unknown, RouterConnectionInput>({
    resolver: zodResolver(routerConnectionSchema),
    defaultValues: {
      name: defaults?.name ?? '',
      host: defaults?.host ?? '192.168.88.1',
      api_protocol: defaults?.api_protocol ?? 'api',
      api_port: defaults?.api_port ?? 8728,
      use_ssl: defaults?.use_ssl ?? false,
      username: defaults?.username ?? 'admin',
      password: '',
      notes: defaults?.notes ?? '',
      connector_id: defaults?.connector_id ?? connectors?.[0]?.id ?? '',
    },
  });
  const { errors } = form.formState;
  const protocol = useWatch({ control: form.control, name: 'api_protocol' }) as RouterConnectionInput['api_protocol'];
  const useSsl = useWatch({ control: form.control, name: 'use_ssl' });
  const [reveal, setReveal] = useState(false);

  const onProtocolChange = (next: RouterConnectionInput['api_protocol']) => {
    const ssl = next === 'api_ssl' ? true : next === 'api' ? false : useSsl;
    form.setValue('api_protocol', next);
    form.setValue('use_ssl', ssl);
    form.setValue('api_port', defaultPortFor(next, ssl));
  };

  return (
    <form id={id} className="grid gap-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Address" htmlFor="host" error={errors.host?.message} hint="The router’s address on this network." required>
          <Input inputMode="decimal" autoComplete="off" spellCheck={false} {...fieldA11y('host', errors.host?.message)} {...form.register('host')} />
        </Field>
        <Field label="Port" htmlFor="api_port" error={errors.api_port?.message}>
          <Input inputMode="numeric" {...fieldA11y('api_port', errors.api_port?.message)} {...form.register('api_port')} />
        </Field>
      </div>

      <Field label="Username" htmlFor="username" error={errors.username?.message} required>
        <Input autoComplete="off" spellCheck={false} {...fieldA11y('username', errors.username?.message)} {...form.register('username')} />
      </Field>

      <Field label="Password" htmlFor="password" error={errors.password?.message} hint="Leave blank if this router still has no password.">
        <div className="relative">
          <Input
            type={reveal ? 'text' : 'password'}
            autoComplete="off"
            className="pr-10"
            {...fieldA11y('password', errors.password?.message)}
            {...form.register('password')}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 size-9"
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </Field>

      {connectors && connectors.length > 1 ? (
        <Field
          label="Site connector"
          htmlFor="connector_id"
          error={errors.connector_id?.message}
          hint="The connector on this router’s network. It opens the connection and is the only one that can read the password."
          required
        >
          <Select {...fieldA11y('connector_id', errors.connector_id?.message)} {...form.register('connector_id')}>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
                {c.online ? '' : ' (offline)'}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" {...form.register('connector_id')} />
      )}

      {lockName ? (
        <input type="hidden" {...form.register('name')} />
      ) : (
        <Field label="Name" htmlFor="name" error={errors.name?.message} hint="How your team refers to this site, e.g. “Lologo Gate”." required>
          <Input autoComplete="off" {...fieldA11y('name', errors.name?.message)} {...form.register('name')} />
        </Field>
      )}

      <details className="rounded-lg border bg-card px-3 py-2 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer text-sm font-medium">Connection settings</summary>
        <div className="grid gap-4 pb-1">
          <Field label="API protocol" htmlFor="api_protocol" hint={PROTOCOL_HINT[protocol]}>
            <Select id="api_protocol" value={protocol} onChange={(e) => onProtocolChange(e.target.value as RouterConnectionInput['api_protocol'])}>
              <option value="api">API (8728)</option>
              <option value="api_ssl">API-SSL (8729)</option>
              <option value="rest">REST</option>
            </Select>
          </Field>
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
              Use HTTPS (www-ssl)
            </label>
          ) : null}
          <Field label="Comment" htmlFor="notes" error={errors.notes?.message}>
            <Textarea rows={2} {...fieldA11y('notes', errors.notes?.message)} {...form.register('notes')} />
          </Field>
        </div>
      </details>

      <InlineError error={error} />
      {id ? null : (
        <Button type="submit" loading={pending}>
          Connect
        </Button>
      )}
    </form>
  );
}
