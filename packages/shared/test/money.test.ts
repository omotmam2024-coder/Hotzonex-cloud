import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  add,
  allocate,
  compare,
  formatMoney,
  money,
  multiply,
  parseMoney,
  subtract,
  toDecimalString,
} from '../src/money.js';

describe('money', () => {
  it('stores integer minor units, never floats', () => {
    expect(money(150, 'SSP').amountMinor).toBe(150n);
    expect(() => money(1.5, 'SSP')).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(MoneyError);
  });

  it('adds, subtracts and multiplies exactly', () => {
    // The classic float failure: 0.1 + 0.2
    expect(toDecimalString(add(parseMoney('0.10', 'USD'), parseMoney('0.20', 'USD')))).toBe('0.30');
    expect(toDecimalString(subtract(money(1000, 'SSP'), money(1, 'SSP')))).toBe('9.99');
    expect(multiply(money(2500, 'SSP'), 3).amountMinor).toBe(7500n);
    expect(() => multiply(money(1, 'SSP'), 1.5)).toThrow(MoneyError);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(1, 'SSP'), money(1, 'USD'))).toThrow(/cannot combine SSP with USD/);
    expect(() => compare(money(1, 'SSP'), money(1, 'USD'))).toThrow(MoneyError);
  });

  it('allocates without losing a minor unit', () => {
    const parts = allocate(money(100, 'SSP'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(allocate(money(-100, 'USD'), [1, 1, 1]).reduce((s, p) => s + p.amountMinor, 0n)).toBe(-100n);
    expect(allocate(money(5, 'USD'), [0, 1]).map((p) => p.amountMinor)).toEqual([0n, 5n]);
    expect(() => allocate(money(5, 'USD'), [0, 0])).toThrow(MoneyError);
  });

  it('parses typed amounts with string arithmetic', () => {
    expect(parseMoney('1,250.5', 'SSP').amountMinor).toBe(125050n);
    expect(parseMoney('-3', 'USD').amountMinor).toBe(-300n);
    expect(parseMoney('9007199254740993.99', 'SSP').amountMinor).toBe(900719925474099399n);
    expect(() => parseMoney('1.234', 'USD')).toThrow(/only 2 decimal places/);
    expect(() => parseMoney('abc', 'USD')).toThrow(MoneyError);
  });

  it('formats with the ISO code, not a hard-coded symbol', () => {
    const s = formatMoney(money(125050, 'SSP'), 'en');
    expect(s).toContain('SSP');
    expect(s).toContain('1,250.50');
    expect(formatMoney(money(199, 'USD'), 'en')).toContain('USD');
    expect(formatMoney(money(199, 'USD'), 'en')).not.toContain('$');
  });

  it('compares', () => {
    expect(compare(money(1, 'SSP'), money(2, 'SSP'))).toBe(-1);
    expect(compare(money(2, 'SSP'), money(2, 'SSP'))).toBe(0);
  });
});
