import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ProductionDraftPanel} from '../src/merchant/ProductionDraftPanel';
afterEach(cleanup);
it('keeps the selected revision after a conflict and cancels only after an explicit reason',async()=>{
 const draft={id:'draft',status:'DRAFT',revision:1,recipeName:'Coffee',recipeVersion:1,outputName:'Cups',batches:2,expectedYieldPerBatch:3,reason:'Original plan'};
 const calls:any[]=[],opened=vi.fn();let current=draft;
 const request=vi.fn(async(_a:string,m:string,p:string,b:any)=>{
  if(m==='GET')return {items:[current],hasMore:false};calls.push({m,p,b});
  if(m==='PATCH'){if(calls.length===1){current={...draft,revision:2};throw Object.assign(new Error('Conflict'),{status:409})}current={...current,...b,revision:3};return current;}
  current={...current,status:'CANCELLED',revision:current.revision+1};return current;
 });
 const props={api:{request} as never,venueId:'v',scope:'owner',auth:'owner' as const,disabled:false,input:{recipeVersionId:'r',outputItemId:'o',batches:4,expectedYieldPerBatch:3,reason:'Edited plan'},onOpen:opened};
 render(<ProductionDraftPanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Edit production draft'}));expect(opened).toHaveBeenCalledWith(draft);
 fireEvent.click(screen.getByRole('button',{name:'Save changes to production draft'}));await screen.findByRole('alert');
 expect(calls[0]).toMatchObject({m:'PATCH',p:'/venues/v/production/drafts/draft',b:{revision:1,batches:4,reason:'Edited plan'}});
 fireEvent.click(screen.getByRole('button',{name:'Refresh production drafts'}));await waitFor(()=>expect(request).toHaveBeenCalledTimes(3));
 expect(opened).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Use latest draft revision and keep form'}));
 fireEvent.click(screen.getByRole('button',{name:'Save changes to production draft'}));
 await waitFor(()=>expect(calls).toHaveLength(2));
 expect(calls[1]).toMatchObject({m:'PATCH',b:{revision:2,batches:4,reason:'Edited plan'}});
 expect(opened).toHaveBeenCalledTimes(1);
 await screen.findByRole('button',{name:'Save production draft'});
 fireEvent.click(screen.getByRole('button',{name:'Cancel production draft'}));
 fireEvent.change(screen.getByLabelText('Draft cancellation reason'),{target:{value:'No longer needed'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm draft cancellation'}));await screen.findByText(/Cancelled draft/);
 expect(calls[2]).toMatchObject({m:'POST',p:'/venues/v/production/drafts/draft/cancel',b:{revision:3,reason:'No longer needed'}});
 expect(screen.queryByRole('button',{name:'Open production draft'})).toBeNull();
});
