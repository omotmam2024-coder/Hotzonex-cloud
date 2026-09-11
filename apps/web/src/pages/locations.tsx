import { zodResolver } from '@hookform/resolvers/zod';
import { Crosshair, ExternalLink, MapPin, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { LOCATION_STATUSES, locationSchema, type LocationInput } from '@hotzonex/shared/schemas';
import { EmptyState, ErrorState, InlineError, PageHeader, TableSkeleton } from '@/components/states';
import { DemoBadge, Pill, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, fieldA11y } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, SheetContent } from '@/components/ui/overlays';
import { Card } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { userMessage } from '@/lib/errors';
import { useAssignRouterLocation, useDeleteLocation, useLocations, useSaveLocation, type LocationWithRouters } from '@/lib/queries/misc';
import { useRouters } from '@/lib/queries/routers';

const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', maintenance: 'Maintenance' } as const;
const STATUS_TONE = { active: 'good', inactive: 'neutral', maintenance: 'warning' } as const;

type FormValues = z.input<typeof locationSchema>;

function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function LocationForm({ location, onDone }: { location: LocationWithRouters | null; onDone: () => void }) {
  const { profile } = useAuth();
  const save = useSaveLocation();
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const form = useForm<FormValues, unknown, LocationInput>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: location?.name ?? '',
      address: location?.address ?? '',
      lat: location?.lat ?? '',
      lng: location?.lng ?? '',
      contact: location?.contact ?? '',
      opening_hours: location?.opening_hours ?? '',
      status: location?.status ?? 'active',
    },
  });
  const { errors } = form.formState;

  const useMyLocation = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('This device cannot report its location. Enter the coordinates manually.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue('lat', pos.coords.latitude.toFixed(6), { shouldValidate: true });
        form.setValue('lng', pos.coords.longitude.toFixed(6), { shouldValidate: true });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Allow it in the browser, or enter coordinates manually.' : 'Could not get a GPS fix. Try again outdoors, or enter coordinates manually.');
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((input) => {
        if (!profile) return;
        save.mutate(
          { ...(location ? { id: location.id } : {}), tenantId: profile.tenant_id, input },
          { onSuccess: () => { toast.success(location ? 'Location saved' : 'Location added'); onDone(); } },
        );
      })}
    >
      <Field label="Name" htmlFor="name" error={errors.name?.message} required>
        <Input {...fieldA11y('name', errors.name?.message)} {...form.register('name')} />
      </Field>
      <Field label="Address" htmlFor="address" error={errors.address?.message}>
        <Textarea rows={2} {...fieldA11y('address', errors.address?.message)} {...form.register('address')} />
      </Field>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" htmlFor="lat" error={errors.lat?.message} hint="e.g. 4.859363">
            <Input inputMode="decimal" {...fieldA11y('lat', errors.lat?.message)} {...form.register('lat')} />
          </Field>
          <Field label="Longitude" htmlFor="lng" error={errors.lng?.message} hint="e.g. 31.571250">
            <Input inputMode="decimal" {...fieldA11y('lng', errors.lng?.message)} {...form.register('lng')} />
          </Field>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" loading={locating} onClick={useMyLocation}>
            <Crosshair /> Use my current location
          </Button>
        </div>
        {geoError ? <p className="text-xs text-destructive" role="alert">{geoError}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact" htmlFor="contact" error={errors.contact?.message} hint="Name and phone of the site contact">
          <Input {...fieldA11y('contact', errors.contact?.message)} {...form.register('contact')} />
        </Field>
        <Field label="Opening hours" htmlFor="opening_hours" error={errors.opening_hours?.message}>
          <Input placeholder="07:00–22:00" {...fieldA11y('opening_hours', errors.opening_hours?.message)} {...form.register('opening_hours')} />
        </Field>
      </div>
      <Field label="Status" htmlFor="status">
        <Select {...fieldA11y('status')} {...form.register('status')}>
          {LOCATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </Field>
      <InlineError error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>{location ? 'Save location' : 'Add location'}</Button>
      </div>
    </form>
  );
}

