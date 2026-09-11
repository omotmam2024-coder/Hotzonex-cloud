import { describe, expect, it } from 'vitest';
import { humanStatusReason } from '@/lib/status-reason';

describe('humanStatusReason', () => {
  it('turns connector codes into titles and drops errno noise', () => {
    expect(humanStatusReason('UNREACHABLE: ehostunreach')).toBe('Router unreachable');
    expect(humanStatusReason('AUTH_FAILED: invalid user name or password (6)')).toBe('Login rejected — invalid user name or password (6)');
    expect(humanStatusReason('TIMEOUT')).toBe('Router did not answer in time');
  });
  it('passes health sentences through', () => {
    expect(humanStatusReason('CPU at 91%')).toBe('CPU at 91%');
    expect(humanStatusReason(null)).toBeNull();
  });
});
