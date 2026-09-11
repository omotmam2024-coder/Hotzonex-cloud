import { z } from 'zod';

/** Per-tenant settings. Mirrors app.setting_is_valid() in the database. */
export const SETTINGS = {
  health_poll_interval_seconds: {
    label: 'Health poll interval',
    description: 'How often each router is checked. Longer intervals use less of a metered link.',
    schema: z.number().int().min(60).max(3600),
    defaultValue: 300,
    unit: 'seconds',
  },
  offline_after_missed_polls: {
    label: 'Mark offline after',
    description: 'Consecutive failed polls before a router is shown as offline. Avoids flapping on one lost packet.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 2,
    unit: 'missed polls',
  },
  metrics_retention_days: {
    label: 'Keep health history for',
    description: 'Older health samples are deleted by the connector.',
    schema: z.number().int().min(7).max(365),
    defaultValue: 30,
    unit: 'days',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function settingValue(key: SettingKey, rows: ReadonlyArray<{ key: string; value: unknown }>): number {
  const row = rows.find((r) => r.key === key);
  const parsed = SETTINGS[key].schema.safeParse(row?.value);
  return parsed.success ? parsed.data : SETTINGS[key].defaultValue;
}
