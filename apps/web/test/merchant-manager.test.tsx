import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MerchantTerminal } from '../src/merchant/Merchant';
vi.mock('../src/AppContext', () => ({ useApp: () => ({ token: null, api: { baseUrl: '/api' } }), useAppOptional: () => null }));
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => { }) }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('hides cached delegated access until verified and ignores a late report after revocation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const venue = { id: 'v', name: 'Cafe', fiatCurrency: 'EUR' };
    const manager = { id: 'm', name: 'Ola', active: true, role: 'MANAGER', permissions: ['reports.view'] };
    sessionStorage.setItem('nimble:merchant:/api:cashier', JSON.stringify({ token: 'staff', venue, employee: manager }));
    let finishSession!: (value: Response) => void;
    let finishReport!: (value: Response) => void;
    let refreshed = false;
    const json = (value: unknown) => new Response(JSON.stringify(value));
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.endsWith('/session'))
            return refreshed ? Promise.resolve(json({ venue, employee: { ...manager, permissions: [] } })) : new Promise(resolve => { finishSession = resolve; });
        if (url.endsWith('/venues/v/report'))
            return new Promise(resolve => { finishReport = resolve; });
        return Promise.resolve(json(url.endsWith('/current') ? null : []));
    }));
    render(<MemoryRouter><MerchantTerminal /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Management' })).toBeNull();
    await act(async () => { finishSession(json({ venue, employee: manager })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Management' }));
    await waitFor(() => expect(finishReport).toBeTypeOf('function'));
    refreshed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.queryByRole('button', { name: 'Management' })).toBeNull();
    await act(async () => { finishReport(json({ totals: { netMinor: 999999 }, orders: [] })); });
    expect(screen.queryByText('Venue report')).toBeNull();
});
it.each(['initial load', 'poll'])('keeps the new cashier signed in when an old %s returns 401', async (source) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const venue = { id: 'v', name: 'Cafe', fiatCurrency: 'EUR' };
    const previous = { id: 'old', name: 'Anna', active: true, role: 'CASHIER', permissions: [] };
    const next = { ...previous, id: 'new', name: 'Leo' };
    sessionStorage.setItem('nimble:merchant:/api:cashier', JSON.stringify({ token: 'old-token', venue, employee: previous }));
    const json = (value: unknown) => new Response(JSON.stringify(value));
    let hold = source === 'initial load';
    let finishOld!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
        const old = (init.headers as Record<string, string>)?.authorization === 'Bearer old-token';
        if (url.endsWith('/session')) return Promise.resolve(json({ venue, employee: old ? previous : next }));
        if (url.endsWith('/terminal/profiles')) return Promise.resolve(json({ venue, employees: [previous, next] }));
        if (url.endsWith('/terminal/login')) return Promise.resolve(json({ token: 'new-token', venue, employee: next }));
        if (url.endsWith('/venues/v/orders') && old && hold) return new Promise(resolve => { finishOld = resolve; });
        if (url.endsWith('/rates')) return Promise.resolve(json({ NIM: null, USDT: null }));
        return Promise.resolve(json(url.endsWith('/current') ? null : []));
    }));
    render(<MemoryRouter><MerchantTerminal /></MemoryRouter>);
    await screen.findByText('Anna');
    if (source === 'poll') {
        hold = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    }
    expect(finishOld).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: /^Shift$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out / switch cashier' }));
    fireEvent.change(await screen.findByLabelText('Cashier profile'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Personal PIN'), { target: { value: '5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start your day →' }));
    await waitFor(() => expect(screen.queryByLabelText('Cashier profile')).toBeNull());
    await screen.findByText('Leo');
    await act(async () => { finishOld(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Old session expired' } }), { status: 401 })); });
    expect(screen.getByText('Leo')).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('nimble:merchant:/api:cashier')!).token).toBe('new-token');
    expect(screen.queryByText('Old session expired')).toBeNull();
});
it('still signs out the active cashier when their own poll is unauthorized', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const venue = { id: 'v', name: 'Cafe', fiatCurrency: 'EUR' };
    const employee = { id: 'm', name: 'Anna', active: true, role: 'CASHIER', permissions: [] };
    sessionStorage.setItem('nimble:merchant:/api:cashier', JSON.stringify({ token: 'staff', venue, employee }));
    const json = (value: unknown) => new Response(JSON.stringify(value));
    let revoked = false;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.endsWith('/session')) return Promise.resolve(json({ venue, employee }));
        if (url.endsWith('/terminal/profiles')) return Promise.resolve(json({ venue, employees: [employee] }));
        if (url.endsWith('/venues/v/orders') && revoked) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }));
        if (url.endsWith('/rates')) return Promise.resolve(json({ NIM: null, USDT: null }));
        return Promise.resolve(json(url.endsWith('/current') ? null : []));
    }));
    render(<MemoryRouter><MerchantTerminal /></MemoryRouter>);
    await screen.findByText('Anna');
    revoked = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(await screen.findByLabelText('Cashier profile')).toBeTruthy();
    expect(sessionStorage.getItem('nimble:merchant:/api:cashier')).toBeNull();
});
it('clears the previous cashier shift and report while the next cashier data is loading', async () => {
    const venue = { id: 'v', name: 'Cafe', fiatCurrency: 'EUR' };
    const previous = { id: 'old', name: 'Anna', active: true, role: 'CASHIER', permissions: [] };
    const next = { ...previous, id: 'new', name: 'Leo' };
    sessionStorage.setItem('nimble:merchant:/api:cashier', JSON.stringify({ token: 'old-token', venue, employee: previous }));
    const json = (value: unknown) => new Response(JSON.stringify(value));
    const report = { totals: { netMinor: 98765, grossMinor: 98765, refundedMinor: 0, paid: 1, fiatCurrency: 'EUR', assets: { NIM: '0', USDT: '0' } }, orders: [] };
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
        const old = (init.headers as Record<string, string>)?.authorization === 'Bearer old-token';
        if (url.endsWith('/session')) return Promise.resolve(json({ venue, employee: old ? previous : next }));
        if (url.endsWith('/terminal/profiles')) return Promise.resolve(json({ venue, employees: [previous, next] }));
        if (url.endsWith('/terminal/login')) return Promise.resolve(json({ token: 'new-token', venue, employee: next }));
        if (url.endsWith('/venues/v/orders') && (init.headers as Record<string, string>)?.authorization === 'Bearer new-token') return new Promise(() => {});
        if (url.endsWith('/current')) return Promise.resolve(json(old ? { id: 'old-shift', openedAt: '2026-10-19T06:00:00Z' } : null));
        if (url.endsWith('/report')) return Promise.resolve(json(report));
        if (url.endsWith('/rates')) return Promise.resolve(json({ NIM: null, USDT: null }));
        return Promise.resolve(json([]));
    }));
    render(<MemoryRouter><MerchantTerminal /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Shift$/ }));
    await screen.findAllByText(/987.65/);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out / switch cashier' }));
    fireEvent.change(await screen.findByLabelText('Cashier profile'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Personal PIN'), { target: { value: '5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start your day →' }));
    await waitFor(() => expect(screen.queryByLabelText('Cashier profile')).toBeNull());
    await screen.findByText('Leo');
    expect(screen.queryByRole('button', { name: 'Close my shift' })).toBeNull();
    expect(screen.queryAllByText(/987.65/)).toHaveLength(0);
});
