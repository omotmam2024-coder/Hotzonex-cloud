import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function RoutersPage() {
  const routers = await prisma.router.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Routing</p>
            <h1 className="mt-2 text-3xl font-bold">Routers</h1>
          </div>
          <Link href="/dashboard/routers/new" className="rounded-md bg-blue-600 px-4 py-2 font-medium">
            Add MikroTik Router
          </Link>
        </div>

        <div className="card overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-800/80 text-slate-300">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">RouterOS</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routers.map((router) => (
                <tr key={router.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{router.name}</td>
                  <td className="px-4 py-3">{router.locationId || 'Unassigned'}</td>
                  <td className="px-4 py-3">{router.ipAddress}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                      {router.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{router.routerOsVersion || 'Not yet discovered'}</td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/routers/${router.id}`} className="text-blue-300 hover:text-blue-200">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
