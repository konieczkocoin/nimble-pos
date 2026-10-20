import {useEffect,useRef,useState} from 'react';
import type {EconomicsReport,ExactMinor} from '@nimble/shared';
import type {MerchantApi} from './client';
import {minorText} from './format';
import {merchantError} from './errors';
import {t} from '../i18n';
export function exactMinorText(value:ExactMinor|null,currency:string){
 if(!value)return t('Unknown');
 const n=BigInt(value.numerator),d=BigInt(value.denominator),abs=n<0n?-n:n;
 return minorText(String((n<0n?-1n:1n)*((abs*2n+d)/(d*2n))),currency);
}
export function EconomicsBoard(props:{api:MerchantApi;venueId:string;scope:string}){return <Session key={props.scope+':'+props.venueId} {...props}/>}
function Session({api,venueId}:{api:MerchantApi;venueId:string;scope:string}){
 const day=new Date().toISOString().slice(0,10),[from,setFrom]=useState(day+'T00:00'),[until,setUntil]=useState(new Date(Date.parse(day)+86400000).toISOString().slice(0,16));
 const [data,setData]=useState<EconomicsReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const live=useRef(true),serial=useRef(0);useEffect(()=>{live.current=true;return()=>{live.current=false;serial.current++}},[]);
 async function load(){const id=++serial.current;setBusy(true);setError('');try{
  const query=new URLSearchParams({from:new Date(from+'Z').toISOString(),until:new Date(until+'Z').toISOString()}),result=await api.request<EconomicsReport>('owner','GET',`/venues/${venueId}/economics?${query}`);
  if(live.current&&serial.current===id)setData(result);
 }catch(e){if(live.current&&serial.current===id){setError(merchantError(e));if([401,403].includes((e as {status?:number}).status??0))setData(null)}}finally{if(live.current&&serial.current===id)setBusy(false)}}
 const exact=(v:ExactMinor|null)=>v?`${v.numerator}/${v.denominator}`:t('Unknown');
 const stockLabel:Record<string,string>={LOSS:'Recorded losses',STOCKTAKE:'Stocktake differences',ADJUSTMENT:'Stock adjustments',REVERSAL:'Reversed stock adjustments',RECEIPT_CORRECTION:'Delivery corrections',UNLINKED_SALE_OR_REWARD:'Unlinked sales or loyalty rewards'};
 const amount=(v:ExactMinor|null,currency:string)=><span title={v?`${v.numerator}/${v.denominator} minor units`:t('Unknown')}>{exactMinorText(v,currency)}</span>;
 return <section className="m-panel"><h2>{t('Ingredient margin')}</h2><p>{t('Sales after discounts and confirmed refunds, less ingredients consumed at acceptance. This is not net profit. Production transfers are excluded; refunds do not restore consumed stock. Displayed amounts are rounded; exact fractions are available on each amount.')}</p>
 <form onSubmit={e=>{e.preventDefault();void load()}}><fieldset disabled={busy}><legend>{t('Ingredient margin range')}</legend><label>{t('Margin from (UTC)')}<input type="datetime-local" required value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{t('Margin until exclusive (UTC)')}<input type="datetime-local" required value={until} onChange={e=>setUntil(e.target.value)}/></label><button>{t('Generate ingredient margin')}</button></fieldset></form>
 {busy&&<p role="status">{t('Loading ingredient margin…')}</p>}{error&&<p role="alert">{error} {data&&t('The last successful report remains displayed.')}</p>}
 {data&&<><p>{t('Displayed range')}: {data.from} → {data.until} · {t('Snapshot')}: {data.generatedAt}</p>{data.warnings.map(w=><p role="alert" key={w}>{t(w==='INGREDIENT_COST_UNKNOWN'?'Some ingredient costs are unknown. Their margins cannot be calculated.':w==='STOCK_CHANGE_VALUATION_UNKNOWN'?'Some stock changes have no reliable valuation.':'Historical sales need review before allocation.')}</p>)}
 {!data.products.length&&<p>{t('No allocated product sales or refunds in this range.')}</p>}
 {data.products.map(p=><article className="m-panel" key={JSON.stringify([p.productId,p.category,p.currency])}><h3>{p.name} · {p.currency}</h3><dl><dt>{t('Units sold in range')}</dt><dd>{p.quantity}</dd><dt>{t('Sales less confirmed sale refunds')}</dt><dd>{amount(p.revenue,p.currency)}</dd><dt>{t('Ingredients consumed at acceptance')}</dt><dd>{amount(p.ingredientCost,p.currency)}</dd><dt>{t('Ingredient margin')}</dt><dd>{amount(p.ingredientMargin,p.currency)}</dd></dl><details><summary>{t('Calculation details')}</summary><p>{t('Revenue less ingredient cost equals ingredient margin. Exact values in minor currency units:')}</p><p>{p.revenue.numerator}/{p.revenue.denominator} − {p.ingredientCost?`${p.ingredientCost.numerator}/${p.ingredientCost.denominator}`:t('Unknown')} = {p.ingredientMargin?`${p.ingredientMargin.numerator}/${p.ingredientMargin.denominator}`:t('Unknown')}</p></details>{p.unknownCostSales>0&&<p>{t('Sale lines with unknown ingredient cost')}: {p.unknownCostSales}</p>}</article>)}
 <h3>{t('Historical menu groups')}</h3>{data.groups.map(g=><article className="m-panel" key={JSON.stringify([g.category,g.currency])}><h4>{g.category??t('Unknown historical group')} · {g.currency}</h4><p>{t('Ingredient margin')}: {amount(g.ingredientMargin,g.currency)}</p><details><summary>{t('Calculation details')}</summary><p>{t('Revenue less ingredient cost equals ingredient margin. Exact values in minor currency units:')}</p><p>{exact(g.revenue)} − {exact(g.ingredientCost)} = {exact(g.ingredientMargin)}</p></details></article>)}
 <h3>{t('Separate signed stock changes')}</h3><p>{t('Losses, corrections and unlinked sales or loyalty rewards are shown separately. They are not charged to product margin again. Negative values mean stock value left the venue.')}</p>{!data.stockChanges.length&&<p>{t('No separately valued stock changes in this range.')}</p>}{data.stockChanges.map(v=><article key={v.kind+':'+v.currency}><p>{t(stockLabel[v.kind]??v.kind)}: {amount(v.value,v.currency??t('Unknown'))} · {t('Unknown movements')}: {v.unknownMovements}</p><details><summary>{t('Calculation details')}</summary><p>{t('Exact signed value in minor currency units')}: {exact(v.value)}</p></details></article>)}</>}
 </section>;
}
