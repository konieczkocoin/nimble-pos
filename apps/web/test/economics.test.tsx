import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {EconomicsBoard,exactMinorText} from '../src/merchant/EconomicsBoard';
import type {EconomicsReport} from '@nimble/shared';
afterEach(cleanup);
const report:EconomicsReport={from:'2026-10-17T00:00:00Z',until:'2026-10-18T00:00:00Z',generatedAt:'2026-10-18T10:00:00Z',warnings:['INGREDIENT_COST_UNKNOWN'],products:[{productId:'cake',name:'Cake',category:'Food',currency:'EUR',quantity:1,revenue:{numerator:'900',denominator:'1'},ingredientCost:null,ingredientMargin:null,unknownCostSales:1}],groups:[{category:'Food',currency:'EUR',revenue:{numerator:'900',denominator:'1'},ingredientCost:null,ingredientMargin:null,unknownCostSales:1}],stockChanges:[]};
it('shows unknown margin, historical range and explanation without inventing a zero cost',async()=>{
 const request=vi.fn(async()=>report);render(<EconomicsBoard api={{request} as never} venueId="venue" scope="owner"/>);
 expect(request).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Generate ingredient margin'}));
 await screen.findByText('Cake · EUR');expect(screen.getByText(/2026-10-17T00:00:00Z/)).toBeTruthy();expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1);expect(screen.getByText(/This is not net profit/)).toBeTruthy();expect(screen.getAllByText('Calculation details')[0]).toBeTruthy();
 expect(exactMinorText({numerator:'-10',denominator:'3'},'EUR')).toBe('-0.03 EUR');
});
it('discards responses from a previous owner or venue',async()=>{
 let finish!:(r:EconomicsReport)=>void;const request=vi.fn(()=>new Promise<EconomicsReport>(resolve=>finish=resolve)),api={request} as never;
 const view=render(<EconomicsBoard api={api} venueId="old" scope="alice"/>);fireEvent.click(screen.getByRole('button',{name:'Generate ingredient margin'}));
 view.rerender(<EconomicsBoard api={api} venueId="new" scope="bob"/>);await act(async()=>finish(report));expect(screen.queryByText('Cake · EUR')).toBeNull();
});

it('keeps the last successful report offline but clears it when authentication is revoked',async()=>{
 let failure:unknown=null;const request=vi.fn(async()=>{if(failure)throw failure;return report});
 render(<EconomicsBoard api={{request} as never} venueId="venue" scope="owner"/>);
 fireEvent.click(screen.getByRole('button',{name:'Generate ingredient margin'}));await screen.findByText('Cake · EUR');
 failure=new Error('Offline');fireEvent.click(screen.getByRole('button',{name:'Generate ingredient margin'}));await screen.findByRole('alert');expect(screen.getByText('Cake · EUR')).toBeTruthy();
 failure={status:401,code:'AUTH_REQUIRED'};fireEvent.click(screen.getByRole('button',{name:'Generate ingredient margin'}));await waitFor(()=>expect(screen.queryByText('Cake · EUR')).toBeNull());
});
