import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { loginSchema, type LoginInput } from '@hotzonex/shared/schemas';
import { InlineError } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Field, Input, fieldA11y } from '@/components/ui/form-controls';
import { toAppError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

/** Client-side courtesy throttle; the real limit is enforced by Supabase Auth (see supabase/config.toml). */
const MAX_TRIES = 5;
const COOLDOWN_MS = 30_000;
/** Read only inside the submit handler, never during render. */
const clock = (): number => Date.now();

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<unknown>(null);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (clock() < lockedUntil) {
      setError(new Error('Too many requests'));
      return;
    }
    const { error: authError } = await getSupabase().auth.signInWithPassword({ email: values.email, password: values.password });
    if (authError) {
      const next = failures + 1;
      setFailures(next);
      if (next >= MAX_TRIES) {
        setLockedUntil(clock() + COOLDOWN_MS);
        setFailures(0);
      }
      setError(toAppError(authError));
      form.setValue('password', '');
      return;
    }
    // Server-side session triggers normally audit sign-in; where they are unavailable the server records this call instead.
    void getSupabase().rpc('record_auth_event', { p_event: 'login' }).then(() => undefined, () => undefined);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/', { replace: true });
  });

  return (
    <AuthLayout title="Sign in" subtitle="Use the account your Hotzonex administrator created or invited.">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input type="email" autoComplete="username" inputMode="email" {...fieldA11y('email', errors.email?.message)} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...fieldA11y('password', errors.password?.message)} {...form.register('password')} />
        </Field>
        <InlineError error={error} />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Sign in
        </Button>
        <p className="text-xs text-muted-foreground">
          New team member? Open the invitation link your administrator sent you. Accounts are invite-only.
        </p>
      </form>
    </AuthLayout>
  );
}
