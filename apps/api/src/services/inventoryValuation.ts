import {and,eq,sql} from 'drizzle-orm';
import {MerchantVenueInput,type InventoryMovementValuation} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import type {UnitCost,InventoryCost} from './inventoryCost';

const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
function fraction(n:bigint,d:bigint){
 const divisor=gcd(n<0n?-n:n,d)||1n;
 return {numerator:(n/divisor).toString(),denominator:(d/divisor).toString()};
}
/** Called under the item's row lock, before its current weighted cost is changed. */
export async function movementValuation(db:Db,item:typeof s.merchantInventoryItem.$inferSelect,delta:number,supplied:UnitCost,kind:typeof s.merchantInventoryMovement.$inferSelect.kind,originalId:string|null=null):Promise<InventoryMovementValuation>{
 const [venue]=await db.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,item.venueId));
 if(originalId){
  const [original]=await db.select().from(s.merchantInventoryValuation).where(and(eq(s.merchantInventoryValuation.movementId,originalId),eq(s.merchantInventoryValuation.venueId,item.venueId)));
  if(original){const value=original.data;return {...value,method:'REVERSAL',totalCost:value.totalCost?{...value.totalCost,numerator:(-BigInt(value.totalCost.numerator)).toString()}:null};}
 }
 let unitCost:InventoryMovementValuation['unitCost']=null;
 if(supplied!==null)unitCost=typeof supplied==='number'?{numerator:String(supplied),denominator:'1'}:supplied;
 else if(delta<0&&!originalId&&kind!=='RECEIPT_CORRECTION'&&kind!=='PRODUCTION_REVERSAL'){
  const [row]=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,item.venueId),eq(s.merchantStockOperation.kind,'COST'),sql`${s.merchantStockOperation.data}->>'itemId'=${item.id}`));
  const current=row?.data as InventoryCost|undefined;
  if(current?.numerator!=null&&current.fiatCurrency===venue.currency)unitCost={numerator:current.numerator,denominator:current.denominator};
 }
 return {fiatCurrency:MerchantVenueInput.shape.fiatCurrency.parse(venue.currency),unit:item.unit,method:originalId?'REVERSAL':supplied!==null||delta>0||kind==='RECEIPT_CORRECTION'||kind==='PRODUCTION_REVERSAL'?'SUPPLIED_COST':'WEIGHTED_AVERAGE',unitCost,totalCost:unitCost?fraction(BigInt(unitCost.numerator)*BigInt(delta),BigInt(unitCost.denominator)):null};
}
export async function recordMovementValuation(db:Db,movement:typeof s.merchantInventoryMovement.$inferSelect,data:InventoryMovementValuation,orderId:string|null=null){
 await db.insert(s.merchantInventoryValuation).values({movementId:movement.id,venueId:movement.venueId,data,orderId});
}