function AssignedRouters({ location }: { location: LocationWithRouters }) {
  const { can } = useAuth();
  const routers = useRouters();
  const assign = useAssignRouterLocation();
  const [pick, setPick] = useState('');
  const candidates = (routers.data ?? []).filter((r) => r.location_id !== location.id);
  return (
    <div className="mt-6 grid gap-3 border-t pt-4">
      <p className="text-sm font-medium">Assigned routers</p>
      {location.routers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No routers at this location yet.</p>
      ) : (
        <ul className="grid gap-2">
          {location.routers.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/routers/${r.id}`}>{r.name}</Link>
                {r.is_demo ? <DemoBadge /> : null}
                <StatusBadge status={r.status} />
              </span>
              {can.editRouters ? (
                <Button variant="ghost" size="icon" aria-label={`Unassign ${r.name}`} disabled={assign.isPending} onClick={() => assign.mutate({ routerId: r.id, locationId: null })}>
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {can.editRouters && candidates.length > 0 ? (
        <div className="flex gap-2">
          <Select aria-label="Router to assign" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Assign a router…</option>
            {candidates.map((r) => <option key={r.id} value={r.id}>{r.name}{r.location ? ` (at ${r.location.name})` : ''}</option>)}
          </Select>
          <Button variant="outline" disabled={!pick} loading={assign.isPending} onClick={() => assign.mutate({ routerId: pick, locationId: location.id }, { onSuccess: () => setPick('') })}>
            Assign
          </Button>
        </div>
      ) : null}
      <InlineError error={assign.error} />
    </div>
  );
}

export function LocationsPage() {
  const { can } = useAuth();
  const locations = useLocations();
  const del = useDeleteLocation();
  const [panel, setPanel] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);
  const [deleting, setDeleting] = useState<LocationWithRouters | null>(null);
  const editing = panel?.mode === 'edit' ? (locations.data ?? []).find((l) => l.id === panel.id) ?? null : null;

  return (
    <>
      <PageHeader
        title="Locations"
        description="Sites where Hotzonex routers are installed."
        actions={can.manageLocations ? <Button onClick={() => setPanel({ mode: 'new' })}><Plus /> Add location</Button> : null}
      />
      <Card>
        {locations.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : locations.isError ? (
          <div className="p-4"><ErrorState error={locations.error} onRetry={() => void locations.refetch()} /></div>
        ) : locations.data.length === 0 ? (
          <EmptyState
            icon={<MapPin />}
            title="No locations yet"
            description={can.manageLocations ? 'Add the sites where your routers are installed, with GPS coordinates so technicians can find them.' : 'An administrator has not added any locations yet.'}
            action={can.manageLocations ? <Button onClick={() => setPanel({ mode: 'new' })}><Plus /> Add location</Button> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Location</TH>
                <TH>Status</TH>
                <TH>GPS</TH>
                <TH>Contact</TH>
                <TH>Routers</TH>
                <TH className="w-10"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {locations.data.map((l) => (
                <TR key={l.id} className="cursor-pointer" onClick={() => setPanel({ mode: 'edit', id: l.id })}>
                  <TD>
                    <button type="button" className="cursor-pointer text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setPanel({ mode: 'edit', id: l.id }); }}>
                      {l.name}
                    </button>
                    {l.address ? <div className="max-w-64 truncate text-xs text-muted-foreground">{l.address}</div> : null}
                  </TD>
                  <TD><Pill tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Pill></TD>
                  <TD className="whitespace-nowrap text-xs">
                    {l.lat !== null && l.lng !== null ? (
                      <a className="inline-flex items-center gap-1 font-mono hover:underline" href={osmLink(l.lat, l.lng)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {l.lat.toFixed(5)}, {l.lng.toFixed(5)} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">not set</span>
                    )}
                  </TD>
                  <TD className="max-w-48 truncate text-xs">{l.contact ?? <span className="text-muted-foreground">—</span>}{l.opening_hours ? <div className="text-muted-foreground">{l.opening_hours}</div> : null}</TD>
                  <TD className="text-xs">
                    {l.routers.length === 0 ? <span className="text-muted-foreground">none</span> : (
                      <>
                        {l.routers.filter((r) => !r.is_demo).length} router{l.routers.filter((r) => !r.is_demo).length === 1 ? '' : 's'}
                        {l.routers.some((r) => r.is_demo) ? <span className="text-muted-foreground"> + {l.routers.filter((r) => r.is_demo).length} demo</span> : null}
                      </>
                    )}
                  </TD>
                  <TD>
                    {can.manageLocations ? (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${l.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(l); }}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        {panel ? (
          <SheetContent
            title={panel.mode === 'new' ? 'Add location' : editing?.name ?? 'Location'}
            description={panel.mode === 'new' ? 'GPS coordinates help technicians find the site.' : can.manageLocations ? 'Changes are recorded in the audit log.' : 'Read-only: only admins can edit locations.'}
          >
            {panel.mode === 'new' || (editing && can.manageLocations) ? (
              <LocationForm key={editing?.id ?? 'new'} location={editing} onDone={() => setPanel(null)} />
            ) : editing ? (
              <div className="grid gap-2 text-sm">
                <p>{editing.address ?? 'No address recorded.'}</p>
                <p>{editing.contact ?? ''}</p>
              </div>
            ) : null}
            {editing ? <AssignedRouters location={editing} /> : null}
          </SheetContent>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'location'}?`}
        description={deleting && deleting.routers.length > 0 ? `${deleting.routers.length} router(s) at this location will become unassigned. The routers themselves are not affected.` : 'This location has no routers.'}
        confirmLabel="Delete location"
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => { toast.success('Location deleted'); setDeleting(null); },
            onError: (e) => toast.error(userMessage(e)),
          })
        }
      />
    </>
  );
}
