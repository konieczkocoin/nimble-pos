import type {MerchantFiat} from './merchant';
export type ExactMinor={numerator:string;denominator:string};
export type EconomicsProduct={productId:string;name:string;category:string|null;currency:MerchantFiat;quantity:number;revenue:ExactMinor;ingredientCost:ExactMinor|null;ingredientMargin:ExactMinor|null;unknownCostSales:number};
export type EconomicsReport={from:string;until:string;generatedAt:string;warnings:string[];products:EconomicsProduct[];groups:{category:string|null;currency:MerchantFiat;revenue:ExactMinor;ingredientCost:ExactMinor|null;ingredientMargin:ExactMinor|null;unknownCostSales:number}[];stockChanges:{kind:string;currency:MerchantFiat|null;value:ExactMinor|null;unknownMovements:number}[]};
