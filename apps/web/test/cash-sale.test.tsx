import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CashPaymentPanel} from '../src/merchant/CashPaymentPanel';
afterEach(()=>{cleanup();localStorage.clear()});
const order={id:'order',venueId:'venue',revision:1,status:'AWAITING_PAYMENT',fiatCurrency:'EUR',totalMinor:1250,source:'COUNTER',quote:null,payment:null,checkoutToken:'checkout'} as any;
const receipt={id:'receipt',orderId:'order',currency:'EUR',dueMinor:1250,tenderedMinor:2000,changeMinor:750,recordedAt:'2026-10-18T00:00:00Z'};
it('shows exact change and retries the same cash recording after a lost response',async()=>{
 const calls:any[]=[],recorded=vi.fn();
 const request=vi.fn(async(_a:string,m:string,p:string,b:any,k:string)=>{
  if(m==='GET')throw Object.assign(new Error('Not found'),{status:404});
  calls.push({p,b,k});if(calls.length===1)throw new Error('Lost response');return {order:{...order,status:'PREPARING',paymentMethod:'CASH',cashReceipt:receipt},cashReceipt:receipt};
 });
 render(<CashPaymentPanel api={{request} as never} order={order} scope="session" cashierId="cashier" disabled={false} onRecorded={recorded}/>);
 fireEvent.change(screen.getByLabelText('Cash received'),{target:{value:'12,00'}});expect((screen.getByRole('button',{name:'Confirm cash received'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Cash received'),{target:{value:'20,00'}});expect(screen.getByText(/7.50/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Confirm cash received'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry the same cash recording'}));await waitFor(()=>expect(recorded).toHaveBeenCalledOnce());
 expect(calls[0]).toEqual(calls[1]);expect(calls[0].b).toEqual({revision:1,tenderedMinor:2000});expect(calls[0].k).toBeTruthy();await screen.findByText('Cash recorded');
});
it('restores a committed receipt after reload without recording cash again',async()=>{
 const recorded=vi.fn(),request=vi.fn(async(_a:string,m:string,p:string)=>{
  expect(m).toBe('GET');return p.endsWith('/cash/receipt')?receipt:{...order,paymentMethod:'CASH',status:'READY',cashReceipt:receipt};
 });
 localStorage.setItem('nimble:cash:venue:cashier:order',JSON.stringify({body:{revision:1,tenderedMinor:2000},key:'saved-key'}));
 render(<CashPaymentPanel api={{request} as never} order={order} scope="new-session" cashierId="cashier" disabled={false} onRecorded={recorded}/>);
 await screen.findByText('Cash recorded');expect(recorded).toHaveBeenCalledWith(expect.objectContaining({status:'READY'}));
 expect(localStorage.getItem('nimble:cash:venue:cashier:order')).toBeNull();
});

it('blocks a new cash recording when the stored intent is corrupt',async()=>{
 localStorage.setItem('nimble:cash:venue:cashier:order','broken');
 const request=vi.fn();
 render(<CashPaymentPanel api={{request} as never} order={order} scope="session" cashierId="cashier" disabled={false} onRecorded={vi.fn()}/>);
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Confirm cash received'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Retry the same cash recording'})).toBeNull();expect(request).not.toHaveBeenCalled();
});

it('clears received amount when an unsubmitted basket revision changes',()=>{
 const api={request:vi.fn()} as never,props={api,scope:'s',cashierId:'cashier',disabled:false,onRecorded:vi.fn()};
 const r=render(<CashPaymentPanel {...props} order={order}/>);
 fireEvent.change(screen.getByLabelText('Cash received'),{target:{value:'20'}});
 r.rerender(<CashPaymentPanel {...props} order={{...order,revision:2}}/>);
 expect((screen.getByLabelText('Cash received') as HTMLInputElement).value).toBe('');
});
it('recovers a stored receipt even without an open shift',async()=>{
 localStorage.setItem('nimble:cash:venue:cashier:order',JSON.stringify({body:{revision:1,tenderedMinor:2000},key:'saved-key'}));
 const request=vi.fn(async(_a:string,_m:string,p:string)=>p.endsWith('/receipt')?receipt:{...order,status:'READY',cashReceipt:receipt});
 render(<CashPaymentPanel api={{request} as never} order={order} scope="s" cashierId="cashier" disabled onRecorded={vi.fn()}/>);
 await screen.findByText('Cash recorded');expect(request).toHaveBeenCalledTimes(2);
});
it('removes cash confirmation when a same-revision poll reports wallet payment started',()=>{
 const props={api:{request:vi.fn()} as never,scope:'s',cashierId:'cashier',disabled:false,onRecorded:vi.fn()};
 const r=render(<CashPaymentPanel {...props} order={{...order,cashPaymentAvailable:true}}/>);
 expect(screen.getByRole('button',{name:'Confirm cash received'})).toBeTruthy();
 r.rerender(<CashPaymentPanel {...props} order={{...order,cashPaymentAvailable:false,quote:{id:'wallet-quote'}}}/>);
 expect(screen.queryByRole('button',{name:'Confirm cash received'})).toBeNull();
});
