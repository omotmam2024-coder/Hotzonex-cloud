/**
 * Money is integer minor units + ISO 4217 code. Never a float, never a
 * hard-coded symbol. SSP is primary, USD secondary; both have 2 minor digits.
 * (Phase 1 has no money features; this is the foundation Phase 3 builds on.)
 */

export const CURRENCIES = {
  SSP: { code: 'SSP', minorDigits: 2, name: 'South Sudanese pound' },
  USD: { code: 'USD', minorDigits: 2, name: 'US dollar' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const DEFAULT_CURRENCY: CurrencyCode = 'SSP';

export interface Money {
  /** Integer minor units (piasters, cents). bigint so large sums stay exact. */
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

export function money(amountMinor: bigint | number, currency: CurrencyCode): Money {
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) {
    throw new MoneyError(`minor units must be a safe integer, got ${amountMinor}`);
  }
  if (!isCurrencyCode(currency)) throw new MoneyError(`unsupported currency ${String(currency)}`);
  return Object.freeze({ amountMinor: BigInt(amountMinor), currency });
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError(`cannot combine ${a.currency} with ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function multiply(a: Money, quantity: number | bigint): Money {
  if (typeof quantity === 'number' && !Number.isInteger(quantity)) {
    throw new MoneyError('quantity must be an integer; use allocate() to split amounts');
  }
  return money(a.amountMinor * BigInt(quantity), a.currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

/**
 * Split `a` by integer ratios without losing a single minor unit; the
 * remainder goes to the first shares. allocate(100, [1,1,1]) → [34, 33, 33].
 */
export function allocate(a: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0 || ratios.some((r) => !Number.isInteger(r) || r < 0)) {
    throw new MoneyError('ratios must be non-negative integers');
  }
  const total = ratios.reduce((s, r) => s + BigInt(r), 0n);
  if (total === 0n) throw new MoneyError('ratios must not all be zero');
  const shares = ratios.map((r) => (a.amountMinor * BigInt(r)) / total);
  let remainder = a.amountMinor - shares.reduce((s, x) => s + x, 0n);
  const step = remainder >= 0n ? 1n : -1n;
  for (let i = 0; remainder !== 0n; i = (i + 1) % shares.length) {
    if (ratios[i] === 0) continue;
    shares[i] = (shares[i] as bigint) + step;
    remainder -= step;
  }
  return shares.map((s) => money(s, a.currency));
}

/**
 * Parse a user-typed decimal ("1,250.50", "1250.5", "-3") into minor units
 * using string arithmetic only. Rejects more decimals than the currency has.
 */
export function parseMoney(input: string, currency: CurrencyCode): Money {
  const digits = CURRENCIES[currency].minorDigits;
  const cleaned = input.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`"${input}" is not an amount`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > digits) throw new MoneyError(`${currency} has only ${digits} decimal places`);
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return money(sign ? -minor : minor, currency);
}

/** Exact decimal string, e.g. "1250.50". */
export function toDecimalString(a: Money): string {
  const digits = CURRENCIES[a.currency].minorDigits;
  const negative = a.amountMinor < 0n;
  const abs = negative ? -a.amountMinor : a.amountMinor;
  const base = 10n ** BigInt(digits);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole.toString()}${digits > 0 ? `.${fraction}` : ''}`;
}

/** Locale formatting with the ISO code (never a hard-coded "$"). */
export function formatMoney(a: Money, locale = 'en-SS'): string {
  const digits = CURRENCIES[a.currency].minorDigits;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Intl accepts decimal strings exactly (no float round-trip).
  return formatter.format(toDecimalString(a) as unknown as number);
}
