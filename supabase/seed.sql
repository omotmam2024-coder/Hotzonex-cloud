-- =============================================================================
-- Hotzonex Cloud seed data (idempotent). Applied by `pnpm db:seed` (which also
-- creates the SUPER_ADMIN login) and by `supabase db reset`.
--
-- Demo routers are flagged is_demo = true: the connector always serves them
-- from the mock provider, the UI badges them DEMO, and no metric counts them
-- as real routers.
-- =============================================================================

insert into public.tenants (id, name, slug, currency_default)
values ('00000000-0000-4000-8000-000000000001', 'Hotzonex WiFi/IT Solutions', 'hotzonex', 'SSP')
on conflict (id) do nothing;

insert into public.locations (id, tenant_id, name, address, contact, opening_hours, status) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Hotzonex Lologo One', 'Lologo, Juba, South Sudan', null, '07:00–22:00', 'active'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Hotzonex Gorom', 'Gorom, Juba, South Sudan', null, '07:00–22:00', 'active'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Hotzonex Juba', 'Juba, South Sudan', null, '08:00–20:00', 'active')
on conflict (id) do nothing;

insert into public.routers (id, tenant_id, location_id, name, api_protocol, api_port, use_ssl, is_demo, notes) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
   'Lologo Gate (demo)', 'api', 8728, false, true, 'Demo router served by the mock provider. Safe to delete.'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102',
   'Gorom Market (demo)', 'api', 8728, false, true, 'Demo router served by the mock provider. Safe to delete.'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103',
   'Juba Office (demo)', 'rest', 443, true, true, 'Demo router served by the mock provider. Safe to delete.')
on conflict (id) do nothing;
