import { useState } from 'react';
import { supabase, errText } from '../lib/supabase';
import { Button, ErrorBox, Field, InfoBox, Input } from '../components/ui';

export default function LoginPage() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setInfo('Account created. Check your email to confirm it, then sign in.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(errText(err));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <img src="/icon.svg" alt="" className="size-16" />
          <h1 className="mt-3 text-2xl font-bold">Hotzonex Cloud</h1>
          <p className="text-sm text-slate-400">Vouchers, sales, routers and network in one place</p>
        </div>
        <form onSubmit={submit} className="grid gap-4 rounded-3xl bg-white p-6 shadow-xl">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          {mode !== 'reset' && (
            <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === 'up' ? 8 : undefined}
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required />
            </Field>
          )}
          <ErrorBox>{error}</ErrorBox>
          {info && <InfoBox>{info}</InfoBox>}
          <Button busy={busy} size="lg">{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
          <div className="flex justify-between text-sm">
            {mode !== 'in'
              ? <button type="button" className="text-sky-700" onClick={() => setMode('in')}>Back to sign in</button>
              : <button type="button" className="text-sky-700" onClick={() => setMode('up')}>Create an account</button>}
            {mode === 'in' && <button type="button" className="text-slate-500" onClick={() => setMode('reset')}>Forgot password?</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
