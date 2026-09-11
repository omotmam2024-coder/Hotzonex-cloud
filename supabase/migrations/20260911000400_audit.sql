-- =============================================================================
-- Audit log. Written only by database triggers and SECURITY DEFINER functions
-- (never by the browser), so entries cannot be forged. Immutable: no role can
-- UPDATE or DELETE a row; a trigger rejects it even for the service role.
-- =============================================================================

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_id uuid,
  actor_email text,
  actor_type text not null default 'user' check (actor_type in ('user', 'connector', 'system')),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text check (char_length(ip) <= 64),
  user_agent text check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_action_idx on public.audit_logs (tenant_id, action);

create function app.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit log entries are immutable.' using errcode = '42501', hint = 'audit_immutable';
end;
$$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.audit_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.audit_immutable();

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
-- The connector writes through app.write_audit() (via its RPCs); it never needs UPDATE/DELETE.
revoke all on public.audit_logs from service_role;
grant select, insert on public.audit_logs to service_role;

create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));

-- -----------------------------------------------------------------------------
-- Request context: PostgREST exposes the JWT claims and request headers as
-- GUCs. Absent (NULL) for direct SQL such as migrations and the seed.
-- -----------------------------------------------------------------------------
create function app.request_header(p_name text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> p_name
$$;

create function app.request_role() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create function app.write_audit(
  p_tenant_id uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null,
  p_actor_id uuid default null, p_actor_type text default null,
  p_ip text default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_type text := coalesce(p_actor_type,
                          case when v_actor is not null then 'user'
                               when app.request_role() = 'service_role' then 'connector'
                               else 'system' end);
  v_email text;
  v_ip text := p_ip;
begin
  if p_tenant_id is null then return; end if;
  if v_actor is not null then
    select p.email into v_email from public.profiles p where p.id = v_actor;
  end if;
  if v_ip is null and v_type = 'user' then
    v_ip := btrim(split_part(coalesce(app.request_header('x-forwarded-for'), app.request_header('x-real-ip'), ''), ',', 1));
  end if;
  insert into public.audit_logs (tenant_id, actor_id, actor_email, actor_type, action, entity_type, entity_id,
                                 before, after, ip, user_agent)
  values (p_tenant_id, v_actor, coalesce(v_email, case v_type when 'connector' then 'connector' else null end), v_type,
          p_action, p_entity_type, p_entity_id, p_before, p_after, nullif(left(v_ip, 64), ''),
          left(coalesce(p_user_agent, case when v_type = 'user' then app.request_header('user-agent') end), 512));
end;
$$;

-- -----------------------------------------------------------------------------
-- Generic row-change audit. TG_ARGV[0] = entity type, TG_ARGV[1] = action
-- prefix, TG_ARGV[2] (optional) = comma-separated columns to ignore when
-- deciding whether an UPDATE is worth recording (connector-owned telemetry).
-- -----------------------------------------------------------------------------
create function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := tg_argv[0];
  v_prefix text := tg_argv[1];
  v_ignore text[] := case when tg_nargs > 2 then string_to_array(tg_argv[2], ',') else array[]::text[] end;
  v_before jsonb;
  v_after jsonb;
  v_tenant uuid;
  v_id text;
  v_action text;
  k text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
  end if;

  foreach k in array v_ignore || array['updated_at'] loop
    v_before := v_before - k;
    v_after := v_after - k;
  end loop;

  if tg_op = 'UPDATE' then
    if v_before = v_after then return null; end if;
    -- Record only what changed.
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_before
      from jsonb_each(v_before) b where not (v_after ? key and v_after -> key = b.value);
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_after
      from jsonb_each(to_jsonb(new)) a where a.key = any (select jsonb_object_keys(v_before));
  end if;

  v_tenant := coalesce((to_jsonb(coalesce(new, old)) ->> 'tenant_id')::uuid,
                       case when v_entity = 'tenant' then (to_jsonb(coalesce(new, old)) ->> 'id')::uuid end);
  v_id := coalesce(to_jsonb(coalesce(new, old)) ->> 'id', to_jsonb(coalesce(new, old)) ->> 'key');
  v_action := v_prefix || case tg_op when 'INSERT' then '.created' when 'UPDATE' then '.updated' else '.deleted' end;

  perform app.write_audit(v_tenant, v_action, v_entity, v_id, v_before, v_after);
  return null;
end;
$$;

create trigger audit_tenants after update on public.tenants
  for each row execute function app.audit_row_change('tenant', 'settings.organization');
create trigger audit_system_settings after insert or update or delete on public.system_settings
  for each row execute function app.audit_row_change('system_setting', 'settings', 'updated_by');
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function app.audit_row_change('location', 'location');
create trigger audit_routers after insert or update or delete on public.routers
  for each row execute function app.audit_row_change('router', 'router',
    'status,status_reason,last_seen_at,last_polled_at,consecutive_failures,identity,board_name,architecture,'
    'routeros_version,uptime_seconds,cpu_load,free_memory,total_memory,wg_last_handshake_at,'
    'credentials_status,credentials_updated_at,discovered_at');
create trigger audit_profiles after update on public.profiles
  for each row execute function app.audit_row_change('profile', 'team.member', 'full_name');
create trigger audit_invites after insert or update on public.invites
  for each row execute function app.audit_row_change('invite', 'team.invite', 'accepted_by');

-- Credential submissions: record THAT credentials changed, never what they are.
create function app.audit_credential_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.write_audit(new.tenant_id, 'router.credentials.submitted', 'router', new.router_id::text,
                          null, jsonb_build_object('submission_id', new.id));
  return null;
end;
$$;
create trigger audit_credential_submissions after insert on public.router_credential_submissions
  for each row execute function app.audit_credential_submission();

-- Jobs: who asked for what, and how it ended.
create function app.audit_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_verb text := replace(new.type, 'router.', '');
begin
  if tg_op = 'INSERT' then
    perform app.write_audit(new.tenant_id, 'router.' || v_verb || '.requested', 'router', new.router_id::text,
                            null, jsonb_build_object('job_id', new.id, 'payload', new.payload), new.created_by);
  elsif new.status is distinct from old.status and new.status in ('succeeded', 'failed', 'dead') then
    perform app.write_audit(new.tenant_id, 'router.' || v_verb || '.' || new.status::text, 'router', new.router_id::text,
                            null,
                            jsonb_build_object('job_id', new.id, 'attempts', new.attempts, 'error_code', new.last_error_code,
                                               'error', new.last_error, 'requested_by', new.created_by,
                                               'result', case when new.type = 'router.fetch_logs' then null else new.result end),
                            null, 'connector');
  end if;
  return null;
end;
$$;
create trigger audit_jobs after insert or update of status on public.jobs
  for each row execute function app.audit_job();

-- -----------------------------------------------------------------------------
-- Login / logout. Supabase Auth creates a row in auth.sessions on sign-in and
-- deletes it on sign-out. Hooking those rows makes the entry server-side and
-- unforgeable. (Session rows removed by expiry cleanup are also recorded as
-- logout, with reason "session_ended".)
-- -----------------------------------------------------------------------------
create function app.audit_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Read columns through jsonb so a change in the auth.sessions shape can never break sign-in.
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_user uuid := (v_row ->> 'user_id')::uuid;
  v_tenant uuid;
  v_ip text := split_part(v_row ->> 'ip', '/', 1);
  v_ua text := v_row ->> 'user_agent';
  v_not_after timestamptz := (v_row ->> 'not_after')::timestamptz;
begin
  select p.tenant_id into v_tenant from public.profiles p where p.id = v_user;
  if v_tenant is null then return null; end if;
  if tg_op = 'INSERT' then
    perform app.write_audit(v_tenant, 'auth.login', 'user', v_user::text, null,
                            jsonb_build_object('session_id', v_row ->> 'id'), v_user, 'user', v_ip, v_ua);
  else
    perform app.write_audit(v_tenant, 'auth.logout', 'user', v_user::text,
                            jsonb_build_object('session_id', v_row ->> 'id',
                                               'reason', case when v_not_after is not null and v_not_after < now()
                                                              then 'session_ended' else 'sign_out' end),
                            null, v_user, 'user', v_ip, v_ua);
  end if;
  return null;
exception when others then
  -- Never block authentication because of auditing; surface it in the database log instead.
  raise warning 'hotzonex audit_session failed: %', sqlerrm;
  return null;
end;
$$;
-- Best effort: some Supabase environments may not allow triggers on auth.sessions.
-- If they cannot be created, sign-in/out is recorded through
-- public.record_auth_event() instead (see migration …700).
do $$
begin
  create trigger on_auth_session_created after insert on auth.sessions
    for each row execute function app.audit_session();
  create trigger on_auth_session_deleted after delete on auth.sessions
    for each row execute function app.audit_session();
exception when others then
  raise warning 'login/logout audit triggers on auth.sessions could not be installed (%); falling back to record_auth_event()', sqlerrm;
end;
$$;

revoke all on function app.write_audit(uuid, text, text, text, jsonb, jsonb, uuid, text, text, text) from public;
revoke all on function app.audit_row_change(), app.audit_credential_submission(), app.audit_job(),
                       app.audit_session(), app.audit_immutable() from public;
