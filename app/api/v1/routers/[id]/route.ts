import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/rbac';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const router = await prisma.router.findUnique({ where: { id: params.id } });

  if (!router) {
    return NextResponse.json({ error: 'Router not found.' }, { status: 404 });
  }

  return NextResponse.json(router);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();

  const router = await prisma.router.update({
    where: { id: params.id },
    data: {
      name: body.name,
      ipAddress: body.ipAddress,
      protocol: body.protocol,
      port: body.port,
      username: body.username,
      password: body.password,
      description: body.description,
      status: body.status
    }
  });

  return NextResponse.json(router);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  await prisma.router.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
