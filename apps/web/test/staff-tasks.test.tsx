import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskBoard } from '../src/merchant/TaskBoard';
import { MerchantApi } from '../src/merchant/client';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const task = { id: 't', title: 'Clean restroom', instructions: 'Clean surfaces', status: 'TODO', revision: 1, assigneeEmployeeId: 'worker', reviewerEmployeeId: 'manager', dueAt: '2026-10-16T10:00:00Z', requiredPhotos: 'NONE' };
const api = new MerchantApi('/api', () => null, () => 'staff', () => null);
it('cashier starts an assigned task and sees server failure without losing its action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'POST' ? { error: { code: 'TEMPORARY', message: 'Try later' } } : { tasks: [task] }), { status: init.method === 'POST' ? 503 : 200 })));
    render(<TaskBoard api={api} venueId="v" scope="staff" employeeId="worker"/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Start task' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start task' })).toBeTruthy();
});
it('ignores tasks arriving after account scope changes', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/venues/old/') ? new Promise<Response>(resolve => finish = resolve) : Promise.resolve(new Response(JSON.stringify({ tasks: [] })))));
    const view = render(<TaskBoard api={api} venueId="old" scope="old" employeeId="worker"/>);
    view.rerender(<TaskBoard api={api} venueId="new" scope="new" employeeId="other"/>);
    await act(async () => finish(new Response(JSON.stringify({ tasks: [task] }))));
    expect(screen.queryByText('Clean restroom')).toBeNull();
});
it('retries a failed task mutation with the same idempotency key and forbids self review', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'POST' ? { error: { code: 'TEMPORARY', message: 'Try later' } } : _url.endsWith('/task-templates') ? { templates: [] } : _url.endsWith('/task-people') ? { employees: [] } : { tasks: [{ ...task, status: 'SUBMITTED', completedBy: 'worker' }] }), { status: init.method === 'POST' ? 503 : 200 }));
    vi.stubGlobal('fetch', fetcher);
    render(<TaskBoard api={api} venueId="v" scope="staff" employeeId="worker" manage/>);
    await screen.findByText('Clean restroom');
    expect(screen.queryByRole('button', { name: 'Approve task' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cancelled operation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip with reason' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Skip with reason' }));
    await screen.findByRole('alert');
    const writes = fetcher.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(init.body as string));
    expect(writes).toHaveLength(2);
    expect(writes[0].idempotencyKey).toBe(writes[1].idempotencyKey);
});
it('keeps the changed task state when an older poll completes after a mutation', async () => {
    vi.useFakeTimers({shouldAdvanceTime:true});
    let finishPoll!: (value: Response) => void;
    let reads = 0;
    const json = (value: unknown) => new Response(JSON.stringify(value));
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') return json({...task,status:'IN_PROGRESS',revision:2});
        reads++;
        if (reads === 2) return new Promise<Response>(resolve => {finishPoll=resolve;});
        return json({tasks:[reads===1?task:{...task,status:'IN_PROGRESS',revision:2}]});
    }));
    render(<TaskBoard api={api} venueId="v" scope="staff" employeeId="worker"/>);
    await screen.findByRole('button',{name:'Start task'});
    await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});
    fireEvent.click(screen.getByRole('button',{name:'Start task'}));
    await screen.findByRole('button',{name:'Submit for review'});
    await act(async()=>{finishPoll(json({tasks:[task]}));});
    expect(screen.queryByRole('button',{name:'Start task'})).toBeNull();
    expect(screen.getByRole('button',{name:'Submit for review'})).toBeTruthy();
    vi.useRealTimers();
});
it('owner can perform an unassigned task and explicitly declare their own completion',async()=>{
 let current={...task,assigneeEmployeeId:null,reviewerEmployeeId:null,ownerDeclared:false,completedBy:null as string|null};
 const json=(value:unknown)=>new Response(JSON.stringify(value));
 const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
  if(init.method==='POST'){const body=JSON.parse(init.body as string);current={...current,status:body.action==='START'?'IN_PROGRESS':body.action==='SUBMIT'?'SUBMITTED':'APPROVED',completedBy:'owner:owner-id',ownerDeclared:body.action==='OWNER_DECLARE',revision:current.revision+1};return json(current)}
  return json(url.endsWith('task-templates')?{templates:[]}:url.endsWith('task-people')?{employees:[]}:{tasks:[current]});
 });vi.stubGlobal('fetch',fetcher);
 render(<TaskBoard api={api} venueId="v" scope="owner" owner manage/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start task'}));
 fireEvent.click(await screen.findByRole('button',{name:'Submit for review'}));
 const declaration=await screen.findByRole('button',{name:'Record owner declaration'});
 expect(screen.queryByRole('button',{name:'Approve task'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Owner performed cleaning'}});
 fireEvent.click(declaration);
 await screen.findByText('Owner declaration · no independent review');
 await screen.findByText('Approved');
 expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST').map(([,init])=>JSON.parse(init.body as string).action)).toEqual(['START','SUBMIT','OWNER_DECLARE']);
});
it('owner can choose before and after photo requirements when creating a template',async()=>{
 let input:Record<string,unknown>|null=null;
 const json=(value:unknown)=>new Response(JSON.stringify(value));
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  if(init.method==='POST'){input=JSON.parse(init.body as string);return json(input)}
  return json(url.endsWith('task-templates')?{templates:[]}:url.endsWith('task-people')?{employees:[]}:{tasks:[]});
 }));
 render(<TaskBoard api={api} venueId="v" scope="owner" owner manage/>);
 fireEvent.click(screen.getByRole('button',{name:'Create task template'}));
 fireEvent.change(screen.getByLabelText('Task title'),{target:{value:'Restroom cleaning'}});
 fireEvent.change(screen.getByLabelText('Instructions'),{target:{value:'Disinfect all surfaces'}});
 fireEvent.change(screen.getByLabelText('Schedule'),{target:{value:'DAILY'}});
 fireEvent.change(screen.getByLabelText('Required task photos'),{target:{value:'BOTH'}});
 fireEvent.click(screen.getByRole('button',{name:'Save task template'}));
 await act(async()=>{});
 expect(input).toMatchObject({requiredPhotos:'BOTH',schedule:'DAILY',title:'Restroom cleaning'});
});

