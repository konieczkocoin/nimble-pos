import type {CashReportTotal,SalePaymentMethodTotal,OwnerCashPayoutTotal} from './finance';
export type DayCloseIssue = {key:string; kind:'TASK'|'ORDER'|'REFUND'|'STOCK'|'HANDOVER'; title:string; status:string};
export type DayCloseSnapshot = {capturedAt:string; ownerCashPayouts?:OwnerCashPayoutTotal[]; cash?:CashReportTotal[]; salesByPaymentMethod?:SalePaymentMethodTotal[]; issues:DayCloseIssue[]; sales:{currency:string;totalMinor:string;count:number}[]};
export type DayClosePreview = {date:string;timeZone:string;boundaryHour:number;fingerprint:string;snapshot:DayCloseSnapshot};
export type DayClose = DayClosePreview & {id:string;venueId:string;closedBy:string;note:string;carry:{key:string;reason:string}[];ownerExceptionReason:string|null};
