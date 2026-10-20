import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ProductionBoard} from '../src/merchant/ProductionBoard';
afterEach(cleanup);
it('requires a measured yield and retries execution against the saved draft revision',async()=>{
 const recipe={id:'recipe',recipeId:'family',version:1,name:'Coffee',requirements:[]};
 const draft={id:'draft',venueId:'v',status:'DRAFT',revision:1,recipeVersionId:'recipe',recipeName:'Coffee',recipeVersion:1,outputItemId:'out',outputName:'Cups',batches:3,expectedYieldPerBatch:4,reason:'Morning plan'};
 const batch={id:'batch',draftId:'draft',recipe,status:'PRODUCED',outputItemId:'out',expectedYield:12,actualYield:10,waste:2,requirements:[],reason:'Measured ten portions',createdAt:'2026-10-18T00:00:00Z'};
 const executed={...draft,status:'EXECUTED',revision:2,batchId:'batch'};
 const writes:any[]=[],changed=vi.fn();let completed=false;
 const request=vi.fn(async(_a:string,m:string,p:string,b:any)=>{
  if(m==='GET')return p.includes('/recipes')?{items:[recipe],hasMore:false}:p.includes('/drafts')?{items:[completed?executed:draft],hasMore:false}:{items:[],hasMore:false};
  writes.push({p,b});completed=true;if(writes.length===1)throw new Error('Lost response');return {draft:executed,batch};
 });
 render(<ProductionBoard api={{request} as never} venueId="v" scope="owner" owner items={[{id:'out',name:'Cups',unit:'PORTION'}] as any} onChanged={changed}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Execute production draft'}));
 expect((screen.getByLabelText('Actual finished quantity') as HTMLInputElement).value).toBe('');
 expect((screen.getByRole('button',{name:'Confirm draft execution'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Actual finished quantity'),{target:{value:'10'}});
 fireEvent.change(screen.getByLabelText('Production reason'),{target:{value:'Measured ten portions'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm draft execution'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry same production operation'}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 expect(writes[0]).toEqual(writes[1]);expect(writes[1]).toMatchObject({p:'/venues/v/production/drafts/draft/execute',b:{revision:1,actualYield:10,reason:'Measured ten portions'}});
 expect(writes[1].b).not.toHaveProperty('batches');await screen.findByText(/Executed draft/);
 expect(screen.queryByRole('button',{name:'Execute production draft'})).toBeNull();
});
it('recovers the linked batch from an executed draft without submitting production again',async()=>{
 const draft={id:'draft',status:'EXECUTED',revision:2,batchId:'saved-batch',recipeName:'Coffee',recipeVersion:1,outputName:'Cups',batches:3,expectedYieldPerBatch:4,reason:'Saved plan'};
 const batch={id:'saved-batch',draftId:'draft',recipe:{name:'Coffee',version:1},status:'PRODUCED',outputItemId:'out',expectedYield:12,actualYield:10,waste:2,requirements:[],reason:'Recovered measured batch',createdAt:'2026-10-18T00:00:00Z'};
 const request=vi.fn(async(_a:string,m:string,p:string)=>{
  expect(m).toBe('GET');if(p.endsWith('/saved-batch'))return batch;
  return p.includes('/drafts')?{items:[draft],hasMore:false}:{items:[],hasMore:false};
 });
 render(<ProductionBoard api={{request} as never} venueId="v" scope="owner" owner items={[{id:'out',name:'Cups',unit:'PORTION'}] as any} onChanged={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'View executed production batch'}));await screen.findByText(/Recovered measured batch/);
 expect(request.mock.calls.some(c=>c[2]==='/venues/v/production/saved-batch')).toBe(true);
 expect(screen.queryByRole('button',{name:'Execute production draft'})).toBeNull();
});
