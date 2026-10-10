import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './lib/app';
import { configMissing } from './lib/supabase';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardPage from './pages/DashboardPage';
import SellPage from './pages/SellPage';
import VouchersPage from './pages/VouchersPage';
import PrintPage from './pages/PrintPage';
import SalesPage from './pages/SalesPage';
import ReportsPage from './pages/ReportsPage';
import ActivePage from './pages/ActivePage';
import ExpiredPage from './pages/ExpiredPage';
import RoutersPage from './pages/RoutersPage';
import DevicesPage from './pages/DevicesPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const { session, loading, tenant, isAdmin } = useApp();

  if (configMissing) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-bold">Hotzonex Cloud is not configured</h1>
        <p className="mt-2 text-slate-600">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the Vercel project's
          environment variables (or a local <code>.env</code>), then redeploy.
        </p>
      </div>
    );
  }
  if (loading) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (!session) return <LoginPage />;
  if (!tenant) return <OnboardingPage />;

  const admin = (el: JSX.Element) => (isAdmin ? el : <Navigate to="/" replace />);

  return (
    <Routes>
      <Route path="/print/:batchId" element={admin(<PrintPage />)} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="sell" element={<SellPage />} />
        <Route path="vouchers" element={admin(<VouchersPage />)} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="reports" element={admin(<ReportsPage />)} />
        <Route path="active" element={<ActivePage />} />
        <Route path="expired" element={<ExpiredPage />} />
        <Route path="routers" element={admin(<RoutersPage />)} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="settings" element={admin(<SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
