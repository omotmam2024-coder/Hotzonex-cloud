/**
 * Role capabilities as the UI needs them. These mirror the RLS policies in
 * supabase/migrations — the database is the authority; this only decides
 * which controls to render. A check that lives only here does not exist.
 */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN', 'RESELLER', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  TECHNICIAN: 'Technician',
  RESELLER: 'Reseller',
  CUSTOMER: 'Customer',
};

/** Roles with a Phase 1 UI. RESELLER and CUSTOMER exist in the data model only. */
export const STAFF_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN'];
export const INVITABLE_ROLES: readonly Role[] = ['ADMIN', 'TECHNICIAN'];

export interface Capabilities {
  viewNetwork: boolean;
  manageLocations: boolean;
  createRouters: boolean;
  editRouters: boolean;
  deleteRouters: boolean;
  runRouterActions: boolean;
  manageSettings: boolean;
  manageTeam: boolean;
  viewAudit: boolean;
}

export function capabilitiesFor(role: Role | null | undefined): Capabilities {
  const admin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const operator = admin || role === 'TECHNICIAN';
  return {
    viewNetwork: operator,
    manageLocations: admin,
    createRouters: operator,
    editRouters: operator,
    deleteRouters: admin,
    runRouterActions: operator,
    manageSettings: admin,
    manageTeam: admin,
    viewAudit: operator,
  };
}

export function isStaffRole(role: unknown): role is Role {
  return typeof role === 'string' && (STAFF_ROLES as readonly string[]).includes(role);
}
