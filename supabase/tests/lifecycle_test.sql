-- End-to-end lifecycle test: run after supabase_stub.sql and the migrations.
-- Every check raises on failure, so `psql -v ON_ERROR_STOP=1` exits non-zero.
\set ON_ERROR_STOP 1

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'owner@hotzonex.test'),
  ('00000000-0000-0000-0000-00000000000b', 'cashier@hotzonex.test'),
  ('00000000-0000-0000-0000-00000000000c', 'intruder@other.test');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
end $$;

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, service_role, anon;

-- ---------- owner onboarding ----------
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ctx select 'tenant', create_tenant('Hotzonex', 'Jebel Iraq HQ')::text;
insert into ctx select 'site', id::text from sites where name = 'Jebel Iraq HQ';
insert into sites (tenant_id, name, opens_at, closes_at)
  select v::uuid, 'Gorom', '08:00', '22:00' from ctx where k = 'tenant';
insert into plans (tenant_id, site_id, name, price, uptime_seconds, validity_seconds, color)
  select (select v::uuid from ctx where k='tenant'), (select v::uuid from ctx where k='site'),
         '1 Hour', 500, 3600, 86400, '#16a34a';
insert into ctx select 'plan', id::text from plans where name = '1 Hour';
insert into agents (tenant_id, name, code, commission_pct)
  select v::uuid, 'Deng', 'DENG01', 10 from ctx where k = 'tenant';

-- cashier membership via RPC, restricted to the HQ site
select add_member((select v::uuid from ctx where k='tenant'), 'CASHIER@hotzonex.test', 'cashier',
                  (select v::uuid from ctx where k='site'));
do $$ begin
  if (select count(*) from list_members((select v::uuid from ctx where k='tenant'))) <> 2 then
    raise exception 'FAIL list_members'; end if;
end $$;

-- generate 5 numeric codes
insert into ctx select 'batch', generate_vouchers_checked((select v::uuid from ctx where k='plan'), 5, '', 8, 'numeric')::text;
do $$ begin
  if (select count(*) from vouchers where code ~ '^[0-9]{8}$') <> 5 then raise exception 'FAIL generate'; end if;
end $$;
do $$ begin
  begin perform generate_vouchers_checked((select v::uuid from ctx where k='plan'), 1, 'bad-prefix!', 8, 'numeric');
        raise exception 'FAIL prefix accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- selling before push must fail cleanly
do $$ begin
  begin perform sell_voucher((select v::uuid from ctx where k='plan'));
        raise exception 'FAIL sold unpushed';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- ---------- router API (service role) pushes them ----------
reset role;
insert into routers (tenant_id, site_id, name, host, port, username, secret_ciphertext)
  select (select v::uuid from ctx where k='tenant'), (select v::uuid from ctx where k='site'),
         'HQ CCR', '10.99.0.12', 80, 'hzcloud', 'iv.tag.ct';
insert into ctx select 'router', id::text from routers;
update vouchers set pushed_at = now();

-- ---------- cashier sells ----------
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ctx select 'sold1', (sell_voucher((select v::uuid from ctx where k='plan')))->>'voucher_id';
insert into ctx select 'sold2', (sell_voucher((select v::uuid from ctx where k='plan'), 'agent_code', ' deng01 '))->>'voucher_id';
do $$ begin
  if (select count(*) from sales) <> 2 then raise exception 'FAIL sales count'; end if;
  if (select ready from v_voucher_stock) <> 3 then raise exception 'FAIL stock'; end if;
  if (select count(*) from v_agent_commission where commission = 50) <> 1 then raise exception 'FAIL commission'; end if;
  if (select count(*) from sites) <> 1 then raise exception 'FAIL cashier sees other sites'; end if;
