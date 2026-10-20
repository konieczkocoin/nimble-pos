import {useEffect,useRef,useState} from 'react';
import {CashSaleInput,parseCashAmount,type CashReceipt,type CashSaleResult,type MerchantOrder} from '@nimble/shared';
import type {MerchantApi} from './client';
import {money} from './format';
import {merchantError} from './errors';
import {t} from '../i18n';
type Intent={body:{revision:number;tenderedMinor:number};key:string};
type Props={api:MerchantApi;order:MerchantOrder;scope:string;cashierId:string;disabled:boolean;onRecorded:(o:MerchantOrder)=>void;onBusy?:(busy:boolean)=>void};
export function CashPaymentPanel(p:Props){return <Session key={p.scope+':'+p.order.id+':'+p.cashierId} {...p}/>}
function Session({api,order,cashierId,disabled,onRecorded,onBusy}:Props){
 const [amount,setAmount]=useState(''),[receipt,setReceipt]=useState<CashReceipt|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[storageProblem,setStorageProblem]=useState(false);
 const live=useRef(true),epoch=useRef(0),lock=useRef(false),pending=useRef<Intent|null>(null);
 const path='/orders/'+order.id+'/cash',storageKey=`nimble:cash:${order.venueId}:${cashierId}:${order.id}`;
 useEffect(()=>{onBusy?.(busy||uncertain||storageProblem);return()=>onBusy?.(false)},[busy,uncertain,storageProblem,onBusy]);
 function forget(){try{localStorage.removeItem(storageKey)}catch{/* A known receipt must remain final even if local cleanup fails. */}pending.current=null;setUncertain(false);setStorageProblem(false)}
 function recorded(o:MerchantOrder){try{onRecorded(o)}catch{setError(t('Cash recorded. Refresh the order to see its current status.'))}}
 async function recover(){
  if(lock.current)return;const generation=epoch.current;lock.current=true;setBusy(true);setError('');
  try{
   const r=await api.request<CashReceipt>('cashier','GET',path+'/receipt');
   const current=await api.request<MerchantOrder>('public','GET','/checkout/'+order.checkoutToken);
   if(live.current&&epoch.current===generation){setReceipt(r);forget();recorded(current)}
  }catch(e){if(live.current&&epoch.current===generation){const status=(e as {status?:number}).status;if(status===401||status===403)setReceipt(null);setError(status===404?t('No cash receipt is recorded yet. Retry the same recording without taking cash again.'):merchantError(e))}}
  finally{if(epoch.current===generation){lock.current=false;if(live.current)setBusy(false)}}
 }
 useEffect(()=>{
  live.current=true;epoch.current++;lock.current=false;setReceipt(null);setAmount('');setError('');pending.current=null;setUncertain(false);setBusy(false);
  try{const raw=localStorage.getItem(storageKey);if(raw){const p=JSON.parse(raw) as Intent;if(CashSaleInput.safeParse(p.body).success&&typeof p.key==='string'&&p.key.length>0&&p.key.length<=128){pending.current=p;setUncertain(true)}else {setStorageProblem(true);setError(t('The saved cash recording is invalid. Check the receipt before accepting cash.'))}}}
  catch{setStorageProblem(true);setError(t('Cannot read the saved cash recording. Check the receipt before accepting cash.'))}
  if(pending.current||order.cashReceipt)void recover();
  return()=>{live.current=false;epoch.current++;lock.current=false};
 },[api,storageKey]);
 useEffect(()=>{if(!pending.current)setAmount('')},[order.revision]);
 async function confirm(retry=false){
  if(lock.current||(!retry&&disabled)||storageProblem)return;
  if(!retry){
   if(pending.current)return;const n=parseCashAmount(amount);if(n===null||n<order.totalMinor)return;
   const intent={body:{revision:order.revision,tenderedMinor:n},key:crypto.randomUUID()};
   try{localStorage.setItem(storageKey,JSON.stringify(intent))}catch{setError(t('Cannot save a cash recording intent on this device.'));return}
   pending.current=intent;
  }
  const intent=pending.current;if(!intent)return;
  const generation=epoch.current;lock.current=true;setBusy(true);setError('');
  try{const result=await api.request<CashSaleResult>('cashier','POST',path+'/confirm',intent.body,intent.key);
   if(live.current&&epoch.current===generation){setReceipt(result.cashReceipt);forget();recorded(result.order)}
  }catch(e){if(live.current&&epoch.current===generation){setError(merchantError(e));const status=(e as {status?:number}).status;if(status===undefined||status>=500||status===401||status===403)setUncertain(true);else forget();if(status===401||status===403)setReceipt(null)}}
  finally{if(epoch.current===generation){lock.current=false;if(live.current)setBusy(false)}}
 }
 const tendered=parseCashAmount(amount),available=order.cashPaymentAvailable!==false&&order.source==='COUNTER'&&order.status==='AWAITING_PAYMENT'&&!order.quote&&!order.pendingPaymentHash&&!order.payment;
 return <section className="m-panel"><h3>{t('Cash payment')}</h3><p>{t('Cash sales are anonymous and do not earn loyalty points.')}</p>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">{t('Checking cash recording…')}</p>}
 {receipt?<><h4>{t('Cash recorded')}</h4><p>{t('Amount due')}: {money(receipt.dueMinor,receipt.currency)} · {t('Cash received')}: {money(receipt.tenderedMinor,receipt.currency)} · {t('Change')}: {money(receipt.changeMinor,receipt.currency)}</p><p>{t('Receipt')}: {receipt.id}</p></>:storageProblem?<><p>{t('Check the receipt before accepting cash.')}</p><button disabled={busy} onClick={()=>void recover()}>{t('Check cash receipt')}</button></>:uncertain?<><p>{t('The recording result is uncertain. Do not take cash again.')}</p><button disabled={busy} onClick={()=>void recover()}>{t('Check cash receipt')}</button><button disabled={busy} onClick={()=>void confirm(true)}>{t('Retry the same cash recording')}</button></>:available?<form onSubmit={e=>{e.preventDefault();void confirm()}}><fieldset disabled={disabled||busy}><p>{t('Amount due')}: {money(order.totalMinor,order.fiatCurrency)}</p><label>{t('Cash received')}<input required inputMode="decimal" maxLength={32} value={amount} onChange={e=>setAmount(e.target.value)}/></label><p>{t('Change')}: {tendered!==null&&tendered>=order.totalMinor?money(tendered-order.totalMinor,order.fiatCurrency):'—'}</p><button disabled={tendered===null||tendered<order.totalMinor}>{t('Confirm cash received')}</button></fieldset></form>:order.cashReceipt?<button disabled={busy} onClick={()=>void recover()}>{t('Check cash receipt')}</button>:<p>{t('Cash is unavailable after wallet payment has started or this order has been closed.')}</p>}
 </section>;
}
