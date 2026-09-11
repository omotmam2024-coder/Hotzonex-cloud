import { testRouterConnection } from '@/lib/services/router.service';

export default function NewRouterPage() {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Router onboarding</p>
          <h1 className="mt-2 text-3xl font-bold">Add MikroTik Router</h1>
        </div>

        <form action={async (formData) => {
          'use server';
          const result = await testRouterConnection({
            ipAddress: String(formData.get('ipAddress') || ''),
            protocol: String(formData.get('protocol') || 'API') as 'API' | 'API_SSL' | 'REST',
            port: Number(formData.get('port') || 8728),
            username: String(formData.get('username') || ''),
            password: String(formData.get('password') || ''),
            useSsl: formData.get('useSsl') === 'on'
          });

          if (!result.ok) {
            throw new Error(result.error || 'Connection failed.');
          }
        }} className="card space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span>Router Name</span>
              <input name="name" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="space-y-2">
              <span>Location</span>
              <input name="location" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="space-y-2">
              <span>IP Address / Hostname</span>
              <input name="ipAddress" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="space-y-2">
              <span>API Protocol</span>
              <select name="protocol" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
                <option value="API">MikroTik API</option>
                <option value="API_SSL">MikroTik API-SSL</option>
                <option value="REST">RouterOS REST</option>
              </select>
            </label>
            <label className="space-y-2">
              <span>API Port</span>
              <input name="port" defaultValue={8728} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="space-y-2">
              <span>Username</span>
              <input name="username" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span>Password</span>
              <input type="password" name="password" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
            </label>
            <label className="flex items-center gap-2 md:col-span-2">
              <input type="checkbox" name="useSsl" />
              <span>Use SSL</span>
            </label>
          </div>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 font-medium">
              Test Connection
            </button>
            <button type="button" className="rounded-md border border-slate-700 px-4 py-2 font-medium">
              Save Offline Router
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
