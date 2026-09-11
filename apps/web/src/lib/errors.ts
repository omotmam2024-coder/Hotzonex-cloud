import { DB_HINT_MESSAGES } from '@hotzonex/shared/errors';

/**
 * Every failure shown to a user goes through here and comes out as a plain
 * sentence. Raw database messages, stack traces and status codes never reach
 * the screen.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  constructor(
    readonly userMessage: string,
    readonly kind: 'network' | 'auth' | 'forbidden' | 'not_found' | 'validation' | 'rate_limited' | 'unknown' = 'unknown',
  ) {
    super(userMessage);
  }
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  hint?: unknown;
  status?: unknown;
  name?: unknown;
}

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out/i;

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = (error ?? {}) as ErrorLike;
  const message = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const hint = typeof e.hint === 'string' ? e.hint : '';
  const status = typeof e.status === 'number' ? e.status : 0;

  if (hint && DB_HINT_MESSAGES[hint]) {
    const kind = hint === 'rate_limited' ? 'rate_limited' : hint === 'forbidden' ? 'forbidden' : hint === 'not_found' ? 'not_found' : 'validation';
    return new AppError(DB_HINT_MESSAGES[hint], kind);
  }
  if (NETWORK.test(message) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return new AppError('Cannot reach Hotzonex Cloud. Check your internet connection and try again.', 'network');
  }
  // Supabase Auth
  if (/invalid login credentials/i.test(message)) return new AppError('Email or password is incorrect.', 'auth');
  if (/email not confirmed/i.test(message)) return new AppError('Confirm your email address first — check your inbox for the link.', 'auth');
  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    return new AppError('Too many attempts. Wait a few minutes before trying again.', 'rate_limited');
  }
  if (/weak password|password should/i.test(message)) {
    return new AppError('Choose a stronger password: at least 10 characters with letters and digits.', 'validation');
  }
  if (/jwt|refresh token|session/i.test(message) && status === 401) {
    return new AppError('Your session has expired. Sign in again.', 'auth');
  }
  if (/database error saving new user/i.test(message)) {
    return new AppError(DB_HINT_MESSAGES['invite_invalid'] ?? 'This invitation could not be used.', 'validation');
  }
  // Postgres / PostgREST
  if (code === '42501' || status === 403) return new AppError(DB_HINT_MESSAGES['forbidden'] as string, 'forbidden');
  if (code === '23505') return new AppError('That name is already in use. Choose another.', 'validation');
  if (code === '23514' || code === '22023' || code === '22P02') return new AppError('Some of the values are not valid. Check the form and try again.', 'validation');
  if (code === 'PGRST116' || code === 'P0002' || status === 404) return new AppError(DB_HINT_MESSAGES['not_found'] as string, 'not_found');
  return new AppError('Something went wrong on our side. Please try again in a moment.', 'unknown');
}

export function userMessage(error: unknown): string {
  return toAppError(error).userMessage;
}

/** Throw an AppError for a Supabase { data, error } result; otherwise return data. */
export function unwrap<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw toAppError(result.error);
  if (result.data === null || result.data === undefined) throw new AppError(DB_HINT_MESSAGES['not_found'] as string, 'not_found');
  return result.data as NonNullable<T>;
}
