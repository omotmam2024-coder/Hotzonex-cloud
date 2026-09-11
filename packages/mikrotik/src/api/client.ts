import net from 'node:net';
import tls from 'node:tls';
import {
  MikrotikError,
  classifyRouterMessage,
  classifyTransportError,
  type MikrotikErrorStage,
} from '../errors.js';
import { SentenceDecoder, encodeSentence, parseAttributeWord } from './sentence.js';
import type { RawRecord } from '../parse.js';

export interface ApiClientOptions {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs: number;
  tlsOptions?: { rejectUnauthorized?: boolean; ca?: string };
}

export interface ApiCommand {
  /** e.g. "/system/resource/print" */
  command: string;
  /** Sent as "=key=value" */
  params?: Record<string, string>;
  /** Sent as "?key=value" (print filters) */
  query?: Record<string, string>;
  /** Restricts returned properties — keeps metered links cheap. */
  proplist?: readonly string[];
}

interface Pending {
  rows: RawRecord[];
  trap: { message: string; category: string | null } | null;
  stage: MikrotikErrorStage;
  resolve: (rows: RawRecord[]) => void;
  reject: (error: MikrotikError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One RouterOS API session over TCP (8728) or TLS (8729).
 * Commands are tagged so replies are matched even if RouterOS interleaves them.
 */
export class RouterosApiClient {
  private socket: net.Socket | null = null;
  private readonly decoder = new SentenceDecoder();
  private readonly pending = new Map<string, Pending>();
  private nextTag = 1;
  private closedError: MikrotikError | null = null;

  constructor(private readonly opts: ApiClientOptions) {}

  get isOpen(): boolean {
    return this.socket !== null && this.closedError === null;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    const stage: MikrotikErrorStage = this.opts.tls ? 'tls' : 'connect';
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: MikrotikError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        this.socket = null;
        reject(error);
      };
      const socket = this.opts.tls
        ? tls.connect({
            host: this.opts.host,
            port: this.opts.port,
            rejectUnauthorized: this.opts.tlsOptions?.rejectUnauthorized ?? true,
            ...(this.opts.tlsOptions?.ca ? { ca: this.opts.tlsOptions.ca } : {}),
          })
        : net.connect({ host: this.opts.host, port: this.opts.port });
      const timer = setTimeout(
        () => fail(new MikrotikError('TIMEOUT', 'connect', `no answer within ${this.opts.timeoutMs} ms`)),
        this.opts.timeoutMs,
      );
      socket.once('error', (err) => fail(classifyTransportError(err, stage)));
      socket.once(this.opts.tls ? 'secureConnect' : 'connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners('error');
        this.attach(socket);
        resolve();
      });
      this.socket = socket;
    });
  }

  private attach(socket: net.Socket): void {
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => {
      let sentences: string[][];
      try {
        sentences = this.decoder.push(chunk);
      } catch {
        this.shutdown(new MikrotikError('UNKNOWN', 'command', 'malformed reply: invalid framing'));
        return;
      }
      for (const sentence of sentences) this.handleSentence(sentence);
    });
    socket.on('error', (err) => this.shutdown(classifyTransportError(err, 'command')));
    socket.on('close', () => this.shutdown(new MikrotikError('UNREACHABLE', 'command', 'connection closed by router')));
  }

  private handleSentence(words: string[]): void {
    const [type, ...rest] = words;
    let tag: string | null = null;
    const attrs: RawRecord = {};
    for (const word of rest) {
      if (word.startsWith('.tag=')) {
        tag = word.slice(5);
        continue;
      }
      const kv = parseAttributeWord(word);
      if (kv) attrs[kv[0]] = kv[1];
    }

    if (type === '!fatal') {
      // Word after !fatal is the reason, not an attribute.
      const reason = rest.find((w) => !w.startsWith('.tag=')) ?? 'router closed the session';
      this.shutdown(new MikrotikError(classifyRouterMessage(reason, 'command'), 'command', reason));
      return;
    }

    const pending = this.resolvePending(tag);
    if (!pending) {
      // A reply we cannot attribute means the stream is out of sync; the session is unusable.
      this.shutdown(new MikrotikError('UNKNOWN', 'command', `malformed reply: unexpected ${type ?? 'empty'} sentence`));
      return;
    }

    switch (type) {
      case '!re':
        pending.entry.rows.push(attrs);
        return;
      case '!empty':
        // RouterOS ≥ 7.18: "no data" marker, always followed by !done.
        return;
      case '!trap':
        pending.entry.trap = { message: attrs['message'] ?? 'unspecified error', category: attrs['category'] ?? null };
        return;
      case '!done': {
        this.pending.delete(pending.tag);
        clearTimeout(pending.entry.timer);
        const trap = pending.entry.trap;
        if (trap) {
          const code = classifyRouterMessage(trap.message, pending.entry.stage);
          pending.entry.reject(new MikrotikError(code, pending.entry.stage, trap.message));
        } else {
          // Login and some commands return their payload as attributes on !done.
          if (Object.keys(attrs).length > 0) pending.entry.rows.push(attrs);
          pending.entry.resolve(pending.entry.rows);
        }
        return;
      }
      default:
        this.shutdown(new MikrotikError('UNKNOWN', 'command', `malformed reply: unknown reply word "${type ?? ''}"`));
    }
  }

  private resolvePending(tag: string | null): { tag: string; entry: Pending } | null {
    if (tag !== null) {
      const entry = this.pending.get(tag);
      return entry ? { tag, entry } : null;
    }
    // Untagged reply: only unambiguous when a single request is in flight.
    if (this.pending.size === 1) {
      const [only] = this.pending.entries();
      if (only) return { tag: only[0], entry: only[1] };
    }
    return null;
  }

  private shutdown(error: MikrotikError): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.socket?.destroy();
  }

  /** Low-level: send a sentence and collect rows until !done. */
  send(cmd: ApiCommand, stage: MikrotikErrorStage = 'command'): Promise<RawRecord[]> {
    if (!this.socket) return Promise.reject(new MikrotikError('UNREACHABLE', stage, 'not connected'));
    if (this.closedError) return Promise.reject(this.closedError);

    const tag = String(this.nextTag++);
    const words: string[] = [cmd.command];
    for (const [k, v] of Object.entries(cmd.params ?? {})) words.push(`=${k}=${v}`);
    if (cmd.proplist && cmd.proplist.length > 0) words.push(`=.proplist=${cmd.proplist.join(',')}`);
    for (const [k, v] of Object.entries(cmd.query ?? {})) words.push(`?${k}=${v}`);
    words.push(`.tag=${tag}`);

    return new Promise<RawRecord[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Protocol state is unknown after a timeout; drop the session.
        this.pending.delete(tag);
        reject(new MikrotikError('TIMEOUT', stage, `no reply within ${this.opts.timeoutMs} ms`));
        this.shutdown(new MikrotikError('TIMEOUT', stage, 'session dropped after timeout'));
      }, this.opts.timeoutMs);
      this.pending.set(tag, { rows: [], trap: null, stage, resolve, reject, timer });
      this.socket?.write(encodeSentence(words));
    });
  }

  async login(username: string, password: string): Promise<void> {
    const rows = await this.send({ command: '/login', params: { name: username, password } }, 'login');
    // Pre-6.43 routers answer with a challenge ("=ret=") instead of logging in.
    if (rows.some((r) => r['ret'] !== undefined)) {
      throw new MikrotikError(
        'INVALID_COMMAND',
        'login',
        'router uses the pre-6.43 challenge login; RouterOS v7 is required',
      );
    }
  }

  close(): void {
    if (!this.socket) return;
    if (!this.closedError) {
      try {
        this.socket.end(encodeSentence(['/quit']));
      } catch {
        // Socket already unusable; destroy below.
      }
    }
    this.shutdown(new MikrotikError('UNREACHABLE', 'command', 'session closed'));
    this.socket = null;
  }
}
