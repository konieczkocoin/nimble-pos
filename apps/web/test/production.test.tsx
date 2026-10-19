import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ProductionBoard} from '../src/merchant/ProductionBoard';
afterEach(cleanup);
const recipe={id:'recipe',recipeId:'family',version:1,name:'Batch',requirements:[{itemId:'raw',quantity:18000}],ingredients:[],ancestorRecipeIds:[],costMethod:'WEIGHTED_AVERAGE',costMinor:null};
const items=[{id:'raw',name:'Beans',unit:'MILLIGRAM'},{id:'out',name:'Prepared cups',unit:'PORTION'}] as any;
it('freezes uncertain production and retries the exact payload before allowing another entry',async()=>{
 const writes:any[]=[],changed=vi.fn();
 const request=vi.fn(async(_auth:string,method:string,path:string,body:any)=>{
  if(method==='GET')return path.includes('/recipes')?{items:[recipe],hasMore:false}:{items:[],hasMore:false};
  writes.push(body);if(writes.length===1)throw new Error('Lost response');
  return {id:'batch',recipe,outputItemId:'out',expectedYield:3,actualYield:2,waste:1,status:'PRODUCED',reason:body.reason,createdAt:'2026-10-17T04:00:00Z',requirements:[{itemId:'raw',quantity:18000}]};
 });
 render(<ProductionBoard api={{request} as never} venueId="venue" scope="owner" owner items={items} onChanged={changed}/>);
 await screen.findByRole('option',{name:'Batch · v1'});
 fireEvent.change(screen.getByLabelText('Production recipe'),{target:{value:'recipe'}});fireEvent.change(screen.getByLabelText('Finished stock item'),{target:{value:'out'}});
 fireEvent.change(screen.getByLabelText('Expected yield per batch'),{target:{value:'3'}});fireEvent.change(screen.getByLabelText('Actual finished quantity'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Production reason'),{target:{value:'Morning preparation'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirm production'}));await screen.findByRole('alert');
 expect((screen.getByLabelText('Actual finished quantity').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry same production operation'}));
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(writes[0]).toEqual(writes[1]);expect(writes[1]).toMatchObject({actualYield:2,expectedYieldPerBatch:3});
});
it('clears production history when the employee scope changes',async()=>{
 const row={id:'batch',recipe,outputItemId:'out',expectedYield:1,actualYield:1,waste:0,status:'PRODUCED',reason:'Alice batch',createdAt:'2026-10-17T04:00:00Z',requirements:[]};
 let alice=true;const request=vi.fn(async(_a:string,_m:string,p:string)=>p.includes('/recipes')||p.includes('/drafts')?{items:[],hasMore:false}:{items:alice?[row]:[],hasMore:false});
 const props={api:{request} as never,venueId:'venue',items,onChanged:()=>{}};
 const view=render(<ProductionBoard {...props} scope="alice"/>);await screen.findByText(/Alice batch/);
 alice=false;view.rerender(<ProductionBoard {...props} scope="bob"/>);expect(screen.queryByText(/Alice batch/)).toBeNull();
});
