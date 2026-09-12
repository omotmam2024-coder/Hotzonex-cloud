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

/** 10.x, 192.168.x and 172.16–172.31.x — the ranges a router on a private network sits in. */
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * An IPv4 address the connector may dial. The connector opens the connection,
 * so this decides where it points: the database enforces the same rules with
 * CHECK constraints, and these messages exist to say why while the technician
 * is still typing.
 */
export const routerHostSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'Enter an IPv4 address, for example 192.168.88.1.')
  .refine((v) => v.split('.').every((o) => Number(o) <= 255), 'Each part of the address must be 0–255.')
  .refine((v) => PRIVATE_IPV4.test(v), 'Enter the router’s address on your private network — 192.168.x.x, 10.x.x.x or 172.16–31.x.x.')
  .refine((v) => !v.startsWith('10.77.'), '10.77.x.x is reserved for Hotzonex tunnels. Use the router’s address on your network.');

/**
 * Adding a router that is on the same network as the connector: its address and
 * an existing RouterOS login. Unlike the restricted user the setup script
 * creates, this is a login a person already has, so the username rules are
 * RouterOS's and the password may be anything — including blank, which is how
 * older boards ship.
 */
export const routerConnectionSchema = z.object({
  name: trimmed(80).min(1, 'Enter a name.'),
  host: routerHostSchema,
  api_protocol: z.enum(API_PROTOCOLS as [string, ...string[]]).transform((v) => v as (typeof API_PROTOCOLS)[number]),
  api_port: z.coerce.number().int().min(1, 'Port must be 1–65535.').max(65535, 'Port must be 1–65535.'),
  use_ssl: z.boolean(),
  username: z.string().trim().min(1, 'Enter the router’s username.').max(64, 'Username is too long.'),
  password: z.string().max(128, 'Password is too long.'),
  notes: optionalText(2000),
});
export type RouterConnectionInput = z.infer<typeof routerConnectionSchema>;

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
