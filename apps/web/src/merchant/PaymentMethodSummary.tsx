import type {CashReportTotal,SalePaymentMethodTotal,OwnerCashPayoutTotal} from '@nimble/shared';
import {minorText} from './format';
import {t} from '../i18n';
/** Stored older cutoffs have no method breakdown; never reconstruct their frozen history. */
export function PaymentMethodSummary({cash,sales,ownerPayouts}:{cash?:CashReportTotal[];sales?:SalePaymentMethodTotal[];ownerPayouts?:OwnerCashPayoutTotal[]}){
 if(cash===undefined||sales===undefined)return <p>{t('Payment method breakdown is unavailable for this older snapshot.')}</p>;
 return <>
 <h3>{t('Sales by payment method')}</h3>
 {!sales.length?<p>{t('No recognized sales by payment method in this range.')}</p>:<table aria-label={t('Sales by payment method')}><thead><tr><th>{t('Payment method')}</th><th>{t('Currency')}</th><th>{t('Recognized sales')}</th><th>{t('Sales count')}</th></tr></thead><tbody>{sales.map(s=><tr key={s.currency+':'+s.paymentMethod}><td>{s.paymentMethod??t('Unknown')}</td><td>{s.currency}</td><td>{minorText(s.salesMinor,s.currency)}</td><td>{s.count}</td></tr>)}</tbody></table>}
 <h3>{t('Cash movements')}</h3><p>{t('Cash figures exclude change given to the customer. They are recorded movements, not the balance counted in the till.')}</p>
 {!cash.length&&<p>{t('No cash receipts in this range.')}</p>}
 {cash.map(c=><article className="m-panel" key={c.currency}><h4>{c.currency} · {t('Cash')}</h4><dl><dt>{t('Cash received after change')}</dt><dd>{minorText(c.receivedMinor,c.currency)}</dd><dt>{t('Confirmed cash refunds')}</dt><dd>{minorText(c.confirmedRefundsMinor,c.currency)}</dd><dt>{t('Cash receipts less confirmed refunds')}</dt><dd>{minorText(c.netMinor,c.currency)}</dd><dt>{t('Current cash refund liabilities')}</dt><dd>{minorText(c.refundLiabilityMinor,c.currency)}</dd></dl></article>)}
 {ownerPayouts!==undefined&&<><h3>{t('Owner cash payouts without a shift')}</h3>{ownerPayouts.length?ownerPayouts.map(p=><p key={p.currency}>{minorText(p.amountMinor,p.currency)}</p>):<p>{t('No owner cash payouts in this range.')}</p>}</>}
 </>;
}
