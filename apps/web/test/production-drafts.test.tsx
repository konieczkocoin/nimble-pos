import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ProductionDraftPanel} from '../src/merchant/ProductionDraftPanel';
afterEach(cleanup);
it('saves a planning form with an exact retry then reopens it without an actual yield',async()=>{
 const draft={id:'draft',venueId:'v',status:'DRAFT',revision:1,recipeVersionId:'recipe',recipeName:'Coffee',recipeVersion:1,outputItemId:'out',outputName:'Cups',batches:2,expectedYieldPerBatch:3,reason:'Morning plan',createdAt:'2026-10-18T00:00:00Z'};
 const writes:any[]=[],opened=vi.fn();let saved=false;
 const request=vi.fn(async(_a:string,m:string,_p:string,b:any)=>{
  if(m==='GET')return {items:saved?[draft]:[],hasMore:false};
  writes.push(b);if(writes.length===1)throw new Error('Lost response');saved=true;return draft;
 });
 render(<ProductionDraftPanel api={{request} as never} venueId="v" scope="owner" auth="owner" disabled={false} input={{recipeVersionId:'recipe',outputItemId:'out',batches:2,expectedYieldPerBatch:3,reason:'Morning plan'}} onOpen={opened}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Save production draft'}));
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry same draft operation'}));
 await screen.findByRole('button',{name:'Open production draft'});
 expect(writes[0]).toEqual(writes[1]);expect(writes[1]).not.toHaveProperty('actualYield');
 fireEvent.click(screen.getByRole('button',{name:'Open production draft'}));await waitFor(()=>expect(opened).toHaveBeenCalledWith(draft));
});
it('discards late draft lists from another scope and clears drafts on revoked access',async()=>{
 const draft={id:'alice',recipeName:'Private recipe',recipeVersion:1,outputName:'Cups',batches:1,expectedYieldPerBatch:2,reason:'Alice private plan'};
 let resolve!:(v:unknown)=>void;
 const request=vi.fn(()=>new Promise(r=>{resolve=r}));
 const props={api:{request} as never,venueId:'v',auth:'owner' as const,disabled:false,input:{recipeVersionId:'r',outputItemId:'o',batches:1,expectedYieldPerBatch:2,reason:'Plan'},onOpen:vi.fn()};
 const view=render(<ProductionDraftPanel {...props} scope="alice"/>);const old=resolve;
 view.rerender(<ProductionDraftPanel {...props} scope="bob"/>);
 resolve({items:[{...draft,id:'bob',recipeName:'Bob recipe',reason:'Bob plan'}],hasMore:false});old({items:[draft],hasMore:false});
 await screen.findByText(/Bob recipe/);expect(screen.queryByText(/Alice private plan/)).toBeNull();
 request.mockRejectedValueOnce(Object.assign(new Error('Forbidden'),{status:403}));
 fireEvent.click(screen.getByRole('button',{name:'Refresh production drafts'}));await screen.findByRole('alert');
 expect(screen.queryByText(/Bob recipe/)).toBeNull();
});
it('ignores an old save when the API instance changes within the same scope',async()=>{
 let finish!:(v:unknown)=>void;
 const old={request:vi.fn(async(_a:string,m:string)=>m==='GET'?{items:[],hasMore:false}:new Promise(r=>{finish=r}))};
 const props={venueId:'v',scope:'owner',auth:'owner' as const,disabled:false,input:{recipeVersionId:'r',outputItemId:'o',batches:1,expectedYieldPerBatch:2,reason:'Old plan'},onOpen:vi.fn()};
 const view=render(<ProductionDraftPanel {...props} api={old as never}/>);
 fireEvent.click(screen.getByRole('button',{name:'Save production draft'}));await waitFor(()=>expect(finish).toBeDefined());
 const next={request:vi.fn(async()=>({items:[],hasMore:false}))};
 view.rerender(<ProductionDraftPanel {...props} api={next as never}/>);
 finish({id:'old',recipeName:'Obsolete recipe',recipeVersion:1,outputName:'Old output',batches:1,expectedYieldPerBatch:2,reason:'Old plan'});
 await waitFor(()=>expect(next.request).toHaveBeenCalled());
 expect(screen.queryByText(/Obsolete recipe/)).toBeNull();expect((screen.getByRole('button',{name:'Save production draft'}) as HTMLButtonElement).disabled).toBe(false);
});
it('shows a loading state before a draft list resolves and keeps failed reads distinct from empty',async()=>{
 let finish!:(value:unknown)=>void;const request=vi.fn(()=>new Promise(resolve=>{finish=resolve}));
 render(<ProductionDraftPanel api={{request} as never} venueId="v" scope="owner" auth="owner" disabled={false} input={{recipeVersionId:'r',outputItemId:'o',batches:1,expectedYieldPerBatch:2,reason:'Plan'}} onOpen={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toBe('Loading production drafts…');
 finish({items:[],hasMore:false});
 await screen.findByText('No saved production drafts.');
 request.mockRejectedValueOnce(new Error('Connection lost'));
 fireEvent.click(screen.getByRole('button',{name:'Refresh production drafts'}));
 await screen.findByRole('alert');expect(screen.queryByText('No saved production drafts.')).toBeNull();
});
it('finishes list loading when a selected draft refresh overtakes the list request',async()=>{
 const draft={id:'d',status:'DRAFT',revision:1,recipeName:'Morning recipe',recipeVersion:1,outputName:'Cups',batches:1,expectedYieldPerBatch:2,reason:'Morning plan'};
 let finish!:(v:unknown)=>void,reads=0;
 const request=vi.fn(async(_a:string,_m:string,path:string)=>{if(path.endsWith('/d'))return draft;if(++reads===1)return {items:[draft],hasMore:false};return new Promise(resolve=>{finish=resolve})});
 render(<ProductionDraftPanel api={{request} as never} venueId="v" scope="owner" auth="owner" disabled={false} input={{recipeVersionId:'r',outputItemId:'o',batches:1,expectedYieldPerBatch:2,reason:'Morning plan'}} onOpen={vi.fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Edit production draft'}));
 fireEvent.click(screen.getByRole('button',{name:'Refresh production drafts'}));
 await screen.findByText('Loading production drafts…');
 fireEvent.click(screen.getByRole('button',{name:'Refresh selected draft'}));
 await waitFor(()=>expect(request.mock.calls.some(c=>c[2].endsWith('/d'))).toBe(true));
 finish({items:[draft],hasMore:false});
 await waitFor(()=>expect(screen.queryByText('Loading production drafts…')).toBeNull());
});
