import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { InventoryBoard } from '../src/merchant/InventoryBoard';
import { MerchantApi } from '../src/merchant/client';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const api = new MerchantApi('/api', () => 'owner', () => null, () => null);
const item = { id: 'i', name: 'Cake', unit: 'PORTION', tracked: true, quantity: 4, reservedQuantity: 0, pendingLossQuantity: 0, availableQuantity: 4, threshold: 2, revision: 1 };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
it('requires a reason and retries a failed adjustment with the same key', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => json(init.method === 'POST' ? { error: { code: 'TEMPORARY', message: 'Try later' } } : url.includes('/movements') ? { movements: [] } : { items: [item] }, init.method === 'POST' ? 503 : 200));
    vi.stubGlobal('fetch', fetcher);
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner manage/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Cake' }));
    fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record stock change' }));
    expect(fetcher.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Damaged portion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record stock change' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Record stock change' }));
    await screen.findByRole('alert');
    const writes = fetcher.mock.calls.filter(([, i]) => i.method === 'POST').map(([, i]) => JSON.parse(i.body as string));
    expect(writes).toHaveLength(2);
    expect(writes[0].idempotencyKey).toBe(writes[1].idempotencyKey);
});
it('hides management and ignores a response from an old venue', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/old/') ? new Promise<Response>(r => finish = r) : Promise.resolve(json({ items: [] }))));
    const view = render(<InventoryBoard api={api} venueId="old" scope="old" owner manage/>);
    view.rerender(<InventoryBoard api={api} venueId="new" scope="new"/>);
    await act(async () => finish(json({ items: [item] })));
    expect(screen.queryByText('Cake')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add stock item' })).toBeNull();
});
it('shows a stock correction and only offers eligible reversal', async () => {
    let quantity = 4;
    const movement = { id: 'm', delta: -2, kind: 'ADJUSTMENT', reason: 'Damaged portions', actorName: 'Ola', createdAt: '2026-10-16T10:00:00Z', reversesMovementId: null, reversedByMovementId: 'r' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { if (init.method === 'POST') {
        quantity = 2;
        return json({ item: { ...item, quantity, revision: 2 }, movement });
    } return json(url.includes('/movements') ? { movements: quantity === 2 ? [movement] : [], hasMore: false } : { items: [{ ...item, quantity, availableQuantity: quantity, revision: quantity === 2 ? 2 : 1 }], hasMore: false }); }));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner manage/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Cake' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Damaged portions' } });
    fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record stock change' }));
    expect(await screen.findByText('Low stock')).toBeTruthy();
    expect(await screen.findByText('Damaged portions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reverse stock movement' })).toBeNull();
});
it('clears stock on refresh failure', async () => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => fail ? json({ error: { code: 'FORBIDDEN' } }, 403) : json({ items: [item], hasMore: false })));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner manage/>);
    await screen.findByRole('button', { name: 'Cake' });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Cake')).toBeNull();
});
it('ignores an old history page after selecting another item', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('/i/movements?page=1'))
        return new Promise<Response>(r => finish = r); if (url.includes('/movements'))
        return json({ movements: [], hasMore: url.includes('/i/') }); return json({ items: [item, { ...item, id: 'b', name: 'Bread' }], hasMore: false }); }));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner manage/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Cake' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more stock movements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bread' }));
    await act(async () => finish(json({ movements: [{ id: 'old', reason: 'OLD HISTORY', delta: 1, createdAt: '2026-10-16T10:00:00Z' }], hasMore: false })));
    expect(screen.queryByText('OLD HISTORY')).toBeNull();
});
it('finds an item by barcode outside the loaded page and only reverses generic movements',async()=>{
 const found={...item,id:'found',name:'Juice',barcode:'12345678'};
 const fetcher=vi.fn(async(url:string)=>json(url.includes('/lookup?')?{items:[found]}:url.includes('/movements')?{movements:[{id:'typed',delta:2,kind:'RECEIPT',reason:'Delivery',actorName:'Ola',createdAt:'2026-10-16T10:00:00Z'}]}:{items:[item]}));
 vi.stubGlobal('fetch',fetcher);
 render(<InventoryBoard api={api} venueId="v" scope="owner" owner manage/>);
 fireEvent.change(screen.getByLabelText('Find stock item by barcode'),{target:{value:'12345678'}});
 fireEvent.click(screen.getByRole('button',{name:'Find barcode'}));
 await screen.findByRole('button',{name:'Juice'});
 expect((screen.getByLabelText('Item barcode') as HTMLInputElement).value).toBe('12345678');
 await screen.findByText('Delivery');
 expect(screen.queryByRole('button',{name:'Reverse stock movement'})).toBeNull();
});
it('shows server availability separately from physical, reserved and pending loss quantities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [{ ...item, quantity: 12, reservedQuantity: 5, pendingLossQuantity: 3, availableQuantity: 4 }], hasMore: false })));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner/>);
    await screen.findByRole('button', { name: 'Cake' });
    expect(screen.getByText('Physical stock: 12')).toBeTruthy();
    expect(screen.getByText('Reserved stock: 5')).toBeTruthy();
    expect(screen.getByText('Pending losses: 3')).toBeTruthy();
    expect(screen.getByText('Available to sell: 4 portions')).toBeTruthy();
    expect(screen.queryByText('Low stock')).toBeNull();
});
it('flags low availability even when physical stock is high and never guesses a missing availability', async () => {
    let available: number | undefined = 1;
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [{ ...item, quantity: 12, availableQuantity: available }], hasMore: false })));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner/>);
    await screen.findByText('Low stock');
    available = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
    await screen.findByText('Available to sell: Unavailable portions');
    expect(screen.queryByText('Low stock')).toBeNull();
});
it('distinguishes loading stock from an empty venue and a failed read', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve})));
    render(<InventoryBoard api={api} venueId="v" scope="owner" owner/>);
    expect(screen.getByRole('status').textContent).toBe('Loading stock…');
    await act(async()=>finish(json({error:{code:'TEMPORARY'}},503)));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No stock items yet.')).toBeNull();
});
