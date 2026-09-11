import { NextRequest } from 'next/server';
import { getCurrentUser } from './auth';

export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'TECHNICIAN' | 'RESELLER' | 'CUSTOMER';

const roleHierarchy: Record<RoleName, RoleName[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN', 'RESELLER', 'CUSTOMER'],
  ADMIN: ['ADMIN', 'TECHNICIAN', 'RESELLER', 'CUSTOMER'],
  TECHNICIAN: ['TECHNICIAN', 'CUSTOMER'],
  RESELLER: ['RESELLER', 'CUSTOMER'],
  CUSTOMER: ['CUSTOMER']
};

export async function requireAuth(request: NextRequest) {
  const user = await getCurrentUser(request);

  if (!user) {
    return { ok: false as const, status: 401, error: 'Unauthorized' };
  }

  return { ok: true as const, user };
}

export async function requireRole(request: NextRequest, allowedRoles: RoleName[]) {
  const auth = await requireAuth(request);

  if (!auth.ok) {
    return auth;
  }

  const userRole = auth.user.role as RoleName;
  const allowed = allowedRoles.some((role) => roleHierarchy[role]?.includes(userRole) || userRole === role);

  if (!allowed) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, user: auth.user };
}
