import { prisma } from '@/lib/prisma';
import { MockMikrotikProvider } from '@/lib/mikrotik/providers';

export async function testRouterConnection(input: {
  ipAddress: string;
  protocol: 'API' | 'API_SSL' | 'REST';
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
}) {
  const provider = new MockMikrotikProvider();

  try {
    await provider.connect();
    const result = await provider.testConnection();

    return {
      ok: true,
      data: {
        ...result,
        routerOsVersion: result.routerOsVersion || '7.14.3',
        identity: result.identity || 'Hotzonex Demo Router'
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Router test failed.'
    };
  }
}

export async function getRouterSummary() {
  const [totalRouters, onlineRouters, offlineRouters, activeUsers] = await Promise.all([
    prisma.router.count(),
    prisma.router.count({ where: { status: 'ONLINE' } }),
    prisma.router.count({ where: { status: 'OFFLINE' } }),
    prisma.hotspotSession.count()
  ]);

  return {
    totalRouters,
    onlineRouters,
    offlineRouters,
    activeUsers
  };
}
