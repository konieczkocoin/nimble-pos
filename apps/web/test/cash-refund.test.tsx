import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CashRefundPanel} from '../src/merchant/CashRefundPanel';
afterEach(()=>{cleanup();localStorage.clear()});
const id='00000000-0000-4000-8000-000000000001';
const order={id:'order',venueId:'venue',status:'PREPARING',fiatCurrency:'EUR',cashReceipt:{id:'receipt',dueMinor:1250,currency:'EUR'}} as any;
const refund={id,orderId:'order',reason:'Customer request',status:'REQUESTED',amountMinor:1250,currency:'EUR',requestedAt:'2026-10-19T00:00:00Z',confirmedAt:null,payoutShiftId:null};
it('lets a cashier request but never confirm physical cash, preserving the exact request after timeout',async()=>{
 const writes:any[]=[];const request=vi.fn(async(_a:string,m:string,_p:string,body:any,key:string)=>{if(m==='GET')throw Object.assign(new Error('No refund'),{status:404});writes.push({body,key});if(writes.length===1)throw new Error('Lost response');return refund});
 render(<CashRefundPanel api={{request} as never} order={order} scope="cashier-token" actorId="cashier" authority="cashier" disabled={false} onChanged={vi.fn()}/>);
 await screen.findByLabelText('Cash refund reason');fireEvent.change(screen.getByLabelText('Cash refund reason'),{target:{value:'Customer request'}});fireEvent.click(screen.getByLabelText('I understand this request cannot be cancelled and stops pickup.'));
 fireEvent.click(screen.getByRole('button',{name:'Request full cash refund'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry the same refund recording'}));
 await screen.findByText('Cash refund requested — money has not been handed back.');expect(writes[0]).toEqual(writes[1]);expect(screen.queryByRole('button',{name:'Confirm cash physically handed back'})).toBeNull();
});
it('requires explicit physical handover, restores an uncertain result after reload and never sends a second confirmation',async()=>{
 let committed=false;const writes:any[]=[];const request=vi.fn(async(_a:string,m:string,_p:string,body:any,key:string)=>{if(m==='GET')return committed?{...refund,status:'CONFIRMED',confirmedAt:'2026-10-19T01:00:00Z'}:refund;writes.push({body,key});committed=true;throw new Error('Lost response')});
 const props={api:{request} as never,order,scope:'owner-token',actorId:'owner',authority:'owner' as const,disabled:false,onChanged:vi.fn()};
 const first=render(<CashRefundPanel {...props}/>);await screen.findByText('Cash refund requested — money has not been handed back.');expect((screen.getByRole('button',{name:'Confirm cash physically handed back'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('I have physically handed the full cash amount back to the customer.'));fireEvent.click(screen.getByRole('button',{name:'Confirm cash physically handed back'}));await screen.findByRole('alert');first.unmount();
 render(<CashRefundPanel {...props} scope="renewed-owner-token"/>);await screen.findByText('Cash refund confirmed');expect(writes).toHaveLength(1);expect(writes[0].body).toEqual({refundId:id,cashHandedBack:true});
});
it('ignores an old result after switching venue and account',async()=>{
 let finish!:(r:any)=>void;const request=vi.fn(()=>new Promise(r=>finish=r));const props={api:{request} as never,order,scope:'one',actorId:'one',authority:'owner' as const,disabled:false,onChanged:vi.fn()};
 const view=render(<CashRefundPanel {...props}/>);const old=finish;view.rerender(<CashRefundPanel {...props} order={{...order,id:'other',venueId:'other'}} scope="two" actorId="two"/>);await act(async()=>old({...refund,status:'CONFIRMED'}));expect(screen.queryByText('Cash refund confirmed')).toBeNull();
});
it('blocks new refund operations when the saved intent is corrupt',async()=>{
 localStorage.setItem('nimble:cash-refund:owner:owner:venue:order','broken');
 const request=vi.fn(async()=>refund);
 render(<CashRefundPanel api={{request} as never} order={order} scope="owner" actorId="owner" authority="owner" disabled={false} onChanged={vi.fn()}/>);
 await screen.findByText('Cash refund requested — money has not been handed back.');expect(screen.queryByRole('button',{name:'Confirm cash physically handed back'})).toBeNull();expect(screen.queryByRole('button',{name:'Request full cash refund'})).toBeNull();
});
