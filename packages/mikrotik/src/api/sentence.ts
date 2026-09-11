/**
 * RouterOS API wire format: a sentence is a sequence of length-prefixed
 * words terminated by a zero-length word. Lengths use a 1–5 byte
 * variable-length big-endian encoding.
 * https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function encodeLength(len: number): Uint8Array {
  if (!Number.isInteger(len) || len < 0) throw new RangeError(`invalid word length ${len}`);
  if (len < 0x80) return Uint8Array.of(len);
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Uint8Array.of((v >>> 8) & 0xff, v & 0xff);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Uint8Array.of((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  if (len < 0x10000000) {
    const v = (len | 0xe0000000) >>> 0;
    return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  if (len > 0xffffffff) throw new RangeError(`word too long: ${len}`);
  return Uint8Array.of(0xf0, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
}

/**
 * Decode a length prefix at `offset`. Returns null when more bytes are needed.
 * Throws on a control byte RouterOS never sends (0xF8–0xFF).
 */
export function decodeLength(buf: Uint8Array, offset: number): { length: number; size: number } | null {
  if (offset >= buf.length) return null;
  const b0 = buf[offset] as number;
  let size: number;
  if ((b0 & 0x80) === 0x00) size = 1;
  else if ((b0 & 0xc0) === 0x80) size = 2;
  else if ((b0 & 0xe0) === 0xc0) size = 3;
  else if ((b0 & 0xf0) === 0xe0) size = 4;
  else if (b0 === 0xf0) size = 5;
  else throw new RangeError(`reserved length control byte 0x${b0.toString(16)}`);

  if (offset + size > buf.length) return null;
  const at = (i: number): number => buf[offset + i] as number;
  switch (size) {
    case 1:
      return { length: b0, size };
    case 2:
      return { length: ((b0 & 0x3f) << 8) | at(1), size };
    case 3:
      return { length: ((b0 & 0x1f) << 16) | (at(1) << 8) | at(2), size };
    case 4:
      return { length: (((b0 & 0x0f) << 24) | (at(1) << 16) | (at(2) << 8) | at(3)) >>> 0, size };
    default:
      return { length: ((at(1) << 24) | (at(2) << 16) | (at(3) << 8) | at(4)) >>> 0, size };
  }
}

export function encodeSentence(words: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const word of words) {
    const bytes = encoder.encode(word);
    const prefix = encodeLength(bytes.length);
    parts.push(prefix, bytes);
    total += prefix.length + bytes.length;
  }
  parts.push(Uint8Array.of(0));
  total += 1;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Streaming decoder: feed arbitrary chunks, receive complete sentences. */
export class SentenceDecoder {
  private buffer: Uint8Array = new Uint8Array(0);
  private words: string[] = [];
  /** Guard against a hostile or broken peer announcing absurd word sizes. */
  private readonly maxWordBytes: number;

  constructor(opts: { maxWordBytes?: number } = {}) {
    this.maxWordBytes = opts.maxWordBytes ?? 16 * 1024 * 1024;
  }

  push(chunk: Uint8Array): string[][] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);

    const sentences: string[][] = [];
    let offset = 0;
    for (;;) {
      const len = decodeLength(merged, offset);
      if (!len) break;
      if (len.length > this.maxWordBytes) throw new RangeError(`word of ${len.length} bytes exceeds limit`);
      const start = offset + len.size;
      if (start + len.length > merged.length) break;
      offset = start + len.length;
      if (len.length === 0) {
        sentences.push(this.words);
        this.words = [];
      } else {
        this.words.push(decoder.decode(merged.subarray(start, start + len.length)));
      }
    }
    this.buffer = merged.slice(offset);
    return sentences;
  }
}

/** Split an attribute word "=key=value" (value may itself contain "="). */
export function parseAttributeWord(word: string): [string, string] | null {
  if (!word.startsWith('=')) return null;
  const idx = word.indexOf('=', 1);
  if (idx === -1) return [word.slice(1), ''];
  return [word.slice(1, idx), word.slice(idx + 1)];
}
