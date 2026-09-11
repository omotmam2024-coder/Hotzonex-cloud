import { describe, expect, it } from 'vitest';
import { SentenceDecoder, decodeLength, encodeLength, encodeSentence, parseAttributeWord } from '../src/api/sentence.js';

describe('RouterOS word length encoding', () => {
  const cases: Array<[number, number[]]> = [
    [0, [0x00]],
    [0x7f, [0x7f]],
    [0x80, [0x80, 0x80]],
    [0x3fff, [0xbf, 0xff]],
    [0x4000, [0xc0, 0x40, 0x00]],
    [0x1fffff, [0xdf, 0xff, 0xff]],
    [0x200000, [0xe0, 0x20, 0x00, 0x00]],
    [0xfffffff, [0xef, 0xff, 0xff, 0xff]],
    [0x10000000, [0xf0, 0x10, 0x00, 0x00, 0x00]],
  ];

  it.each(cases)('encodes and decodes %i', (len, bytes) => {
    expect([...encodeLength(len)]).toEqual(bytes);
    expect(decodeLength(Uint8Array.from(bytes), 0)).toEqual({ length: len, size: bytes.length });
  });

  it('asks for more bytes when a prefix is truncated', () => {
    expect(decodeLength(Uint8Array.of(0xc0, 0x40), 0)).toBeNull();
  });

  it('rejects reserved control bytes', () => {
    expect(() => decodeLength(Uint8Array.of(0xf8), 0)).toThrow(RangeError);
  });
});

describe('SentenceDecoder', () => {
  it('reassembles sentences split across arbitrary chunk boundaries', () => {
    const long = 'x'.repeat(300);
    const bytes = new Uint8Array([
      ...encodeSentence(['!re', '=name=ether1', `=comment=${long}`]),
      ...encodeSentence(['!done']),
    ]);
    const decoder = new SentenceDecoder();
    const out: string[][] = [];
    for (let i = 0; i < bytes.length; i += 7) out.push(...decoder.push(bytes.subarray(i, i + 7)));
    expect(out).toEqual([['!re', '=name=ether1', `=comment=${long}`], ['!done']]);
  });

  it('decodes UTF-8 identities', () => {
    const decoder = new SentenceDecoder();
    expect(decoder.push(encodeSentence(['=name=Jùba-Gorom']))).toEqual([['=name=Jùba-Gorom']]);
  });

  it('refuses absurd word sizes instead of buffering forever', () => {
    const decoder = new SentenceDecoder({ maxWordBytes: 10 });
    expect(() => decoder.push(Uint8Array.of(0x20))).toThrow(RangeError);
  });
});

describe('parseAttributeWord', () => {
  it('keeps "=" inside values', () => {
    expect(parseAttributeWord('=comment=a=b=c')).toEqual(['comment', 'a=b=c']);
    expect(parseAttributeWord('=.id=*1A')).toEqual(['.id', '*1A']);
    expect(parseAttributeWord('!re')).toBeNull();
  });
});
