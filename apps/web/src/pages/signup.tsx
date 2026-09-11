import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ROLE_LABELS, type Role } from '@hotzonex/shared/roles';
import { inviteTokenSchema, signupSchema, type SignupInput } from '@hotzonex/shared/schemas';
import { ErrorState, InlineError } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Field, Input, fieldA11y } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/surface';
import { toAppError, unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

interface InviteInfo {
  email: string | null;
  role: Role | null;
  tenant_name: string | null;
  expires_at: string | null;
  state: 'valid' | 'expired' | 'used' | 'revoked' | 'not_found';
}

const STATE_TEXT: Record<Exclude<InviteInfo['state'], 'valid'>, { title: string; explanation: string }> = {
  expired: { title: 'This invitation has expired', explanation: 'Invitations are valid for 7 days.' },
  used: { title: 'This invitation was already used', explanation: 'If that was you, sign in instead.' },
  revoked: { title: 'This invitation was withdrawn', explanation: 'An administrator revoked it.' },
  not_found: { title: 'This invitation link is not valid', explanation: 'The link may be incomplete or mistyped.' },
};

export function SignupPage() {
  const [params] = useSearchParams();
  const token = params.get('invite') ?? '';
  const tokenOk = inviteTokenSchema.safeParse(token).success;
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const invite = useQuery({
    queryKey: ['invite-lookup', token],
    enabled: tokenOk,
    retry: false,
    queryFn: async () => (unwrap(await getSupabase().rpc('get_invite', { p_token: token })) as InviteInfo[])[0] ?? null,
  });

  const form = useForm<SignupInput>({ resolver: zodResolver(signupSchema), defaultValues: { fullName: '', password: '', confirmPassword: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const email = invite.data?.email;
    if (!email) return;
    const { data, error: authError } = await getSupabase().auth.signUp({
      email,
      password: values.password,
      options: { data: { invite_token: token, full_name: values.fullName }, emailRedirectTo: `${window.location.origin}/` },
    });
    if (authError) {
      setError(toAppError(authError));
      return;
    }
    if (data.session) navigate('/', { replace: true });
    else setNeedsConfirmation(true);
  });

  if (!tokenOk || (invite.data && invite.data.state !== 'valid') || invite.data === null) {
    const s = STATE_TEXT[(invite.data?.state as Exclude<InviteInfo['state'], 'valid'>) ?? 'not_found'];
    return (
      <AuthLayout title="Join Hotzonex Cloud">
        <ErrorState human={{ ...s, nextAction: 'Ask your Hotzonex administrator for a new invitation link.' }} />
        <Button asChild variant="link" className="mt-4">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }

  if (needsConfirmation) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex gap-3 text-sm">
          <MailCheck className="size-5 shrink-0 text-primary" aria-hidden />
          <p>We sent a confirmation link to {invite.data?.email}. Open it to finish creating your account, then sign in.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Join Hotzonex Cloud"
      subtitle={invite.data ? `You were invited to ${invite.data.tenant_name} as ${invite.data.role ? ROLE_LABELS[invite.data.role] : ''}.` : undefined}
    >
      {invite.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : invite.isError ? (
        <ErrorState error={invite.error} onRetry={() => void invite.refetch()} />
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email" hint="Fixed by the invitation.">
            <Input id="email" type="email" value={invite.data?.email ?? ''} readOnly autoComplete="username" />
          </Field>
          <Field label="Your name" htmlFor="fullName" error={errors.fullName?.message} required>
            <Input autoComplete="name" {...fieldA11y('fullName', errors.fullName?.message)} {...form.register('fullName')} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters, with letters and digits." required>
            <Input type="password" autoComplete="new-password" {...fieldA11y('password', errors.password?.message)} {...form.register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message} required>
            <Input type="password" autoComplete="new-password" {...fieldA11y('confirmPassword', errors.confirmPassword?.message)} {...form.register('confirmPassword')} />
          </Field>
          <InlineError error={error} />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Create account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
