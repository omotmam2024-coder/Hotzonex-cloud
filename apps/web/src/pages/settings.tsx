import { zodResolver } from '@hookform/resolvers/zod';
import { Link2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { AppRole, ProfileRow } from '@hotzonex/shared/database';
import { ROLE_LABELS, type Role } from '@hotzonex/shared/roles';
import { changePasswordSchema, inviteSchema, organizationSchema, profileSchema, type InviteInput } from '@hotzonex/shared/schemas';
import { SETTINGS, SETTING_KEYS, settingValue, type SettingKey } from '@hotzonex/shared/settings';
import { CopyButton } from '@/components/copy-button';
import { EmptyState, ErrorState, InlineError, PageHeader, TableSkeleton } from '@/components/states';
import { Pill } from '@/components/status';
import { RelativeTime } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, fieldA11y } from '@/components/ui/form-controls';
import { ConfirmDialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Facts } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { toAppError, userMessage } from '@/lib/errors';
import {
  useConnector,
  useCreateInvite,
  useGrantAccess,
  useInvites,
  usePendingAccounts,
  useRemovePendingAccount,
  useRevokeInvite,
  type PendingAccount,
  useSaveOrganization,
  useSaveSetting,
  useSettings,
  useTeam,
  useUpdateMember,
  useUpdateProfileName,
} from '@/lib/queries/misc';
import { getSupabase } from '@/lib/supabase';

function OrganizationCard() {
  const { tenant, can } = useAuth();
  const save = useSaveOrganization();
  const form = useForm({ resolver: zodResolver(organizationSchema), defaultValues: { name: tenant?.name ?? '', currency_default: (tenant?.currency_default as 'SSP' | 'USD') ?? 'SSP' } });
  const { errors } = form.formState;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Organization</CardTitle>
          <CardDescription>{can.manageSettings ? 'Name and default currency (used by vouchers and payments in a later release).' : 'Only admins can change these.'}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:max-w-md"
          noValidate
          onSubmit={form.handleSubmit((v) => tenant && save.mutate({ tenantId: tenant.id, name: v.name, currency: v.currency_default }, { onSuccess: () => toast.success('Organization saved') }))}
        >
          <Field label="Organization name" htmlFor="org-name" error={errors.name?.message}>
            <Input disabled={!can.manageSettings} {...fieldA11y('org-name', errors.name?.message)} {...form.register('name')} />
          </Field>
          <Field label="Default currency" htmlFor="org-currency" hint="Amounts are stored as whole minor units (piasters / cents), never as decimals.">
            <Select id="org-currency" disabled={!can.manageSettings} {...form.register('currency_default')}>
              <option value="SSP">SSP — South Sudanese pound</option>
              <option value="USD">USD — US dollar</option>
            </Select>
          </Field>
          <InlineError error={save.error} />
          {can.manageSettings ? <div><Button type="submit" loading={save.isPending}>Save</Button></div> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function SettingRow({ settingKey, value, existing }: { settingKey: SettingKey; value: number; existing: boolean }) {
  const { tenant, can } = useAuth();
  const save = useSaveSetting();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const meta = SETTINGS[settingKey];
  return (
    <form
      className="grid gap-2 border-b py-4 last:border-0 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = meta.schema.safeParse(Number(draft));
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid value');
          return;
        }
        setError(null);
        if (tenant) save.mutate({ tenantId: tenant.id, key: settingKey, value: parsed.data, existing }, { onSuccess: () => toast.success(`${meta.label} saved`) });
      }}
    >
      <div>
        <p className="text-sm font-medium">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>
      <Field label={meta.unit} htmlFor={`s-${settingKey}`} error={error ?? (save.error ? userMessage(save.error) : undefined)}>
        <Input id={`s-${settingKey}`} inputMode="numeric" value={draft} disabled={!can.manageSettings} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      {can.manageSettings ? <Button type="submit" variant="outline" loading={save.isPending}>Save</Button> : <span />}
    </form>
  );
}

