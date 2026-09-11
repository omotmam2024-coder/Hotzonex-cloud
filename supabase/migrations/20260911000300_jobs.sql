-- =============================================================================
-- Jobs. Every operation that touches a router is a queued job: the UI inserts
-- one (through enqueue_router_job) and watches its state; the connector claims
-- it, runs it when the router is reachable, and writes the result. The UI
-- never blocks on a router.
-- =============================================================================

create type public.job_status as enum ('pending', 'claimed', 'running', 'succeeded', 'failed', 'dead');

-- Registry of job types and their retry policy. The connector's TypeScript
-- registry (packages/shared/src/jobs.ts) must match this table; a test enforces it.
create table public.job_types (
  type text primary key check (type ~ '^[a-z]+\.[a-z_]+$'),
  description text not null,
  -- Destructive jobs (Phase 2: delete user, disconnect session) never retry
  -- automatically; a failure waits for a human to confirm a re-run.
  destructive boolean not null,
  -- Wait (without consuming attempts) while the router is offline, rather than fail.
  defer_when_offline boolean not null,
  max_attempts integer not null check (max_attempts between 1 and 20),
  -- May a user create this job directly via enqueue_router_job()?
  user_enqueueable boolean not null
);

insert into public.job_types (type, description, destructive, defer_when_offline, max_attempts, user_enqueueable) values
  ('router.test_connection', 'Connect over the tunnel, log in, and read identity and resources.', false, false, 1, true),
  ('router.test_permissions', 'Check the API user can perform every operation Hotzonex needs, and nothing more.', false, false, 1, true),
  ('router.sync', 'Read identity, version, resources, interfaces, hotspot servers and hotspot profiles. Read-only.', false, true, 5, true),
  ('router.fetch_logs', 'Fetch the most recent router log lines.', false, false, 1, true),
  ('router.ingest_credentials', 'Unseal submitted router credentials and store them encrypted at rest.', false, false, 3, false);

alter table public.job_types enable row level security;
revoke all on public.job_types from anon, authenticated;
grant select on public.job_types to authenticated;
grant all on public.job_types to service_role;
create policy job_types_select on public.job_types for select to authenticated using (true);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  router_id uuid,
  type text not null references public.job_types (type),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status public.job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  deferrals integer not null default 0 check (deferrals >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  result jsonb,
  last_error text check (char_length(last_error) <= 1000),
  last_error_code text check (char_length(last_error_code) <= 40),
  claimed_by text,
  claimed_at timestamptz,
  run_after timestamptz not null default now(),
  -- A job that could not run (router offline) within this window goes dead.
  expires_at timestamptz not null default now() + interval '7 days',
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_idempotency_key_key unique (idempotency_key),
  constraint jobs_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index jobs_tenant_id_idx on public.jobs (tenant_id);
create index jobs_router_status_idx on public.jobs (router_id, status);
create index jobs_status_run_after_idx on public.jobs (status, run_after);
create index jobs_created_at_idx on public.jobs (created_at desc);
create trigger jobs_touch before update on public.jobs
  for each row execute function app.touch_updated_at();

alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;
grant all on public.jobs to service_role;
-- No insert/update/delete policies: users create jobs only via enqueue_router_job().
create policy jobs_select on public.jobs for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));

