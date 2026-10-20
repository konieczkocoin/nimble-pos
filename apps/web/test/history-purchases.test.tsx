import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import type {HistoryPurchaseReport} from '@nimble/shared';
import {HistoryPurchaseSuggestions} from '../src/merchant/HistoryPurchaseSuggestions';
afterEach(cleanup);
const report:HistoryPurchaseReport={from:'2026-10-01T00:00:00Z',until:'2026-10-08T00:00:00Z',generatedAt:'2026-10-18T10:00:00Z',windowDays:7,horizonDays:3,includeLosses:false,minimumActiveDays:3,minimumSamples:3,method:'Recorded usage',items:[{itemId:'milk',name:'Milk',unit:'MILLILITRE',sampleCount:3,activeDays:3,usageQuantity:'18',returnedProductionQuantity:'0',netUsageQuantity:'18',lossQuantity:'1',projectedUsageQuantity:'8',projectedLossQuantity:'0',physicalQuantity:5,reservedQuantity:3,pendingLossQuantity:1,availableQuantity:1,incomingQuantity:'4',bufferQuantity:5,targetQuantity:'13',recommendedQuantity:8,reason:null}]};
it('explains a displayed proposal and copies only into an editable draft without writing',async()=>{
 const request=vi.fn(async(..._args:unknown[])=>report),onUse=vi.fn();render(<HistoryPurchaseSuggestions api={{request} as never} venueId="venue" scope="owner" auth="owner" disabled={false} onUse={onUse}/>);
 expect(request).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Calculate history proposals'}));await screen.findByText('Proposed purchase: 8');expect(screen.getByText(/2026-10-01T00:00:00Z/)).toBeTruthy();expect(screen.getByText(/max\(0, 8 \+ 0 \+ 5 − 1 − 4\) = 8/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Copy displayed proposals to editable draft'}));expect(onUse).toHaveBeenCalledWith([{itemId:'milk',quantity:8}],expect.stringContaining('2026-10-01T00:00:00Z'));expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][1]).toBe('GET');
});
it('offers no draft from insufficient history and ignores a previous owner response',async()=>{
 let finish!:(r:HistoryPurchaseReport)=>void;const request=vi.fn(()=>new Promise<HistoryPurchaseReport>(resolve=>finish=resolve)),api={request} as never,props={api,venueId:'venue',auth:'owner' as const,disabled:false,onUse:vi.fn()};
 const view=render(<HistoryPurchaseSuggestions {...props} scope="alice"/>);fireEvent.click(screen.getByRole('button',{name:'Calculate history proposals'}));view.rerender(<HistoryPurchaseSuggestions {...props} scope="bob"/>);await act(async()=>finish(report));expect(screen.queryByText('Proposed purchase: 8')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Calculate history proposals'}));await act(async()=>finish({...report,items:[{...report.items[0],recommendedQuantity:null,reason:'INSUFFICIENT_HISTORY'}]}));expect(screen.getByText('Insufficient history for a recommendation')).toBeTruthy();expect(screen.getByRole('button',{name:'Copy displayed proposals to editable draft'}).hasAttribute('disabled')).toBe(true);
});