function MonitoringCard() {
  const settings = useSettings();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Monitoring</CardTitle>
          <CardDescription>Conservative defaults suit metered Starlink links. The connector picks up changes on its next cycle.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        {settings.isPending ? (
          <TableSkeleton rows={3} cols={2} />
        ) : settings.isError ? (
          <div className="py-4"><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></div>
        ) : (
          SETTING_KEYS.map((k) => (
            <SettingRow key={k} settingKey={k} value={settingValue(k, settings.data)} existing={settings.data.some((s) => s.key === k)} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function MemberRow({ member }: { member: ProfileRow }) {
  const { profile, can, role: myRole } = useAuth();
  const update = useUpdateMember();
  const [confirm, setConfirm] = useState<null | 'suspend' | 'restore'>(null);
  const isSelf = member.id === profile?.id;
  const editable = can.manageTeam && !isSelf && (member.role !== 'SUPER_ADMIN' || myRole === 'SUPER_ADMIN');
  return (
    <TR>
      <TD>
        <div className="font-medium">{member.full_name || member.email}</div>
        <div className="text-xs text-muted-foreground">{member.email}{isSelf ? ' (you)' : ''}</div>
      </TD>
      <TD>
        {editable && member.role !== 'SUPER_ADMIN' ? (
          <Select
            aria-label={`Role for ${member.email}`}
            className="w-auto"
            value={member.role}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ profileId: member.id, role: e.target.value as AppRole, status: member.status }, { onSuccess: () => toast.success('Role updated'), onError: (err) => toast.error(userMessage(err)) })}
          >
            <option value="ADMIN">Admin</option>
            <option value="TECHNICIAN">Technician</option>
          </Select>
        ) : (
          ROLE_LABELS[member.role as Role]
        )}
      </TD>
      <TD>{member.status === 'active' ? <Pill tone="good">Active</Pill> : <Pill tone="critical">Suspended</Pill>}</TD>
      <TD className="text-right">
        {editable ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirm(member.status === 'active' ? 'suspend' : 'restore')}>
            {member.status === 'active' ? 'Suspend' : 'Restore'}
          </Button>
        ) : null}
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm === 'suspend' ? `Suspend ${member.email}?` : `Restore ${member.email}?`}
          description={confirm === 'suspend' ? 'They lose access immediately; their audit history is kept. You can restore them later.' : 'They regain access with their current role.'}
          confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Restore'}
          destructive={confirm === 'suspend'}
          pending={update.isPending}
          onConfirm={() => update.mutate({ profileId: member.id, role: member.role, status: confirm === 'suspend' ? 'suspended' : 'active' }, { onSuccess: () => setConfirm(null), onError: (err) => toast.error(userMessage(err)) })}
        />
      </TD>
    </TR>
  );
}

type GrantableRole = 'SUPER_ADMIN' | 'ADMIN' | 'TECHNICIAN';

function PendingAccountRow({ account }: { account: PendingAccount }) {
  const grant = useGrantAccess();
  const remove = useRemovePendingAccount();
  const [role, setRole] = useState<GrantableRole>('TECHNICIAN');
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <TR>
      <TD>
        <div className="font-medium">{account.email}</div>
        <div className="text-xs text-muted-foreground">
          Created <RelativeTime value={account.created_at} />
          {account.email_confirmed ? '' : ' · email not confirmed'}
        </div>
      </TD>
      <TD>
        <Select aria-label={`Role for ${account.email}`} className="w-auto" value={role} onChange={(e) => setRole(e.target.value as GrantableRole)}>
          <option value="TECHNICIAN">Technician</option>
          <option value="ADMIN">Admin</option>
          <option value="SUPER_ADMIN">Super admin</option>
        </Select>
      </TD>
      <TD className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            loading={grant.isPending}
            onClick={() =>
              grant.mutate(
                { userId: account.user_id, role },
                { onSuccess: () => toast.success(`${account.email} can now sign in as ${ROLE_LABELS[role]}`), onError: (e) => toast.error(userMessage(e)) },
              )
            }
          >
            Grant access
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </div>
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={`Remove ${account.email}?`}
          description="Deletes this sign-in account. It never had access to any data. The removal is recorded in the audit log."
          confirmLabel="Remove account"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate(account.user_id, { onSuccess: () => setConfirmRemove(false), onError: (e) => toast.error(userMessage(e)) })}
        />
      </TD>
    </TR>
  );
}