-- -----------------------------------------------------------------------------
-- Internal: create a job with idempotency. Re-sending the same key returns the
-- original job; an unfinished job of the same type for the same router is
-- reused instead of queueing a duplicate (saves the metered link).
-- -----------------------------------------------------------------------------
create function app.create_job(
  p_tenant_id uuid, p_router_id uuid, p_type text, p_payload jsonb, p_idempotency_key text, p_created_by uuid
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.job_types;
  v_job public.jobs;
begin
  select * into v_type from public.job_types where type = p_type;
  if not found then
    raise exception 'Unknown job type %.', p_type using errcode = '22023', hint = 'invalid_job_type';
  end if;

  select * into v_job from public.jobs where idempotency_key = p_idempotency_key;
  if found then
    if v_job.tenant_id <> p_tenant_id or v_job.router_id is distinct from p_router_id or v_job.type <> p_type then
      raise exception 'That request key was already used for a different action.' using errcode = '23505', hint = 'idempotency_conflict';
    end if;
    return v_job;
  end if;

  if not v_type.destructive then
    select * into v_job from public.jobs
     where router_id = p_router_id and type = p_type and payload = coalesce(p_payload, '{}'::jsonb)
       and status in ('pending', 'claimed', 'running')
     order by created_at desc limit 1;
    if found then return v_job; end if;
  end if;

  insert into public.jobs (tenant_id, router_id, type, payload, max_attempts, idempotency_key, created_by)
  values (p_tenant_id, p_router_id, p_type, coalesce(p_payload, '{}'::jsonb), v_type.max_attempts, p_idempotency_key, p_created_by)
  on conflict (idempotency_key) do nothing
  returning * into v_job;

  if v_job.id is null then
    -- Lost a race with an identical request.
    select * into v_job from public.jobs where idempotency_key = p_idempotency_key;
  end if;
  return v_job;
end;
$$;
revoke all on function app.create_job(uuid, uuid, text, jsonb, text, uuid) from public;

create function public.enqueue_router_job(
  p_router_id uuid, p_type text, p_idempotency_key text, p_payload jsonb default '{}'::jsonb
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_router public.routers;
  v_type public.job_types;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_recent integer;
begin
  select * into v_router from public.routers where id = p_router_id;
  if not found or not app.operator_of(v_router.tenant_id) then
    raise exception 'Router not found.' using errcode = 'P0002', hint = 'not_found';
  end if;

  select * into v_type from public.job_types where type = p_type;
  if not found or not v_type.user_enqueueable then
    raise exception 'That action cannot be requested directly.' using errcode = '22023', hint = 'invalid_job_type';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'A request key is required.' using errcode = '22023', hint = 'invalid_idempotency_key';
  end if;

  -- Per-type payload validation.
  if p_type = 'router.fetch_logs' then
    if (v_payload - 'limit') <> '{}'::jsonb
       or jsonb_typeof(v_payload -> 'limit') is distinct from 'number'
       or (v_payload ->> 'limit')::numeric not between 1 and 500
       or (v_payload ->> 'limit')::numeric % 1 <> 0 then
      raise exception 'Log requests need a whole-number limit between 1 and 500.' using errcode = '22023', hint = 'invalid_payload';
    end if;
  elsif v_payload <> '{}'::jsonb then
    raise exception 'This action takes no parameters.' using errcode = '22023', hint = 'invalid_payload';
  end if;

  if v_router.credentials_status not in ('set', 'pending') and not v_router.is_demo then
    raise exception 'Set the router API credentials before running this action.' using errcode = '55000', hint = 'credentials_missing';
  end if;

  -- Rate limits: connection tests per router, and all user jobs per tenant.
  if p_type in ('router.test_connection', 'router.test_permissions') then
    select count(*) into v_recent from public.jobs
     where router_id = p_router_id and type in ('router.test_connection', 'router.test_permissions')
       and created_at > now() - interval '1 minute';
    if v_recent >= 6 then
      raise exception 'Too many connection tests for this router. Wait a minute and try again.' using errcode = '54000', hint = 'rate_limited';
    end if;
  end if;
  select count(*) into v_recent from public.jobs
   where tenant_id = v_router.tenant_id and created_by is not null and created_at > now() - interval '1 minute';
  if v_recent >= 60 then
    raise exception 'Too many router actions in the last minute. Wait a moment and try again.' using errcode = '54000', hint = 'rate_limited';
  end if;

  return app.create_job(v_router.tenant_id, p_router_id, p_type, v_payload, p_idempotency_key, auth.uid());
end;
$$;
revoke all on function public.enqueue_router_job(uuid, text, text, jsonb) from public, anon;
grant execute on function public.enqueue_router_job(uuid, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Credential submission. The browser seals {username, password} to the
-- connector's P-256 public key (ECDH + HKDF + AES-GCM, bound to the router id)
-- and hands over the envelope. The database never sees plaintext.
-- -----------------------------------------------------------------------------
create function app.sealed_envelope_is_valid(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and (p - array['v', 'kid', 'epk', 'iv', 'ct']) = '{}'::jsonb
     and p ->> 'v' = '1'
     and coalesce(p ->> 'kid', '') ~ '^[0-9a-f]{16,64}$'
     and coalesce(p ->> 'epk', '') ~ '^[A-Za-z0-9_-]{87}$'
     and coalesce(p ->> 'iv', '') ~ '^[A-Za-z0-9_-]{16}$'
     -- Postgres caps regex repetition counts at 255, so length is checked separately.
     and coalesce(p ->> 'ct', '') ~ '^[A-Za-z0-9_-]+$'
     and char_length(p ->> 'ct') between 24 and 2048
$$;

create function public.submit_router_credentials(p_router_id uuid, p_sealed jsonb, p_idempotency_key text)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_router public.routers;
  v_submission uuid;
  v_existing public.jobs;
begin
  select * into v_router from public.routers where id = p_router_id;
  if not found or not app.operator_of(v_router.tenant_id) then
    raise exception 'Router not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if not app.sealed_envelope_is_valid(p_sealed) then
    raise exception 'The credential envelope is malformed. Reload the page and try again.' using errcode = '22023', hint = 'invalid_envelope';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'A request key is required.' using errcode = '22023', hint = 'invalid_idempotency_key';
  end if;

  select * into v_existing from public.jobs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.router_id is distinct from p_router_id or v_existing.type <> 'router.ingest_credentials' then
      raise exception 'That request key was already used for a different action.' using errcode = '23505', hint = 'idempotency_conflict';
    end if;
    return v_existing;
  end if;

  insert into public.router_credential_submissions (tenant_id, router_id, sealed, submitted_by)
  values (v_router.tenant_id, p_router_id, p_sealed, auth.uid())
  returning id into v_submission;

  update public.routers
     set credentials_status = case when credentials_status = 'set' then 'set'::public.credentials_status
                                   else 'pending'::public.credentials_status end
   where id = p_router_id;

  return app.create_job(v_router.tenant_id, p_router_id, 'router.ingest_credentials',
                        jsonb_build_object('submission_id', v_submission), p_idempotency_key, auth.uid());
end;
$$;
revoke all on function public.submit_router_credentials(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_router_credentials(uuid, jsonb, text) to authenticated;
revoke all on function app.sealed_envelope_is_valid(jsonb) from public;
