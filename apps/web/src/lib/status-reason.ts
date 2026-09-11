import { MIKROTIK_ERROR_MESSAGES } from '@hotzonex/shared/errors';
import { isMikrotikErrorCode } from '@hotzonex/mikrotik/errors';

/**
 * The connector stores failure reasons as "CODE: detail" (e.g. "UNREACHABLE:
 * ehostunreach"). Show the human title instead of the code; health reasons
 * such as "CPU at 91%" are already sentences and pass through unchanged.
 */
export function humanStatusReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const match = /^([A-Z_]+)(?::\s*(.*))?$/.exec(reason.trim());
  if (match && isMikrotikErrorCode(match[1])) {
    const title = MIKROTIK_ERROR_MESSAGES[match[1]].title;
    const detail = match[2]?.trim();
    // Only keep details that read as words, not socket errno codes.
    return detail && /\s/.test(detail) ? `${title} — ${detail}` : title;
  }
  return reason;
}
