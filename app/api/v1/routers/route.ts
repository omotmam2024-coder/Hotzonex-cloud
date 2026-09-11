import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const routers = await prisma.router.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json(routers);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();

  const router = await prisma.router.create({
    data: {
      name: String(body.name || ''),
      ipAddress: String(body.ipAddress || ''),
      protocol: String(body.protocol || 'API') as 'API' | 'API_SSL' | 'REST',
      port: Number(body.port || 8728),
      username: String(body.username || ''),
      password: String(body.password || ''),
      useSsl: Boolean(body.useSsl),
      description: String(body.description || ''),
      status: 'OFFLINE'
    }
  });

  return NextResponse.json(router, { status: 201 });
}
