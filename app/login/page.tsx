export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Hotzonex Cloud</p>
        <h1 className="mt-3 text-3xl font-bold">Login</h1>
        <form className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span>Email</span>
            <input type="email" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" defaultValue="admin@hotzonex.com" />
          </label>
          <label className="block space-y-2">
            <span>Password</span>
            <input type="password" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" defaultValue="admin123" />
          </label>
          <button type="submit" className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium">
            Sign In
          </button>
        </form>
      </div>
    </main>
  );
}
