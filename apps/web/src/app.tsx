import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from './components/shell';
import { EmptyState, ErrorState } from './components/states';
import { Button } from './components/ui/button';
import { TooltipProvider } from './components/ui/overlays';
import { AuthProvider, useAuth } from './lib/auth';
import { readEnv } from './lib/env';
import { createPersister, createQueryClient, shouldPersist } from './lib/query-client';
import { ThemeProvider, useTheme } from './lib/theme';
import { UpdatePrompt } from './components/update-prompt';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately not logging error details to the console in production builds.
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          human={{
            title: 'This page stopped working',
            explanation: 'Something unexpected happened while showing this page. Your data is safe; nothing was changed.',
            nextAction: 'Reload the page. If it keeps happening, note what you clicked and contact Hotzonex support.',
          }}
        />
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

function FullPageLoader() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/** Signed in, with an active staff profile. Everything else sees an explanation, not a blank page. */
function RequireStaff() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading' || (auth.status === 'signed_in' && auth.profileLoading)) return <FullPageLoader />;
  if (auth.status === 'signed_out') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (auth.profileError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={auth.profileError} />
      </div>
    );
  }
  if (!auth.profile || auth.profile.status !== 'active' || !auth.can.viewNetwork) {
    const suspended = auth.profile?.status === 'suspended';
    return (
      <EmptyState
        className="h-full"
        title={suspended ? 'Your account is suspended' : 'No access yet'}
        description={
          suspended
            ? 'An administrator has suspended this account. Contact your Hotzonex administrator to restore access.'
            : auth.profile
              ? 'Your role has no access to the admin console in this version. Contact your administrator.'
              : 'Your account is waiting for access. A Hotzonex super admin can grant it in Settings → Team → Waiting for access.'
        }
        action={<Button variant="outline" onClick={() => void auth.signOut()}>Sign out</Button>}
      />
    );
  }
  return <AppShell />;
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <FullPageLoader />;
  if (auth.status === 'signed_in') return <Navigate to="/" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    path: '/login',
    hydrateFallbackElement: <FullPageLoader />,
    lazy: async () => {
      const { LoginPage } = await import('./pages/login');
      return { element: <RedirectIfSignedIn><LoginPage /></RedirectIfSignedIn> };
    },
  },
  {
    path: '/signup',
    hydrateFallbackElement: <FullPageLoader />,
    lazy: async () => ({ Component: (await import('./pages/signup')).SignupPage }),
  },
  {
    element: <RequireStaff />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./pages/dashboard')).DashboardPage }) },
      { path: 'routers', lazy: async () => ({ Component: (await import('./pages/routers-list')).RoutersPage }) },
      { path: 'routers/new', lazy: async () => ({ Component: (await import('./pages/router-wizard')).RouterWizardPage }) },
      { path: 'routers/:id/onboard', lazy: async () => ({ Component: (await import('./pages/router-wizard')).RouterWizardPage }) },
      { path: 'routers/:id', lazy: async () => ({ Component: (await import('./pages/router-detail')).RouterDetailPage }) },
      { path: 'locations', lazy: async () => ({ Component: (await import('./pages/locations')).LocationsPage }) },
      { path: 'audit', lazy: async () => ({ Component: (await import('./pages/audit')).AuditPage }) },
      { path: 'settings', lazy: async () => ({ Component: (await import('./pages/settings')).SettingsPage }) },
      {
        path: '*',
        element: (
          <EmptyState title="Page not found" description="That address does not match anything in Hotzonex Cloud." action={<Button asChild variant="outline"><a href="/">Go to the dashboard</a></Button>} />
        ),
      },
    ],
  },
]);

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-right" richColors closeButton />;
}

function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <div className="mx-auto max-w-lg p-6">
      <ErrorState
        human={{
          title: 'Hotzonex Cloud is not configured',
          explanation: `The web app is missing: ${missing.join(', ')}.`,
          nextAction: 'Copy apps/web/.env.example to apps/web/.env.local, fill in the Supabase URL and anon key, and restart. On Vercel, set them as project environment variables.',
        }}
      />
    </div>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [persister] = useState(createPersister);
  const env = readEnv();
  if (!env.ok) return <ConfigMissing missing={env.missing} />;
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister, maxAge: 24 * 60 * 60_000, buster: 'v1', dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}
        >
          <TooltipProvider>
            <AuthProvider>
              <RouterProvider router={router} />
              <ThemedToaster />
              <UpdatePrompt />
            </AuthProvider>
          </TooltipProvider>
        </PersistQueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
