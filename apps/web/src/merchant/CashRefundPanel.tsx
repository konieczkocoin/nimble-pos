import {useEffect,useRef,useState} from 'react';
import {CashRefundConfirmInput,CashRefundRequestInput,type CashRefund,type MerchantOrder} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {minorText} from './format';
import {t} from '../i18n';
type Intent={operation:'request'|'confirm';body:{reason:string}|{refundId:string;cashHandedBack:true};key:string};
type Props={api:MerchantApi;order:MerchantOrder;scope:string;actorId:string;authority:'owner'|'cashier';disabled:boolean;onChanged:()=>void};
function validIntent(value:unknown):value is Intent{const p=value as Intent|null;return !!p&&typeof p.key==='string'&&p.key.length>0&&p.key.length<=128&&(p.operation==='request'?CashRefundRequestInput.safeParse(p.body).success:p.operation==='confirm'&&CashRefundConfirmInput.safeParse(p.body).success)}
export function CashRefundPanel(p:Props){return <Session key={`${p.scope}:${p.actorId}:${p.authority}:${p.order.venueId}:${p.order.id}`} {...p}/>}
function Session({api,order,actorId,authority,disabled,onChanged}:Props){
 const [refund,setRefund]=useState<CashRefund|null>(null),[reason,setReason]=useState(''),[acknowledged,setAcknowledged]=useState(false),[handedBack,setHandedBack]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[uncertain,setUncertain]=useState(false),[storageProblem,setStorageProblem]=useState(false);
 const live=useRef(true),epoch=useRef(0),locked=useRef(false),pending=useRef<Intent|null>(null);
 const base='/orders/'+order.id+'/cash/refund',storageKey=`nimble:cash-refund:${authority}:${actorId}:${order.venueId}:${order.id}`;
 function clearIntent(){pending.current=null;setUncertain(false);setStorageProblem(false);try{localStorage.removeItem(storageKey)}catch{/* A confirmed server result remains final even if cleanup fails. */}}
 function changed(){try{onChanged()}catch{/* Report refresh cannot reverse a recorded result. */}}
 async function recover(){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');const generation=epoch.current;
  try{const r=await api.request<CashRefund>(authority,'GET',base);if(!live.current||epoch.current!==generation)return;setRefund(r);setLoaded(true);setHandedBack(false);
   if(pending.current&&(pending.current.operation==='request'||r.status==='CONFIRMED')){clearIntent();changed()}
   else if(storageProblem&&r.status==='CONFIRMED')clearIntent();
  }catch(e){if(live.current&&epoch.current===generation){if((e as {status?:number}).status===404){setRefund(null);setLoaded(true);if(pending.current||storageProblem)setError(t('No refund is recorded yet. Retry only the saved recording.'))}else{setLoaded(false);setRefund(null);setError(merchantError(e))}}}
  finally{if(epoch.current===generation){locked.current=false;if(live.current)setBusy(false)}}
 }
 useEffect(()=>{
  live.current=true;epoch.current++;locked.current=false;
  try{const raw=localStorage.getItem(storageKey);if(raw){const value=JSON.parse(raw);if(validIntent(value)){pending.current=value;setUncertain(true)}else{setStorageProblem(true);setError(t('The saved refund recording is invalid. Check its status before continuing.'))}}}
  catch{setStorageProblem(true);setError(t('Cannot read the saved refund recording. Check its status before continuing.'))}
  void recover();return()=>{live.current=false;epoch.current++;locked.current=false};
 },[api,storageKey]);
 useEffect(()=>{if(order.cashRefund?.status&&loaded&&order.cashRefund.status!==refund?.status&&!locked.current)void recover()},[order.cashRefund?.status]);
 async function submit(operation:Intent['operation'],retry=false){
  if(locked.current||storageProblem||!loaded||(!retry&&disabled)||operation==='confirm'&&authority!=='owner')return;
  if(!retry){if(pending.current)return;
   if(operation==='request'&&(!acknowledged||!CashRefundRequestInput.safeParse({reason:reason.trim()}).success))return;
   if(operation==='confirm'&&(!handedBack||refund?.status!=='REQUESTED'))return;
   const intent:Intent={operation,body:operation==='request'?{reason:reason.trim()}:{refundId:refund!.id,cashHandedBack:true},key:crypto.randomUUID()};
   try{localStorage.setItem(storageKey,JSON.stringify(intent))}catch{setError(t('Cannot save this refund recording on the device.'));return}
   pending.current=intent;
  }
  const intent=pending.current;if(!intent)return;
  locked.current=true;setBusy(true);setError('');const generation=epoch.current;
  try{const r=await api.request<CashRefund>(authority,'POST',base+'/'+intent.operation,intent.body,intent.key);if(live.current&&epoch.current===generation){setRefund(r);setLoaded(true);setHandedBack(false);clearIntent();changed()}}
  catch(e){if(live.current&&epoch.current===generation){setUncertain(true);setHandedBack(false);setError(merchantError(e));if([401,403].includes((e as {status?:number}).status??0)){setRefund(null);setLoaded(false)}}}
  finally{if(epoch.current===generation){locked.current=false;if(live.current)setBusy(false)}}
 }
 return <section className="m-panel"><h3>{t('Cash refund')}</h3><p>{t('Order')} #{order.number??order.id} · {minorText(String(order.cashReceipt?.dueMinor??order.totalMinor),order.fiatCurrency)}</p>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">{t('Checking cash refund…')}</p>}
 {refund&&<><p>{t(refund.status==='CONFIRMED'?'Cash refund confirmed':'Cash refund requested — money has not been handed back.')}</p><p>{refund.reason}</p><p>{t('Cash refund ID')}: {refund.id} · {t('Requested')}: {refund.requestedAt}{refund.confirmedAt&&<> · {t('Confirmed')}: {refund.confirmedAt}</>}</p></>}
 {(uncertain||storageProblem)&&!refund?.confirmedAt?<><p>{t('The refund recording result is uncertain. Do not hand cash back again.')}</p><button disabled={busy} onClick={()=>void recover()}>{t('Check cash refund status')}</button>{pending.current&&<button disabled={busy||!loaded} onClick={()=>void submit(pending.current!.operation,true)}>{t('Retry the same refund recording')}</button>}</>:
 loaded&&!busy&&!storageProblem&&!uncertain&&refund?.status==='REQUESTED'&&authority==='owner'?<><label><input type="checkbox" checked={handedBack} disabled={disabled} onChange={e=>setHandedBack(e.target.checked)}/>{t('I have physically handed the full cash amount back to the customer.')}</label><button disabled={disabled||!handedBack} onClick={()=>void submit('confirm')}>{t('Confirm cash physically handed back')}</button></>:
 loaded&&!busy&&!storageProblem&&!uncertain&&!refund&&['PREPARING','READY','COLLECTED'].includes(order.status)?<form onSubmit={e=>{e.preventDefault();void submit('request')}}><fieldset disabled={disabled}><label>{t('Cash refund reason')}<textarea value={reason} maxLength={500} required onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>{t('I understand this request cannot be cancelled and stops pickup.')}</label><p>{t('Only the owner can confirm the physical cash handover. Stock is not returned automatically.')}</p><button disabled={!acknowledged||!reason.trim()}>{t('Request full cash refund')}</button></fieldset></form>:null}
 {!busy&&<button onClick={()=>void recover()}>{t('Refresh cash refund status')}</button>}
 </section>;
}
export function CashRefundControl(p:Props){const [open,setOpen]=useState(false);return <div><button onClick={()=>setOpen(v=>!v)}>{t('Cash refund details')}</button>{open&&<CashRefundPanel {...p}/>}</div>}
export function CashRefundBoard({api,orders,scope,actorId,onChanged}:{api:MerchantApi;orders:MerchantOrder[];scope:string;actorId:string;onChanged:()=>void}){
 const [chosen,setChosen]=useState('');const cash=orders.filter(o=>o.cashReceipt),selected=cash.find(o=>o.id===chosen)??cash.find(o=>o.cashRefund?.status==='REQUESTED')??cash[0];
 return <section className="m-panel"><h2>{t('Owner cash refunds')}</h2><p>{t('Record physical cash handovers here. They do not use the owner wallet or a cashier payout shift.')}</p>{cash.length?<><label>{t('Cash order for refund')}<select value={selected?.id??''} onChange={e=>setChosen(e.target.value)}>{cash.map(o=><option key={o.id} value={o.id}>#{o.number} · {o.cashRefund?.status??o.status}</option>)}</select></label>{selected&&<CashRefundPanel api={api} order={selected} scope={scope} actorId={actorId} authority="owner" disabled={false} onChanged={onChanged}/>}</>:<p>{t('No recorded cash orders.')}</p>}</section>;
}
