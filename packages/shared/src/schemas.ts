import { z } from 'zod';
import { API_PROTOCOLS, DEFAULT_PORTS } from '@hotzonex/mikrotik/types';
import { API_PASSWORD_PATTERN, API_USERNAME_PATTERN, WG_KEY_PATTERN } from '@hotzonex/mikrotik/setup-script';
import { INVITABLE_ROLES } from './roles.js';

/**
 * Form and boundary schemas. The browser validates with these before calling
 * Supabase; the database enforces the same rules again with CHECK constraints
 * and RLS, so a bypassed client gains nothing.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')).pipe(z.string().max(320));

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one digit.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const inviteTokenSchema = z.string().regex(/^[0-9a-f]{64}$/, 'This invitation link is not valid.');

export const signupSchema = z
  .object({
    fullName: trimmed(120).min(1, 'Enter your name.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
export type SignupInput = z.infer<typeof signupSchema>;

export const changePasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });

export const profileSchema = z.object({ fullName: trimmed(120) });

// -----------------------------------------------------------------------------
// Locations
// -----------------------------------------------------------------------------
export const LOCATION_STATUSES = ['active', 'inactive', 'maintenance'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

const coordinate = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      if (typeof v === 'string' && v.trim() === '') return null;
      const n = typeof v === 'number' ? v : Number(v.trim());
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `${label} must be between ${min} and ${max}.` });
        return z.NEVER;
      }
      return Math.round(n * 1e6) / 1e6;
    })
    .nullable();

export const locationSchema = z
  .object({
    name: trimmed(120).min(1, 'Enter a name.'),
    address: optionalText(300),
    lat: coordinate(-90, 90, 'Latitude'),
    lng: coordinate(-180, 180, 'Longitude'),
    contact: optionalText(200),
    opening_hours: optionalText(200),
    status: z.enum(LOCATION_STATUSES),
  })
  .refine((v) => (v.lat === null) === (v.lng === null), {
    message: 'Enter both latitude and longitude, or neither.',
    path: ['lng'],
  });
export type LocationInput = z.infer<typeof locationSchema>;

// -----------------------------------------------------------------------------
// Routers
// -----------------------------------------------------------------------------
export const routerSchema = z
  .object({
    name: trimmed(80).min(1, 'Enter a name.'),
    location_id: z.uuid().nullable(),
    api_protocol: z.enum(API_PROTOCOLS as [string, ...string[]]).transform((v) => v as (typeof API_PROTOCOLS)[number]),
    api_port: z.coerce.number().int().min(1, 'Port must be 1–65535.').max(65535, 'Port must be 1–65535.'),
    use_ssl: z.boolean(),
    notes: optionalText(2000),
  })
  .transform((v) => ({
    ...v,
    // api never uses TLS and api_ssl always does; only REST lets the user choose.
    use_ssl: v.api_protocol === 'api' ? false : v.api_protocol === 'api_ssl' ? true : v.use_ssl,
  }));
export type RouterInput = z.infer<typeof routerSchema>;

export function defaultPortFor(protocol: (typeof API_PROTOCOLS)[number], useSsl: boolean): number {
  const p = DEFAULT_PORTS[protocol];
  return protocol === 'api_ssl' || useSsl ? p.tls : p.plain;
}

export const credentialsSchema = z.object({
  username: z.string().trim().regex(API_USERNAME_PATTERN, 'Username: 3–32 lowercase letters, digits or dashes, starting with a letter.'),
  password: z.string().min(8, 'Password is too short.').max(128, 'Password is too long.'),
});
export type CredentialsInput = z.infer<typeof credentialsSchema>;

export const generatedApiPasswordSchema = z.string().regex(API_PASSWORD_PATTERN);

export const wgPublicKeySchema = z.string().trim().regex(WG_KEY_PATTERN, 'That is not a WireGuard public key (44 characters ending in "=").');

// -----------------------------------------------------------------------------
// Team
// -----------------------------------------------------------------------------
export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES as unknown as ['ADMIN', 'TECHNICIAN']),
});
export type InviteInput = z.infer<typeof inviteSchema>;

// -----------------------------------------------------------------------------
// Organization
// -----------------------------------------------------------------------------
export const organizationSchema = z.object({
  name: trimmed(120).min(1, 'Enter a name.'),
  currency_default: z.enum(['SSP', 'USD']),
});