it('marks an owner photo exception after loading the persisted task',async()=>{
 const api={request:vi.fn(async(_auth:string,_method:string,path:string)=>path.endsWith('/tasks')?{tasks:[{...task,status:'APPROVED',ownerDeclared:true,photoExceptionReason:'Camera broken',reviewComment:'PHOTO_EXCEPTION: Camera broken'}]}:path.endsWith('/task-people')?{employees:[]}:{templates:[]})} as unknown as MerchantApi
 render(<TaskBoard api={api} venueId="v" scope="owner" owner manage/>);
 await screen.findByText('Owner accepted photo exception');
 expect(screen.getByText('Photo exception reason: Camera broken')).toBeTruthy();
 expect(screen.queryByText(/PHOTO_EXCEPTION:/)).toBeNull();
})
it('does not present loading or failed task reads as a successful empty list', async () => {
    let finish!: (value: Response) => void;
    let first=true;
    vi.stubGlobal('fetch', vi.fn(() => {if(first){first=false;return new Promise<Response>(resolve => { finish = resolve; })}return Promise.resolve(new Response(JSON.stringify({tasks:[]})))}));
    render(<TaskBoard api={api} venueId="v" scope="staff" employeeId="worker"/>);
    expect(screen.queryByText('No staff tasks yet.')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading staff tasks…');
    await act(async () => finish(new Response(JSON.stringify({ error: { code: 'PAYMENTS_UNAVAILABLE' } }), { status: 503 })));
    const alert=await screen.findByRole('alert');
    expect(document.activeElement).toBe(alert);
    expect(screen.queryByText('No staff tasks yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Retry'}));
    expect(await screen.findByText('No staff tasks yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
});
