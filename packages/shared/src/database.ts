/** Named row types over the generated schema. Never hand-write row shapes. */
import type { Database, Enums, Tables, TablesInsert, TablesUpdate, Json } from './database.types.js';

export type { Database, Enums, Tables, TablesInsert, TablesUpdate, Json };

export type TenantRow = Tables<'tenants'>;
export type ProfileRow = Tables<'profiles'>;
export type InviteRow = Tables<'invites'>;
export type LocationRow = Tables<'locations'>;
export type RouterRow = Tables<'routers'>;
export type RouterInterfaceRow = Tables<'router_interfaces'>;
export type RouterMetricRow = Tables<'router_metrics'>;
export type HotspotServerRow = Tables<'hotspot_servers'>;
export type HotspotProfileRow = Tables<'hotspot_profiles'>;
export type SyncDriftRow = Tables<'sync_drift'>;
export type JobRow = Tables<'jobs'>;
export type AuditLogRow = Tables<'audit_logs'>;
export type SystemSettingRow = Tables<'system_settings'>;
export type ConnectorStatusRow = Tables<'connector_status'>;

export type AppRole = Enums<'app_role'>;
export type RouterStatusEnum = Enums<'router_status'>;
export type ApiProtocolEnum = Enums<'api_protocol'>;
export type CredentialsStatus = Enums<'credentials_status'>;
