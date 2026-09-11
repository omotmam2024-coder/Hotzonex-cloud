import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const locations = await prisma.location.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(locations);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();

  const location = await prisma.location.create({
    data: {
      name: String(body.name || ''),
      address: body.address || null,
      description: body.description || null,
      latitude: body.latitude ? Number(body.latitude) : null,
      longitude: body.longitude ? Number(body.longitude) : null,
      status: String(body.status || 'ACTIVE'),
      contact: body.contact || null,
      openingHours: body.openingHours || null
    }
  });

  return NextResponse.json(location, { status: 201 });
}