end $$;
-- cashier may not write sales or generate
do $$ begin
  begin insert into sales (tenant_id, site_id, voucher_id, plan_id, amount, currency)
          select tenant_id, site_id, id, plan_id, 0, 'SSP' from vouchers where status='unused' limit 1;
        raise exception 'FAIL cashier inserted sale';
  exception when insufficient_privilege then null; end;
  begin perform generate_vouchers((select v::uuid from ctx where k='plan'), 1);
        raise exception 'FAIL cashier generated';
  exception when insufficient_privilege then null; end;
  begin perform 1 from routers where secret_ciphertext is not null;
        raise exception 'FAIL secret readable';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- intruder sees nothing ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from vouchers) + (select count(*) from sales) + (select count(*) from tenants) <> 0 then
    raise exception 'FAIL tenant isolation'; end if;
  begin perform sell_voucher((select v::uuid from ctx where k='plan'));
        raise exception 'FAIL intruder sold';
  exception when insufficient_privilege then null; end;
end $$;
-- intruder's own tenant can't point at Hotzonex's site
select create_tenant('Other ISP');
do $$ begin
  begin insert into plans (tenant_id, site_id, name, price, uptime_seconds)
          select (select id from tenants where name='Other ISP'), (select v::uuid from ctx where k='site'), 'x', 1, 60;
        raise exception 'FAIL cross-tenant plan';
  exception when check_violation then null; end;
end $$;

-- ---------- anon can do nothing ----------
reset role; set role anon;
do $$ begin
  begin perform create_tenant('anon'); raise exception 'FAIL anon rpc';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- sync: usage, auto-sale on first login, expiry ----------
reset role; set role service_role;
-- an unsold printed card logs in (auto-sale), sold1 uses its full hour
select apply_router_usage(
  (select v::uuid from ctx where k='router'),
  jsonb_build_array(
    jsonb_build_object('voucher_id', (select v from ctx where k='sold1'), 'uptime', 3600, 'bytes', 1000),
    jsonb_build_object('voucher_id', (select id::text from vouchers where status='unused' order by created_at limit 1), 'uptime', 120, 'bytes', 50)),
  jsonb_build_array(jsonb_build_object('user', (select code from vouchers where id = (select v::uuid from ctx where k='sold1')),
                                       'mac', 'AA:BB', 'uptime', 3600, 'bytes_in', 600, 'bytes_out', 400)));
do $$ begin
  if (select status from vouchers where id = (select v::uuid from ctx where k='sold1')) <> 'expired' then
    raise exception 'FAIL expiry'; end if;
  if (select count(*) from sales) <> 3 then raise exception 'FAIL auto-sale'; end if;
  if (select count(*) from active_sessions where voucher_id is not null) <> 1 then raise exception 'FAIL sessions'; end if;
  -- a second sync with lower counters must not reduce usage (max, never sum or overwrite)
end $$;
select apply_router_usage((select v::uuid from ctx where k='router'),
  jsonb_build_array(jsonb_build_object('voucher_id', (select v from ctx where k='sold1'), 'uptime', 10, 'bytes', 1)), '[]');
do $$ begin
  if (select uptime_used_seconds from vouchers where id = (select v::uuid from ctx where k='sold1')) <> 3600 then
    raise exception 'FAIL usage went backwards'; end if;
  if (select count(*) from active_sessions) <> 0 then raise exception 'FAIL sessions not replaced'; end if;
end $$;

-- ---------- owner disables one ----------
reset role; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if disable_vouchers(array[(select v::uuid from ctx where k='sold2')]) <> 1 then raise exception 'FAIL disable'; end if;
  if (select status from vouchers where id = (select v::uuid from ctx where k='sold2')) <> 'disabled' then raise exception 'FAIL disabled status'; end if;
end $$;

-- ---------- devices inventory ----------
insert into devices (tenant_id, site_id, kind, name, model)
  select (select v::uuid from ctx where k='tenant'), (select v::uuid from ctx where k='site'), 'access_point', 'AP Mast 1', 'GWN7664ELR';
do $$ begin if (select count(*) from devices) <> 1 then raise exception 'FAIL devices'; end if; end $$;

select 'ALL LIFECYCLE CHECKS PASSED' as result;
