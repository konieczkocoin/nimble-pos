import {and,eq,gte,lt,inArray,sql} from 'drizzle-orm';
import {aggregateMerchantStockRequirements,type ExactMinor,type EconomicsReport,type EconomicsProduct,type FinancialSaleSnapshot} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
const fraction=(n:bigint,d=1n):ExactMinor=>{const g=gcd(n<0n?-n:n,d)||1n;return {numerator:String(n/g),denominator:String(d/g)}};
const add=(a:ExactMinor,b:ExactMinor)=>fraction(BigInt(a.numerator)*BigInt(b.denominator)+BigInt(b.numerator)*BigInt(a.denominator),BigInt(a.denominator)*BigInt(b.denominator));
const negate=(a:ExactMinor)=>({...a,numerator:String(-BigInt(a.numerator))});
/** Stable acceptance facts plus verified refund events; never current catalogue prices or FX. */
export async function readEconomics(db:Db,venueId:string,from:string,until:string):Promise<EconomicsReport>{
 return db.transaction(async tx=>{
  const store=tx as unknown as Db,start=new Date(from),end=new Date(until),limit=10000;
  const sales=await store.select().from(s.merchantFinancialSale).where(and(eq(s.merchantFinancialSale.venueId,venueId),gte(s.merchantFinancialSale.occurredAt,start),lt(s.merchantFinancialSale.occurredAt,end))).limit(limit+1);
  const refunds=await store.select({transfer:s.merchantVerifiedTransaction,sale:s.merchantFinancialSale}).from(s.merchantVerifiedTransaction).innerJoin(s.merchantFinancialSale,eq(s.merchantFinancialSale.orderId,s.merchantVerifiedTransaction.orderId)).where(and(eq(s.merchantFinancialSale.venueId,venueId),eq(s.merchantVerifiedTransaction.purpose,'REFUND'),sql`(${s.merchantVerifiedTransaction.receipt}->>'confirmedAt')::timestamptz >= ${from}::timestamptz AND (${s.merchantVerifiedTransaction.receipt}->>'confirmedAt')::timestamptz < ${until}::timestamptz`)).limit(limit+1);
  const cashRefunds=await store.select({refund:s.merchantCashRefund,sale:s.merchantFinancialSale}).from(s.merchantCashRefund).innerJoin(s.merchantFinancialSale,eq(s.merchantFinancialSale.orderId,s.merchantCashRefund.orderId)).where(and(eq(s.merchantCashRefund.venueId,venueId),eq(s.merchantCashRefund.status,'CONFIRMED'),gte(s.merchantCashRefund.confirmedAt,start),lt(s.merchantCashRefund.confirmedAt,end))).limit(limit+1);
  const movements=await store.select({movement:s.merchantInventoryMovement,valuation:s.merchantInventoryValuation}).from(s.merchantInventoryMovement).leftJoin(s.merchantInventoryValuation,eq(s.merchantInventoryValuation.movementId,s.merchantInventoryMovement.id)).where(and(eq(s.merchantInventoryMovement.venueId,venueId),gte(s.merchantInventoryMovement.createdAt,start),lt(s.merchantInventoryMovement.createdAt,end))).limit(limit*5+1);
  const links=sales.length?await store.select({movement:s.merchantInventoryMovement,valuation:s.merchantInventoryValuation}).from(s.merchantInventoryValuation).innerJoin(s.merchantInventoryMovement,eq(s.merchantInventoryMovement.id,s.merchantInventoryValuation.movementId)).where(and(eq(s.merchantInventoryValuation.venueId,venueId),inArray(s.merchantInventoryValuation.orderId,sales.map(v=>v.orderId)))).limit(limit*5+1):[];
  if(sales.length>limit||refunds.length>limit||cashRefunds.length>limit||movements.length>limit*5||links.length>limit*5)fail(400,'ECONOMICS_REPORT_TOO_LARGE');
  const [undated]=await store.select({count:sql<number>`count(*)::int`}).from(s.merchantFinancialSale).where(and(eq(s.merchantFinancialSale.venueId,venueId),sql`${s.merchantFinancialSale.occurredAt} IS NULL`));
  const warnings=new Set<string>(),products=new Map<string,EconomicsProduct>();
  if(undated.count)warnings.add('UNDATED_SALES_NOT_ALLOCATED');
  function product(line:FinancialSaleSnapshot['lines'][number],currency:EconomicsProduct['currency']){
   const key=JSON.stringify([line.productId,line.category??null,currency]);let p=products.get(key);if(!p){p={productId:line.productId,name:line.productName,category:line.category??null,currency,quantity:0,revenue:fraction(0n),ingredientCost:fraction(0n),ingredientMargin:null,unknownCostSales:0};products.set(key,p)}return p;
  }
  function revenue(data:FinancialSaleSnapshot,sign:bigint){
   const list=BigInt(data.listMinor??'0'),total=BigInt(data.totalMinor);
   for(const line of data.lines){const p=product(line,data.fiatCurrency);if(list===0n){if(total!==0n)fail(409,'INVALID_SALE_SNAPSHOT')}else p.revenue=add(p.revenue,fraction(sign*total*BigInt(line.totalMinor),list));}
  }
  const linksByOrder=new Map<string,typeof links>();
  for(const row of links){const id=row.valuation.orderId!;const rows=linksByOrder.get(id)??[];rows.push(row);linksByOrder.set(id,rows)}
  for(const sale of sales){const data=sale.data;if(data.status!=='RECORDED'||data.listMinor===null){warnings.add('HISTORICAL_SALE_UNRESOLVED');continue}revenue(data,1n);
   const consumed=linksByOrder.get(sale.orderId)??[],requirements=aggregateMerchantStockRequirements(data.lines);
   for(const line of data.lines){const p=product(line,data.fiatCurrency);p.quantity+=line.quantity;let cost:ExactMinor|null=fraction(0n);const needs=aggregateMerchantStockRequirements([line]);
    // An unconfigured or untracked resource is not evidence of a zero ingredient cost.
    if(!needs.length)cost=null;
    for(const need of needs){const rows=consumed.filter(v=>v.movement.itemId===need.itemId),required=requirements.find(r=>r.itemId===need.itemId)!.quantity;let itemCost=fraction(0n);
     if(rows.reduce((n,r)=>n-r.movement.delta,0)!==required||!rows.length){cost=null;break}
     for(const row of rows){const value=row.valuation.data;if(!value.totalCost||value.fiatCurrency!==data.fiatCurrency){cost=null;break}itemCost=add(itemCost,negate(value.totalCost));}
     if(cost===null)break;cost=add(cost,fraction(BigInt(itemCost.numerator)*BigInt(need.quantity),BigInt(itemCost.denominator)*BigInt(required)));
    }
    if(cost===null){p.ingredientCost=null;p.unknownCostSales++;warnings.add('INGREDIENT_COST_UNKNOWN')}else if(p.ingredientCost)p.ingredientCost=add(p.ingredientCost,cost);
   }
  }
  for(const {transfer,sale} of refunds){const at=Date.parse(transfer.receipt.confirmedAt);if(at<Date.parse(from)||at>=Date.parse(until))continue;if(sale.data.status!=='RECORDED'||sale.data.listMinor===null){warnings.add('HISTORICAL_SALE_UNRESOLVED');continue}revenue(sale.data,-1n);}
  for(const {sale} of cashRefunds){if(sale.data.status!=='RECORDED'||sale.data.listMinor===null){warnings.add('HISTORICAL_SALE_UNRESOLVED');continue}revenue(sale.data,-1n);}
  const stockChanges=new Map<string,EconomicsReport['stockChanges'][number]>();
  for(const {movement:m,valuation:v} of movements){if(['OPENING','RECEIPT','PRODUCTION','PRODUCTION_REVERSAL'].includes(m.kind)||m.kind==='SALE'&&v?.orderId)continue;
   const kind=m.kind==='SALE'?'UNLINKED_SALE_OR_REWARD':m.kind;
   const currency=v?.data.fiatCurrency??null,key=kind+':'+currency;let group=stockChanges.get(key);if(!group){group={kind,currency,value:fraction(0n),unknownMovements:0};stockChanges.set(key,group)}
   if(!v?.data.totalCost){group.value=null;group.unknownMovements++;warnings.add('STOCK_CHANGE_VALUATION_UNKNOWN')}else if(group.value)group.value=add(group.value,v.data.totalCost);
  }
  for(const p of products.values())p.ingredientMargin=p.ingredientCost?add(p.revenue,negate(p.ingredientCost)):null;
  const groups=new Map<string,EconomicsReport['groups'][number]>();
  for(const p of products.values()){const key=JSON.stringify([p.category,p.currency]);let g=groups.get(key);if(!g){g={category:p.category,currency:p.currency,revenue:fraction(0n),ingredientCost:fraction(0n),ingredientMargin:null,unknownCostSales:0};groups.set(key,g)}g.revenue=add(g.revenue,p.revenue);g.unknownCostSales+=p.unknownCostSales;g.ingredientCost=g.ingredientCost&&p.ingredientCost?add(g.ingredientCost,p.ingredientCost):null;g.ingredientMargin=g.ingredientCost?add(g.revenue,negate(g.ingredientCost)):null;}
  return {from,until,generatedAt:new Date().toISOString(),warnings:[...warnings],groups:[...groups.values()],products:[...products.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.productId.localeCompare(b.productId)),stockChanges:[...stockChanges.values()]};
 },{isolationLevel:'repeatable read'});
}