/** SUPER_ADMIN only: accounts created in Supabase (dashboard "Add user") that have no role yet. */
function PendingAccountsCard() {
  const pending = usePendingAccounts(true);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Waiting for access</CardTitle>
          <CardDescription>
            Accounts created in the Supabase dashboard (Authentication → Add user) or signed up without an invitation.
            They cannot see anything until you grant a role.
          </CardDescription>
        </div>
      </CardHeader>
      {pending.isPending ? (
        <TableSkeleton rows={2} cols={3} />
      ) : pending.isError ? (
        <div className="p-4"><ErrorState error={pending.error} onRetry={() => void pending.refetch()} /></div>
      ) : pending.data.length === 0 ? (
        <EmptyState title="No accounts waiting" description="When someone is added in the Supabase dashboard, they appear here so you can choose their role." />
      ) : (
        <Table>
          <THead><TR className="hover:bg-transparent"><TH>Account</TH><TH>Role to grant</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></TR></THead>
          <TBody>{pending.data.map((a) => <PendingAccountRow key={a.user_id} account={a} />)}</TBody>
        </Table>
      )}
    </Card>
  );
}

function TeamCard() {
  const { can, role: myRole } = useAuth();
  const team = useTeam();
  const invites = useInvites(can.manageTeam);
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [link, setLink] = useState<string | null>(null);
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', role: 'TECHNICIAN' } });
  const { errors } = form.formState;

  return (
    <div className="grid gap-4">
      {can.manageTeam ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Invite a team member</CardTitle>
              <CardDescription>Share the one-time link with the person directly (WhatsApp, SMS or email). They get access as soon as they sign up with it.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <form
              className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              noValidate
              onSubmit={form.handleSubmit((v) =>
                create.mutate(v, {
                  onSuccess: (row) => {
                    setLink(`${window.location.origin}/signup?invite=${row.token}`);
                    form.reset({ email: '', role: v.role });
                  },
                }),
              )}
            >
              <Field label="Email" htmlFor="invite-email" error={errors.email?.message}>
                <Input type="email" {...fieldA11y('invite-email', errors.email?.message)} {...form.register('email')} />
              </Field>
              <Field label="Role" htmlFor="invite-role">
                <Select id="invite-role" {...form.register('role')}>
                  <option value="TECHNICIAN">Technician</option>
                  <option value="ADMIN">Admin</option>
                </Select>
              </Field>
              <Button type="submit" loading={create.isPending}><UserPlus /> Create invitation</Button>
            </form>
            <InlineError error={create.error} />
            {link ? (
              <div className="grid gap-2 rounded-md bg-accent p-3 text-sm text-accent-foreground">
                <p className="flex items-center gap-2 font-medium"><Link2 className="size-4" aria-hidden /> Invitation link (shown once, valid 7 days)</p>
                <code className="break-all rounded bg-card px-2 py-1 font-mono text-xs text-foreground">{link}</code>
                <div><CopyButton text={link} label="Copy link" /></div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {myRole === 'SUPER_ADMIN' ? <PendingAccountsCard /> : null}

      <Card>
        <CardHeader><CardTitle>Team</CardTitle></CardHeader>
        {team.isPending ? (
          <TableSkeleton rows={3} cols={3} />
        ) : team.isError ? (
          <div className="p-4"><ErrorState error={team.error} onRetry={() => void team.refetch()} /></div>
        ) : (
          <Table>
            <THead><TR className="hover:bg-transparent"><TH>Member</TH><TH>Role</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></TR></THead>
            <TBody>{team.data.map((m) => <MemberRow key={m.id} member={m} />)}</TBody>
          </Table>
        )}
      </Card>

      {can.manageTeam ? (
        <Card>
          <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
          {invites.isPending ? (
            <TableSkeleton rows={2} cols={3} />
          ) : invites.isError ? (
            <div className="p-4"><ErrorState error={invites.error} /></div>
          ) : invites.data.length === 0 ? (
            <EmptyState title="No pending invitations" description="Invitations you create appear here until they are used, revoked, or expire." />
          ) : (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Email</TH><TH>Role</TH><TH>Expires</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></TR></THead>
              <TBody>
                {invites.data.map((i) => (
                  <TR key={i.id}>
                    <TD>{i.email}</TD>
                    <TD>{ROLE_LABELS[i.role as Role]}</TD>
                    <TD className="text-xs">{new Date(i.expires_at) < new Date() ? 'expired' : <RelativeTime value={i.expires_at} />}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id, { onError: (e) => toast.error(userMessage(e)) })}>
                        Revoke
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function ProfileCard() {
  const { profile, role, tenant } = useAuth();
  const updateName = useUpdateProfileName();
  const nameForm = useForm({ resolver: zodResolver(profileSchema), defaultValues: { fullName: profile?.full_name ?? '' } });
  const pwForm = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { password: '', confirmPassword: '' } });
  const [pwError, setPwError] = useState<unknown>(null);
  const pwErrors = pwForm.formState.errors;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Facts items={[{ label: 'Email', value: profile?.email ?? '—' }, { label: 'Role', value: role ? ROLE_LABELS[role] : '—' }, { label: 'Organization', value: tenant?.name ?? '—' }]} />
          <form className="grid gap-3" noValidate onSubmit={nameForm.handleSubmit((v) => profile && updateName.mutate({ id: profile.id, fullName: v.fullName }, { onSuccess: () => toast.success('Name saved') }))}>
            <Field label="Display name" htmlFor="full-name">
              <Input {...fieldA11y('full-name')} {...nameForm.register('fullName')} />
            </Field>
            <InlineError error={updateName.error} />
            <div><Button type="submit" variant="outline" loading={updateName.isPending}>Save name</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            noValidate
            onSubmit={pwForm.handleSubmit(async (v) => {
              setPwError(null);
              const { error } = await getSupabase().auth.updateUser({ password: v.password });
              if (error) {
                setPwError(toAppError(error));
                return;
              }
              pwForm.reset();
              toast.success('Password changed');
            })}
          >
            <Field label="New password" htmlFor="new-password" error={pwErrors.password?.message} hint="At least 10 characters, with letters and digits.">
              <Input type="password" autoComplete="new-password" {...fieldA11y('new-password', pwErrors.password?.message)} {...pwForm.register('password')} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password" error={pwErrors.confirmPassword?.message}>
              <Input type="password" autoComplete="new-password" {...fieldA11y('confirm-password', pwErrors.confirmPassword?.message)} {...pwForm.register('confirmPassword')} />
            </Field>
            <InlineError error={pwError} />
            <div><Button type="submit" variant="outline" loading={pwForm.formState.isSubmitting}>Change password</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SystemCard() {
  const c = useConnector();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Connector</CardTitle>
          <CardDescription>The Hotzonex control plane on the VPS. It is the only component that talks to routers.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {c.isPending ? (
          <TableSkeleton rows={2} cols={2} />
        ) : c.isError ? (
          <ErrorState error={c.error} onRetry={() => void c.refetch()} />
        ) : !c.data.row ? (
          <EmptyState title="The connector has never reported in" description="Deploy and start the connector (docs/RUNBOOK.md). It appears here within 30 seconds of starting." />
        ) : (
          <Facts
            items={[
              { label: 'Status', value: c.data.online ? <Pill tone="good">Online</Pill> : <Pill tone="critical">Not reporting</Pill> },
              { label: 'Last heartbeat', value: <RelativeTime value={c.data.row.last_heartbeat_at} /> },
              { label: 'Mode', value: c.data.mock ? 'Mock — simulated routers and WireGuard' : `Real routers (${c.data.row.provider_mode})` },
              { label: 'Version', value: c.data.row.version ?? '—' },
              { label: 'Instance', value: c.data.row.connector_id, mono: true },
              { label: 'Running since', value: <RelativeTime value={c.data.row.started_at} /> },
              { label: 'WireGuard endpoint', value: c.data.row.wg_endpoint ?? 'not configured', mono: true },
              { label: 'Credential key id', value: c.data.row.sealing_key_id, mono: true },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

const TABS = ['organization', 'monitoring', 'team', 'profile', 'system'] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as string) : 'organization';
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
        <TabsContent value="organization"><OrganizationCard /></TabsContent>
        <TabsContent value="monitoring"><MonitoringCard /></TabsContent>
        <TabsContent value="team"><TeamCard /></TabsContent>
        <TabsContent value="profile"><ProfileCard /></TabsContent>
        <TabsContent value="system"><SystemCard /></TabsContent>
      </Tabs>
    </>
  );
}
