import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@hotzonex.com' },
    update: {},
    create: {
      email: 'admin@hotzonex.com',
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN'
    }
  });

  const locations = ['Hotzonex Lologo One', 'Hotzonex Gorom', 'Hotzonex Juba'];

  for (const location of locations) {
    await prisma.location.upsert({
      where: { id: `seed-${location}` },
      update: {},
      create: {
        id: `seed-${location}`,
        name: location,
        status: 'ACTIVE',
        description: 'Demo location'
      }
    });
  }

  await prisma.router.upsert({
    where: { id: 'seed-demo-router' },
    update: {},
    create: {
      id: 'seed-demo-router',
      name: 'Demo Router',
      ipAddress: '203.0.113.10',
      protocol: 'API',
      port: 8728,
      username: 'admin',
      password: 'demo-password',
      useSsl: false,
      status: 'ONLINE',
      healthState: 'HEALTHY',
      identity: 'Hotzonex Demo Router',
      routerOsVersion: '7.14.3',
      isDemo: true
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
