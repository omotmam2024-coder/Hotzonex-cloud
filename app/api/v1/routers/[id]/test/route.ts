import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/rbac';
import { testRouterConnection } from '@/lib/services/router.service';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN']);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const result = await testRouterConnection({
    ipAddress: String(body.ipAddress || ''),
    protocol: String(body.protocol || 'API') as 'API' | 'API_SSL' | 'REST',
    port: Number(body.port || 8728),
    username: String(body.username || ''),
    password: String(body.password || ''),
    useSsl: Boolean(body.useSsl)
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
