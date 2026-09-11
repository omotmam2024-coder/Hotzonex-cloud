/**
 * Generates packages/shared/src/database.types.ts from supabase/migrations
 * WITHOUT Docker: applies every migration to an in-process Postgres (PGlite)
 * and introspects the catalog, emitting the same `Database` shape as
 * `supabase gen types typescript`. When the local Supabase stack is running,
 * `pnpm db:types` uses the Supabase CLI instead; both read the same migrations.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, SUPABASE_DIR } from '../tests/harness.js';

const OUT = join(SUPABASE_DIR, '..', 'packages', 'shared', 'src', 'database.types.ts');

interface TypeInfo {
  oid: number;
  typname: string;
  typtype: string;
  typelem: number;
  typrelid: number;
  nspname: string;
}

const db = await createTestDb({ fresh: true });

const types = new Map<number, TypeInfo>();
for (const t of (
  await db.query<TypeInfo>(
    `select t.oid::int as oid, t.typname, t.typtype, t.typelem::int as typelem, t.typrelid::int as typrelid, n.nspname
       from pg_type t join pg_namespace n on n.oid = t.typnamespace`,
  )
).rows) {
  types.set(t.oid, t);
}

const enums = (
  await db.query<{ name: string; labels: string[] }>(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by t.typname order by t.typname`,
  )
).rows;
const enumNames = new Set(enums.map((e) => e.name));

const BASE: Record<string, string> = {
  bool: 'boolean',
  int2: 'number', int4: 'number', int8: 'number', float4: 'number', float8: 'number', numeric: 'number', oid: 'number',
  text: 'string', varchar: 'string', bpchar: 'string', char: 'string', name: 'string', uuid: 'string', citext: 'string',
  date: 'string', time: 'string', timetz: 'string', timestamp: 'string', timestamptz: 'string', interval: 'string',
  json: 'Json', jsonb: 'Json',
  bytea: 'string',
  void: 'undefined',
  record: 'Record<string, unknown>',
};

interface Column {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  is_identity: 'YES' | 'NO';
  identity_generation: string | null;
  is_generated: string;
  atttypid: number;
}

const columns = (
  await db.query<Column>(
    `select c.table_name, c.column_name, c.is_nullable, c.column_default, c.is_identity, c.identity_generation,
            c.is_generated, a.atttypid::int as atttypid
       from information_schema.columns c
       join pg_class k on k.relname = c.table_name
       join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
       join pg_attribute a on a.attrelid = k.oid and a.attname = c.column_name
      where c.table_schema = 'public'
      order by c.table_name, c.ordinal_position`,
  )
).rows;

function tsType(oid: number, compositeAsRow = true): string {
  const t = types.get(oid);
  if (!t) return 'unknown';
  if (t.typtype === 'e') return enumNames.has(t.typname) ? `Database["public"]["Enums"]["${t.typname}"]` : 'string';
  if (t.typname.startsWith('_') && t.typelem) return `${wrapArray(tsType(t.typelem, compositeAsRow))}[]`;
  if (t.typtype === 'c' && t.typrelid && compositeAsRow) return rowShape(t.typname);
  return BASE[t.typname] ?? 'unknown';
}

function wrapArray(t: string): string {
  return /[|&]/.test(t) ? `(${t})` : t;
}

function rowShape(table: string): string {
  const cols = columns.filter((c) => c.table_name === table);
  if (cols.length === 0) return 'Record<string, unknown>';
  return `{\n${cols.map((c) => `          ${c.column_name}: ${tsType(c.atttypid)}${c.is_nullable === 'YES' ? ' | null' : ''}`).join('\n')}\n        }`;
}

const tables = (
  await db.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  )
).rows.map((r) => r.name);

const fks = (
  await db.query<{ conname: string; src: string; dst: string; cols: string[]; refcols: string[]; one_to_one: boolean }>(
    `select con.conname, src.relname as src, dst.relname as dst,
            array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols,
            array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o) as refcols,
            exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
                      and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x)
                        = (select array_agg(x order by x) from unnest(con.conkey) x)) as one_to_one
       from pg_constraint con
       join pg_class src on src.oid = con.conrelid join pg_namespace sn on sn.oid = src.relnamespace
       join pg_class dst on dst.oid = con.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
      where con.contype = 'f' and sn.nspname = 'public' and dn.nspname = 'public'
      order by src.relname, con.conname`,
  )
).rows;

function quoteList(xs: string[]): string {
  return `[${xs.map((x) => `"${x}"`).join(', ')}]`;
}

function tableBlock(table: string): string {
  const cols = columns.filter((c) => c.table_name === table);
  const row = cols.map((c) => `          ${c.column_name}: ${tsType(c.atttypid)}${c.is_nullable === 'YES' ? ' | null' : ''}`);
  const writable = (mode: 'insert' | 'update') =>
    cols.map((c) => {
      const t = `${tsType(c.atttypid)}${c.is_nullable === 'YES' ? ' | null' : ''}`;
      if ((c.is_identity === 'YES' && c.identity_generation === 'ALWAYS') || c.is_generated === 'ALWAYS') {
        return `          ${c.column_name}?: never`;
      }
      const optional = mode === 'update' || c.is_nullable === 'YES' || c.column_default !== null || c.is_identity === 'YES';
      return `          ${c.column_name}${optional ? '?' : ''}: ${t}`;
    });
  const rels = fks
    .filter((f) => f.src === table)
    .map(
      (f) => `          {
            foreignKeyName: "${f.conname}"
            columns: ${quoteList(f.cols)}
            isOneToOne: ${f.one_to_one}
            referencedRelation: "${f.dst}"
            referencedColumns: ${quoteList(f.refcols)}
          },`,
    );
  return `      ${table}: {
        Row: {
${row.join('\n')}
        }
        Insert: {
${writable('insert').join('\n')}
        }
        Update: {
${writable('update').join('\n')}
        }
        Relationships: [${rels.length ? `\n${rels.join('\n')}\n        ` : ''}]
      }`;
}

interface Fn {
  name: string;
  argnames: string[] | null;
  argmodes: string[] | null;
  argtypes: number[];
  allargtypes: number[] | null;
  nargdefaults: number;
  rettype: number;
  retset: boolean;
}

const fns = (
  await db.query<Fn>(
    `select p.proname as name, p.proargnames as argnames, p.proargmodes::text[] as argmodes,
            p.proargtypes::int[] as argtypes, p.proallargtypes::int[] as allargtypes,
            p.pronargdefaults as nargdefaults, p.prorettype::int as rettype, p.proretset as retset
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and p.prokind = 'f'
      order by p.proname`,
  )
).rows;

function fnBlock(f: Fn): string {
  const modes = f.argmodes ?? f.argtypes.map(() => 'i');
  const all = f.allargtypes ?? f.argtypes;
  const names = f.argnames ?? [];
  const inputs: string[] = [];
  const outputs: string[] = [];
  const inputCount = modes.filter((m) => m === 'i' || m === 'b' || m === 'v').length;
  let inputIndex = 0;
  all.forEach((oid, i) => {
    const mode = modes[i] ?? 'i';
    const name = names[i] ?? `arg${i}`;
    if (mode === 'i' || mode === 'b' || mode === 'v') {
      const hasDefault = inputIndex >= inputCount - f.nargdefaults;
      inputs.push(`          ${name}${hasDefault ? '?' : ''}: ${tsType(oid)}`);
      inputIndex++;
    }
    if (mode === 'o' || mode === 't' || mode === 'b') outputs.push(`          ${name}: ${tsType(oid)}`);
  });
  let returns: string;
  if (outputs.length > 0) returns = `{\n${outputs.join('\n')}\n        }[]`;
  else {
    const base = tsType(f.rettype);
    returns = f.retset ? `${wrapArray(base)}[]` : base;
  }
  const args = inputs.length > 0 ? `{\n${inputs.join('\n')}\n        }` : 'never';
  return `      ${f.name}: {\n        Args: ${args}\n        Returns: ${returns}\n      }`;
}

const out = `/* eslint-disable */
// -----------------------------------------------------------------------------
// GENERATED FILE — do not edit by hand.
// Source: supabase/migrations/*.sql
// Regenerate: pnpm db:types (Supabase CLI, needs the local stack running)
//          or pnpm db:types:offline (PGlite introspection, no Docker needed).
// -----------------------------------------------------------------------------

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
${tables.map(tableBlock).join('\n')}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
${fns.map(fnBlock).join('\n')}
    }
    Enums: {
${enums.map((e) => `      ${e.name}: ${e.labels.map((l) => `"${l}"`).join(' | ')}`).join('\n')}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
${enums.map((e) => `      ${e.name}: [${e.labels.map((l) => `"${l}"`).join(', ')}],`).join('\n')}
    },
  },
} as const
`;

writeFileSync(OUT, out);
await db.close();
console.log(`wrote ${OUT} (${tables.length} tables, ${fns.length} functions, ${enums.length} enums)`);
