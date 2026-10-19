import {t} from '../i18n';
import type { MerchantAsset, MerchantFiat, MerchantOrder, MerchantReport } from './contract';
export const money = (minor: number, currency: MerchantFiat = 'EUR') => new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
export function cryptoAmount(atomic: string, asset: MerchantAsset): string {
  const decimals = asset === 'NIM' ? 5 : 6;
  const signed = BigInt(atomic), value=signed<0n?-signed:signed;
  const factor = 10n ** BigInt(decimals);
  const whole = (value / factor).toLocaleString('en');
  const fraction = (value % factor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${signed<0n?'-':''}${whole}${fraction ? `.${fraction}` : ''} ${asset}`;
}
export const orderStatus = (status: string) => ({ AWAITING_ACCEPTANCE: 'Waiting for the venue', AWAITING_PAYMENT: 'Awaiting payment', PAYMENT_PENDING: 'Verifying payment', PREPARING: 'Preparing', READY: 'Ready for pickup', COLLECTED: 'Collected', CANCELLED: 'Cancelled', REFUND_PENDING: 'Refund awaiting owner', REFUNDED: 'Refunded' }[status] ?? status);
export function demoReport(orders: MerchantOrder[], fiatCurrency: MerchantFiat): MerchantReport {
  const paid = orders.filter(x => x.payment);
  const refunded = paid.filter(x => x.status === 'REFUNDED');
  const grossMinor = paid.reduce((n, x) => n + x.totalMinor, 0);
  const refundedMinor = refunded.reduce((n, x) => n + x.totalMinor, 0);
  const assets = { NIM: '0', USDT: '0' };
  for (const order of paid.filter(x => x.status !== 'REFUNDED')) {
    const p = order.payment!;
    assets[p.asset] = String(BigInt(assets[p.asset]) + BigInt(p.amountAtomic));
  }
  return { orders, totals: { count: orders.length, paid: paid.length, refunded: refunded.length, grossMinor, refundedMinor, netMinor: grossMinor - refundedMinor, fiatCurrency, assets } };
}

/** All paid views must show the immutable basket the verified transfer bought. */
export function paidOrderSummary(order: MerchantOrder): MerchantOrder {
  return (order.payment || order.cashReceipt) && order.paidSnapshot ? { ...order, lines: order.paidSnapshot.lines, totalMinor: order.paidSnapshot.totalMinor } : order
}

export function minorText(value:string|null,currency:string){if(value===null)return t('Unknown');const n=BigInt(value),abs=n<0n?-n:n;return `${n<0n?'-':''}${(abs/100n).toLocaleString('en')}.${(abs%100n).toString().padStart(2,'0')} ${currency}`}
