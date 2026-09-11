-- Live dashboard updates via Supabase Realtime (postgres_changes respects RLS).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.routers,
  public.jobs,
  public.sync_drift,
  public.connector_status;
