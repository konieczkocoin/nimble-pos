import {useEffect,useRef,useState} from 'react';
import type {ProductionDraft} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {t} from '../i18n';
type PlanningInput=Pick<ProductionDraft,'recipeVersionId'|'outputItemId'|'batches'|'expectedYieldPerBatch'|'reason'|'source'>;
type DraftMutation={method:'POST'|'PATCH';path:string;body:object};
type Props={api:MerchantApi;venueId:string;scope:string;auth:'owner'|'cashier';disabled:boolean;input:PlanningInput;onOpen:(d:ProductionDraft)=>void;onChanged?:()=>void;onExecute?:(d:ProductionDraft)=>void;onViewBatch?:(id:string)=>void};
export function ProductionDraftPanel(props:Props){return <Session key={props.scope+':'+props.venueId+':'+props.auth} {...props}/>}
function Session({api,venueId,auth,disabled,input,onOpen,onChanged,onExecute,onViewBatch}:Props){
 const [rows,setRows]=useState<ProductionDraft[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[more,setMore]=useState(false),[page,setPage]=useState(0),[editing,setEditing]=useState<ProductionDraft|null>(null),[cancelling,setCancelling]=useState<ProductionDraft|null>(null),[cancelReason,setCancelReason]=useState('');
 const [loading,setLoading]=useState(true);
 const live=useRef(true),loadingRequest=useRef(0),serial=useRef(0),lock=useRef(false),generation=useRef(0),pending=useRef<DraftMutation|null>(null);
 const base=`/venues/${venueId}/production/drafts`;
 function report(e:unknown){setError(merchantError(e));if([401,403].includes((e as {status?:number}).status??0)){setRows([]);setMore(false);setEditing(null);setCancelling(null)}}
 async function load(next=0){const n=++serial.current;setError('');loadingRequest.current=n;setLoading(true);try{const r=await api.request<{items:ProductionDraft[];hasMore:boolean}>(auth,'GET',base+`?page=${next}`);if(live.current&&serial.current===n){setRows(old=>next?[...old,...r.items.filter(i=>!old.some(o=>o.id===i.id))]:r.items);setMore(r.hasMore);setPage(next)}}catch(e){if(live.current&&serial.current===n)report(e)}finally{if(live.current&&loadingRequest.current===n)setLoading(false)}}
 async function refreshSelected(){
  if(!editing)return;const n=++serial.current;setError('');
  try{const d=await api.request<ProductionDraft>(auth,'GET',base+'/'+editing.id);if(live.current&&serial.current===n)setRows(old=>[d,...old.filter(r=>r.id!==d.id)])}
  catch(e){if(live.current&&serial.current===n)report(e)}
 }
 useEffect(()=>{live.current=true;generation.current++;pending.current=null;lock.current=false;setUncertain(false);setBusy(false);setRows([]);setMore(false);setEditing(null);setCancelling(null);void load();return()=>{live.current=false;generation.current++;serial.current++}},[api,auth,base]);
 async function mutate(action?:{method:'POST'|'PATCH';path:string;body:object}){
  if(lock.current||disabled)return;
  if(action){if(pending.current)return;pending.current={...action,body:{...action.body,idempotencyKey:crypto.randomUUID()}}}
  const saved=pending.current;if(!saved)return;
  const currentGeneration=generation.current;lock.current=true;setBusy(true);setError('');serial.current++;
  try{const d=await api.request<ProductionDraft>(auth,saved.method,saved.path,saved.body);if(live.current&&generation.current===currentGeneration){pending.current=null;setUncertain(false);setRows(old=>[d,...old.filter(i=>i.id!==d.id)]);setEditing(null);setCancelling(null);setCancelReason('');onChanged?.()}}
  catch(e){if(live.current&&generation.current===currentGeneration){report(e);const status=(e as {status?:number}).status;if(status===undefined||status>=500)setUncertain(true);else{pending.current=null;setUncertain(false)}}}
  finally{if(generation.current===currentGeneration){lock.current=false;if(live.current)setBusy(false)}}
 }
 const latestEditing=editing?rows.find(r=>r.id===editing.id):undefined;
 const stale=!!editing&&!!latestEditing&&latestEditing.revision!==editing.revision;
 const noLongerEditable=!!latestEditing&&latestEditing.status!=='DRAFT';
 const valid=!!input.recipeVersionId&&!!input.outputItemId&&Number.isInteger(input.batches)&&input.batches>=1&&input.batches<=1000&&Number.isInteger(input.expectedYieldPerBatch)&&input.expectedYieldPerBatch>=1&&input.batches*input.expectedYieldPerBatch<=2147483647&&input.reason.trim().length>=3&&input.reason.trim().length<=500;
 return <section className="m-panel"><h3>{t('Saved production drafts')}</h3><p>{t('A draft saves planning assumptions only. It does not reserve ingredients or record production.')}</p>
 {editing?<><p>{t('Editing draft revision')}: {editing.revision}. {t('Changed assumptions need a new availability check. Refreshing the list keeps your form unchanged.')}</p>{stale&&latestEditing&&<><p>{t('Latest draft revision')}: {latestEditing.revision} · {latestEditing.batches} × {latestEditing.expectedYieldPerBatch} · {latestEditing.reason}</p>{noLongerEditable?<p role="status">{t('This draft has been cancelled or completed and cannot be edited.')}</p>:<button disabled={disabled||busy||uncertain} onClick={()=>setEditing(latestEditing)}>{t('Use latest draft revision and keep form')}</button>}</>}<button disabled={disabled||busy||uncertain||!valid||stale||noLongerEditable} onClick={()=>void mutate({method:'PATCH',path:base+'/'+editing.id,body:{...input,revision:editing.revision}})}>{t('Save changes to production draft')}</button><button disabled={disabled||busy||uncertain} onClick={()=>setEditing(null)}>{t('Stop editing draft')}</button><button disabled={disabled||busy||uncertain} onClick={()=>void refreshSelected()}>{t('Refresh selected draft')}</button></>:<button disabled={disabled||busy||uncertain||!valid} onClick={()=>void mutate({method:'POST',path:base,body:input})}>{t('Save production draft')}</button>}
 {uncertain&&<button disabled={disabled||busy} onClick={()=>void mutate()}>{t('Retry same draft operation')}</button>}
 <button disabled={disabled||busy||uncertain} onClick={()=>void load()}>{t('Refresh production drafts')}</button>
 {loading&&<p role="status">{t('Loading production drafts…')}</p>}{!loading&&!error&&!rows.length&&<p>{t('No saved production drafts.')}</p>}
 {busy&&<p role="status">{t('Saving production draft…')}</p>}{error&&<p role="alert">{error}</p>}
 {rows.map(d=><article key={d.id}><h4>{d.recipeName} · v{d.recipeVersion} → {d.outputName}</h4><p>{d.batches} × {d.expectedYieldPerBatch} = {d.batches*d.expectedYieldPerBatch} · {d.reason} · {d.createdAt}</p>{d.source&&<p>{d.source.from} → {d.source.until} · {t('Projection days')}: {d.source.horizonDays} · {t(d.source.includeLosses?'Loss projection included':'Loss projection excluded')}</p>}{d.status==='EXECUTED'?<p>{t('Executed draft')}: {d.batchId} · {d.executedAt} {d.batchId&&onViewBatch&&<button disabled={disabled||busy||uncertain} onClick={()=>onViewBatch(d.batchId!)}>{t('View executed production batch')}</button>}</p>:d.status==='CANCELLED'?<p>{t('Cancelled draft')}: {d.cancellationReason} · {d.cancelledAt}</p>:<><button disabled={disabled||busy||uncertain} onClick={()=>{setEditing(null);onOpen(d)}}>{t('Open production draft')}</button><button disabled={disabled||busy||uncertain} onClick={()=>{setEditing(d);setCancelling(null);onOpen(d)}}>{t('Edit production draft')}</button><button disabled={disabled||busy||uncertain} onClick={()=>{setCancelling(d);setCancelReason('')}}>{t('Cancel production draft')}</button>{onExecute&&<button disabled={disabled||busy||uncertain} onClick={()=>{setEditing(null);setCancelling(null);onExecute(d)}}>{t('Execute production draft')}</button>}</>}</article>)}
 {cancelling&&<form onSubmit={e=>{e.preventDefault();void mutate({method:'POST',path:base+'/'+cancelling.id+'/cancel',body:{revision:cancelling.revision,reason:cancelReason.trim()}})}}><fieldset disabled={disabled||busy||uncertain}><legend>{t('Cancel production draft')}</legend><label>{t('Draft cancellation reason')}<input required minLength={3} maxLength={500} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label><button disabled={cancelReason.trim().length<3}>{t('Confirm draft cancellation')}</button><button type="button" onClick={()=>setCancelling(null)}>{t('Keep draft')}</button></fieldset></form>}
 {more&&<button disabled={disabled||busy||uncertain} onClick={()=>void load(page+1)}>{t('Load more production drafts')}</button>}
 </section>;
}
