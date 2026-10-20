import {PaymentMethodSummary} from './PaymentMethodSummary';
import {minorText} from './format';
import {useEffect,useRef,useState} from 'react';
import {foodOperationalDate,type DayClose,type DayClosePreview} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {t} from '../i18n';
type Props={api:MerchantApi;venueId:string;scope:string;owner?:boolean};
export function DayCloseBoard(props:Props){return <DayCloseSession key={`${props.scope}:${props.venueId}:${props.owner}`} {...props}/>}
function DayCloseSession({api,venueId,owner=false}:Props){
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const [timeZone,setTimeZone]=useState(zone),[boundaryHour,setBoundaryHour]=useState('4'),[date,setDate]=useState(foodOperationalDate(new Date(),zone,4));
 const [preview,setPreview]=useState<DayClosePreview|null>(null),[history,setHistory]=useState<DayClose[]>([]),[more,setMore]=useState(false),[page,setPage]=useState(0);
 const [reasons,setReasons]=useState<Record<string,string>>({}),[note,setNote]=useState(''),[exception,setException]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const live=useRef(true),lock=useRef(false),serial=useRef(0),retry=useRef<{signature:string;key:string}|null>(null);
 const auth=owner?'owner':'cashier',base=`/venues/${venueId}/day-closes`;
 useEffect(()=>{live.current=true;void api.request<{items:DayClose[];hasMore:boolean}>(auth,'GET',base).then(r=>{if(live.current){setHistory(r.items);setMore(r.hasMore)}}).catch(e=>{if(live.current)setError(merchantError(e))});return()=>{live.current=false;serial.current++}},[api,auth,base]);
 const refresh=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);const request=++serial.current;
  try{const r=await api.request<DayClosePreview>(auth,'GET',base+'/preview?'+new URLSearchParams({timeZone,boundaryHour,date}));if(live.current&&serial.current===request){setPreview(r);setReasons({});}}
  catch(e){if(live.current){setPreview(null);setError(merchantError(e))}}finally{lock.current=false;if(live.current)setBusy(false)}
 };
 const close=async()=>{
  if(lock.current||!preview)return;
  const payload={timeZone:preview.timeZone,boundaryHour:preview.boundaryHour,date:preview.date,expectedFingerprint:preview.fingerprint,note:note.trim(),carry:preview.snapshot.issues.filter(i=>reasons[i.key]?.trim()).map(i=>({key:i.key,reason:reasons[i.key].trim()})),...(owner&&exception.trim()?{ownerExceptionReason:exception.trim()}:{})};
  const signature=JSON.stringify(payload);if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError(null);
  try{const result=await api.request<DayClose>(auth,'POST',base,{...payload,idempotencyKey:retry.current.key});if(live.current){setHistory(old=>[result,...old.filter(r=>r.id!==result.id)]);setPreview(null);setNote('');setReasons({});setException('');retry.current=null;}}
  catch(e){if(live.current)setError(merchantError(e))}finally{lock.current=false;if(live.current)setBusy(false)}
 };
 const change=(update:()=>void)=>{serial.current++;setPreview(null);update()};
 const valid=preview&&note.trim().length>=3&&(owner&&exception.trim().length>=3||preview.snapshot.issues.every(i=>reasons[i.key]?.trim().length>=3));
 return <section className="m-panel m-form"><h2>{t('Day closing')}</h2><p>{t('Closing the operational day records a cutoff. It does not end shifts, work time or sessions. Late payments and refunds remain available.')}</p>
 {error&&<p role="alert">{error}</p>}
 <fieldset disabled={busy}><label>{t('Operational timezone')}<input value={timeZone} onChange={e=>change(()=>setTimeZone(e.target.value))}/></label><label>{t('Operational day starts at hour')}<input type="number" min="0" max="23" value={boundaryHour} onChange={e=>change(()=>setBoundaryHour(e.target.value))}/></label><label>{t('Operational date')}<input type="date" value={date} onChange={e=>change(()=>setDate(e.target.value))}/></label><button onClick={()=>void refresh()}>{t('Review day closing')}</button></fieldset>
 {preview&&<><h3>{t('Sales at this cutoff')}</h3>{preview.snapshot.sales.map(s=><p key={s.currency}>{minorText(s.totalMinor,s.currency)} · {s.count}</p>)}<PaymentMethodSummary cash={preview.snapshot.cash} sales={preview.snapshot.salesByPaymentMethod} ownerPayouts={preview.snapshot.ownerCashPayouts}/></>}
 {preview&&<fieldset disabled={busy}><legend>{t('Unresolved matters')}</legend>{preview.snapshot.issues.length===0&&<p>{t('No unresolved matters at this cutoff.')}</p>}{preview.snapshot.issues.map(i=><label key={i.key}>{i.title} · {i.status}<input aria-label={`${t('Carry-forward reason')} ${i.key}`} value={reasons[i.key]??''} maxLength={2000} onChange={e=>setReasons(old=>({...old,[i.key]:e.target.value}))}/></label>)}<label>{t('Day closing note')}<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label>{owner&&<label>{t('Owner closing exception (optional)')}<textarea value={exception} maxLength={2000} onChange={e=>setException(e.target.value)}/></label>}<button disabled={!valid} onClick={()=>void close()}>{t('Close operational day')}</button></fieldset>}
 <h3>{t('Closed days')}</h3>{history.map(r=><article className="m-panel" key={r.id}><h4>{r.date} · {r.timeZone} · {r.boundaryHour}:00</h4><p>{r.note} · {r.closedBy}</p><p>{t('Cutoff')}: {new Date(r.snapshot.capturedAt).toLocaleString()}</p>{r.snapshot.sales.map(s=><p key={s.currency}>{s.currency} {(BigInt(s.totalMinor)/100n).toString()}.{(BigInt(s.totalMinor)%100n).toString().padStart(2,'0')} · {s.count}</p>)}<PaymentMethodSummary cash={r.snapshot.cash} sales={r.snapshot.salesByPaymentMethod} ownerPayouts={r.snapshot.ownerCashPayouts}/>{r.ownerExceptionReason&&<p>{t('Owner closing exception (optional)')}: {r.ownerExceptionReason}</p>}{r.snapshot.issues.map(i=><p key={i.key}>{i.title} · {i.status}: {r.carry.find(c=>c.key===i.key)?.reason??r.ownerExceptionReason}</p>)}</article>)}
 {more&&<button disabled={busy} onClick={()=>{if(lock.current)return;lock.current=true;setBusy(true);void api.request<{items:DayClose[];hasMore:boolean}>(auth,'GET',base+`?page=${page+1}`).then(r=>{if(live.current){setHistory(old=>[...old,...r.items.filter(r=>!old.some(o=>o.id===r.id))]);setMore(r.hasMore);setPage(page+1)}}).catch(e=>{if(live.current)setError(merchantError(e))}).finally(()=>{lock.current=false;if(live.current)setBusy(false)})}}>{t('Load more')}</button>}
 </section>;
}
