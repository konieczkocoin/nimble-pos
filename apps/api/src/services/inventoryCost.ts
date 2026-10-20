import {and,eq,sql} from 'drizzle-orm';
import type {Db} from '../db/client';
import * as s from '../db/schema';
export type UnitCost=number|{numerator:string;denominator:string}|null;
export type InventoryCost={itemId:string;fiatCurrency?:string;numerator:string|null;denominator:string};
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
const reduced=(n:bigint,d:bigint)=>{const g=gcd(n,d)||1n;return {numerator:(n/g).toString(),denominator:(d/g).toString()}};
/** Caller holds the inventory item row lock; cost and physical movement commit together. */
export async function updateInventoryCost(db:Db,item:typeof s.merchantInventoryItem.$inferSelect,delta:number,unitCostMinor:UnitCost=null,receiptCorrection=false){
 if(!delta)return;
 const [row]=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,item.venueId),eq(s.merchantStockOperation.kind,'COST'),sql`${s.merchantStockOperation.data}->>'itemId'=${item.id}`));
 const [venue]=await db.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,item.venueId));
 const stored=row?.data as InventoryCost|undefined;
 // Legacy averages without a proven currency cannot price new historical evidence.
 const previous=stored?.fiatCurrency===venue.currency?stored:undefined,remaining=item.quantity+delta;
 const incoming=unitCostMinor===null?null:typeof unitCostMinor==='number'?{n:BigInt(unitCostMinor),d:1n}:{n:BigInt(unitCostMinor.numerator),d:BigInt(unitCostMinor.denominator)};
 let average:Omit<InventoryCost,'itemId'>={numerator:null,denominator:'1'};
 if(remaining>0){
  if(delta>0&&unitCostMinor!==null){
   if(item.quantity===0)average=reduced(incoming!.n,incoming!.d);
   else if(previous?.numerator!==null&&previous?.numerator!==undefined)average=reduced(BigInt(previous.numerator)*BigInt(item.quantity)*incoming!.d+incoming!.n*BigInt(delta)*BigInt(previous.denominator),BigInt(previous.denominator)*BigInt(remaining)*incoming!.d);
  }else if(delta<0&&previous?.numerator!==null&&previous?.numerator!==undefined){
   if(receiptCorrection){
    if(unitCostMinor!==null){const total=BigInt(previous.numerator)*BigInt(item.quantity)*incoming!.d+incoming!.n*BigInt(delta)*BigInt(previous.denominator);if(total>=0n)average=reduced(total,BigInt(previous.denominator)*BigInt(remaining)*incoming!.d)}
   }else average={numerator:previous.numerator,denominator:previous.denominator};
  }
 }
 const data:InventoryCost={itemId:item.id,fiatCurrency:venue.currency,...average};
 if(row)await db.update(s.merchantStockOperation).set({data}).where(eq(s.merchantStockOperation.id,row.id));
 else await db.insert(s.merchantStockOperation).values({venueId:item.venueId,kind:'COST',data});
}
export async function inventoryCosts(db:Db,venueId:string){
 const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'COST')));
 const [venue]=await db.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId));
 return new Map(rows.map(r=>{const c=r.data as InventoryCost;return [c.itemId,c.fiatCurrency===venue.currency?c:{itemId:c.itemId,numerator:null,denominator:'1'}]}));
}
export function calculateRecipeCost(costs:Map<string,InventoryCost>,requirements:{itemId:string;quantity:number}[]){
 const unitCosts:InventoryCost[]=[];
 let n=0n,d=1n;
 for(const b of requirements){
  const c=costs.get(b.itemId);
  if(!c||c.numerator===null)return {costMinor:null,unitCosts:[],exactCost:null};
  unitCosts.push(c);const cn=BigInt(c.numerator),cd=BigInt(c.denominator);
  n=n*cd+cn*BigInt(b.quantity)*d;d*=cd;const g=gcd(n,d)||1n;n/=g;d/=g;
 }
 return {costMinor:((n*2n+d)/(2n*d)).toString(),unitCosts,exactCost:{numerator:n.toString(),denominator:d.toString()}};
}

export async function recipeCostSnapshot(db:Db,venueId:string,requirements:{itemId:string;quantity:number}[]){
 return calculateRecipeCost(await inventoryCosts(db,venueId),requirements);
}
