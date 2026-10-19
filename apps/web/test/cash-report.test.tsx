import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FinanceBoard} from '../src/merchant/FinanceBoard';
import {DayCloseBoard} from '../src/merchant/DayCloseBoard';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
const cash=[{currency:'EUR',receivedMinor:'1250',confirmedRefundsMinor:'0',netMinor:'1250',refundLiabilityMinor:'0'}];
const methods=[{currency:'EUR',paymentMethod:'CASH',salesMinor:'1250',count:1},{currency:'EUR',paymentMethod:'CRYPTO',salesMinor:'750',count:1}];
const report={from:'2026-10-18T00:00:00Z',until:'2026-10-19T00:00:00Z',generatedAt:'2026-10-19T00:00:00Z',liabilitiesAsOf:'2026-10-19T00:00:00Z',reconciled:true,warnings:[],unverifiedOrders:0,cash,salesByPaymentMethod:methods,fiat:[{currency:'EUR',listMinor:'2000',discountMinor:'0',salesMinor:'2000',refundedSalesMinor:'0',netSalesMinor:'2000'}],assets:[],coverage:[],entries:[{scope:'RANGE',kind:'CASH_PAYMENT',at:'2026-10-18T12:00:00Z',orderId:'order',sourceId:'receipt',asset:null,network:null,fiatCurrency:'EUR',amountAtomic:null,amountMinor:'1250',listMinor:null,discountMinor:null,hash:null,label:'Physical cash',paymentMethod:'CASH',cashReceiptId:'receipt'}]};
it('shows cash separately from crypto sales and exports the displayed cash ledger',async()=>{
 const created=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:cash'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 render(<FinanceBoard api={{request:vi.fn(async()=>report)} as never} venueId="venue" scope="owner"/>);
 fireEvent.click(screen.getByRole('button',{name:'Generate reconciliation'}));
 const table=await screen.findByRole('table',{name:'Sales by payment method'});
 expect(within(table).getByText('12.50 EUR')).toBeTruthy();expect(within(table).getByText('7.50 EUR')).toBeTruthy();expect(within(table).getByText('CASH')).toBeTruthy();expect(within(table).getByText('CRYPTO')).toBeTruthy();
 expect(screen.getByText('Cash movements')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Export displayed reconciliation CSV'}));
 const text=await (created.mock.calls[0][0] as Blob).text();expect(text).toContain('"payment_method","cash_receipt_id"');expect(text).toContain('"CASH","receipt"');expect(text).toContain('"1250"');
 revoke.mockRestore();
});
it('shows payment method and cash totals before closing and in immutable history',async()=>{
 const preview={date:'2026-10-18',timeZone:'Europe/Warsaw',boundaryHour:4,fingerprint:'a'.repeat(64),snapshot:{capturedAt:'2026-10-19T00:00:00Z',issues:[],sales:[{currency:'EUR',totalMinor:'2000',count:2}],cash,salesByPaymentMethod:methods}};
 const saved={...preview,id:'close',venueId:'v',closedBy:'owner',note:'Closed cash',carry:[],ownerExceptionReason:null};
 const request=vi.fn(async(_a:string,_m:string,p:string)=>p.includes('preview')?preview:{items:[saved],hasMore:false});
 render(<DayCloseBoard api={{request} as never} venueId="v" scope="owner" owner/>);
 await screen.findByText('Closed cash · owner');expect(screen.getAllByRole('table',{name:'Sales by payment method'})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Review day closing'}));await screen.findByText('No unresolved matters at this cutoff.');expect(screen.getAllByRole('table',{name:'Sales by payment method'})).toHaveLength(2);
});
