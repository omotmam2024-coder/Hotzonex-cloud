import { useState } from 'react';
import { useApp } from '../lib/app';
import { supabase, errText } from '../lib/supabase';
import { Button, ErrorBox, Field, InfoBox, Input } from '../components/ui';

export default function OnboardingPage() {
  const { reload, signOut, session } = useApp();
  const [name, setName] = useState('Hotzonex');
  const [site, setSite] = useState('Jebel Iraq Head Office');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.rpc('create_tenant', { p_name: name.trim(), p_first_site: site.trim() });
    setBusy(false);
    if (error) { setError(errText(error)); return; }
    await reload();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold">Set up your business</h1>
        <p className="mt-1 text-slate-600">You become the owner. Add more sites, plans, routers and staff afterwards.</p>
        <form onSubmit={create} className="mt-6 grid gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="First site" hint="Each site has its own router, prices and opening hours.">
            <Input value={site} onChange={(e) => setSite(e.target.value)} required />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <Button busy={busy} size="lg">Create business</Button>
        </form>
        <div className="mt-4">
          <InfoBox>
            Joining someone else's business? Ask the owner to add <b>{session?.user.email}</b> under Settings → Staff,
            then <button className="underline" onClick={() => reload()}>refresh</button>.
          </InfoBox>
        </div>
        <button onClick={signOut} className="mt-4 text-sm text-slate-500">Sign out</button>
      </div>
    </div>
  );
}
