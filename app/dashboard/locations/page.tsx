import { prisma } from '@/lib/prisma';

export default async function LocationsPage() {
  const locations = await prisma.location.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Locations</p>
            <h1 className="mt-2 text-3xl font-bold">Hotspot Locations</h1>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <div key={location.id} className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{location.name}</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">{location.status}</span>
              </div>
              <p className="mt-3 text-sm text-slate-300">{location.address || 'Address not provided'}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-400">
                <div>Contact</div>
                <div className="text-right">{location.contact || 'N/A'}</div>
                <div>Opening hours</div>
                <div className="text-right">{location.openingHours || 'N/A'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
