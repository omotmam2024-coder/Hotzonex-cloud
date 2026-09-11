import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RouterForm } from '@/components/router-form';
import { DemoBadge, StatusBadge } from '@/components/status';
import { ErrorState } from '@/components/states';
import { TooltipProvider } from '@/components/ui/overlays';
import { UptimeBars, buildUptimeSeries } from '@/components/uptime-bars';

describe('StatusBadge', () => {
  it('always carries a text label, never color alone', () => {
    render(<StatusBadge status="offline" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
  it('falls back to Unknown for unexpected values', () => {
    render(<StatusBadge status="banana" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
  it('DEMO badge is visible text', () => {
    render(<DemoBadge />);
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('shows what happened, why, and what to do next', () => {
    render(<ErrorState human={{ title: 'Login rejected', explanation: 'The router rejected the password.', nextAction: 'Run the script again.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Login rejected');
    expect(screen.getByRole('alert')).toHaveTextContent('Run the script again.');
  });
});

describe('UptimeBars', () => {
  it('has an accessible summary and prints the figure as text', () => {
    const series = buildUptimeSeries([{ router_id: 'r', bucket_start: new Date(Math.floor(Date.now() / 21_600_000) * 21_600_000).toISOString(), samples: 4, reachable_samples: 3 }], 'r', new Date());
    render(<TooltipProvider><UptimeBars series={series} label="Gate" /></TooltipProvider>);
    expect(screen.getByRole('img', { name: 'Gate: 75% uptime over 7 days' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });
});

describe('RouterForm', () => {
  it('switching protocol updates the default port and validates before submit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RouterForm showLocation={false} submitLabel="Create" onSubmit={onSubmit} />);
    const port = screen.getByLabelText('Port') as HTMLInputElement;
    expect(port.value).toBe('8728');
    await user.selectOptions(screen.getByLabelText('API protocol'), 'api_ssl');
    expect(port.value).toBe('8729');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Router name/), 'Lologo Gate');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: 'Lologo Gate', api_protocol: 'api_ssl', api_port: 8729, use_ssl: true });
  });
});
