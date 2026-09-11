-- =============================================================================
-- 1. Envelope validation fix. Postgres caps regex repetition counts at 255;
--    an earlier revision of migration …300 used {24,2048} and rejected every
--    submission at runtime. Databases migrated from that revision get the
--    corrected function here (a no-op for fresh installs).
-- =============================================================================
create or replace function app.sealed_envelope_is_valid(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and (p - array['v', 'kid', 'epk', 'iv', 'ct']) = '{}'::jsonb
     and p ->> 'v' = '1'
     and coalesce(p ->> 'kid', '') ~ '^[0-9a-f]{16,64}$'
     and coalesce(p ->> 'epk', '') ~ '^[A-Za-z0-9_-]{87}$'
     and coalesce(p ->> 'iv', '') ~ '^[A-Za-z0-9_-]{16}$'
     and coalesce(p ->> 'ct', '') ~ '^[A-Za-z0-9_-]+$'
     and char_length(p ->> 'ct') between 24 and 2048
$$;
revoke all on function app.sealed_envelope_is_valid(jsonb) from public;

-- =============================================================================
-- 2. Login/logout audit fallback. When the auth.sessions triggers exist, the
--    server records sign-in/out itself and this function does nothing (no
--    duplicates, nothing to forge). When they could not be installed, the web
--    app reports its own sign-in/out here; a caller can only record events for
--    themselves.
-- =============================================================================
create function app.session_audit_by_trigger() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'sessions' and t.tgname = 'on_auth_session_created')
$$;
revoke all on function app.session_audit_by_trigger() from public;

create function public.record_auth_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if p_event not in ('login', 'logout') then
    raise exception 'Unknown event.' using errcode = '22023', hint = 'invalid_payload';
  end if;
  if auth.uid() is null or app.session_audit_by_trigger() then
    return;
  end if;
  select p.tenant_id into v_tenant from public.profiles p where p.id = auth.uid();
  if v_tenant is null then return; end if;
  perform app.write_audit(v_tenant, 'auth.' || p_event, 'user', auth.uid()::text, null,
                          jsonb_build_object('source', 'client'), auth.uid(), 'user');
end;
$$;
revoke all on function public.record_auth_event(text) from public, anon;
grant execute on function public.record_auth_event(text) to authenticated;
