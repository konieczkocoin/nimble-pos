import {PaymentMethodSummary} from './PaymentMethodSummary'
import type { MerchantReport as ReportData } from './contract'
import { money, cryptoAmount } from './format'
import { t } from '../i18n'

export function MerchantReport({ report, title }: { report: ReportData | null; title: string }) {
  if (!report) return <p className="m-muted">{t('Loading report…')}</p>
  const totals = report.totals
  const remote = (report.orders ?? []).filter(order => order.source === 'REMOTE').length
  const counter = (report.orders ?? []).length - remote
  return (
    <section className="m-panel">
      <span className="m-label">{title}</span>
      <h2>{money(totals.netMinor, totals.fiatCurrency)}</h2>
      <small>{t('Net accepted sales after refunds')}</small>
      <div className="m-metrics">
        <div><strong>{totals.paid}</strong><small>{t('Paid orders')}</small></div>
        <div><strong>{money(totals.grossMinor, totals.fiatCurrency)}</strong><small>{t('Accepted sales')}</small></div>
        <div><strong>{money(totals.refundedMinor, totals.fiatCurrency)}</strong><small>{t('Refunded')}</small></div>
        <div><strong>{money(totals.receivedMinor ?? totals.grossMinor, totals.fiatCurrency)}</strong><small>{t('Payments received')}</small></div>
        <div><strong>{money(totals.pendingAcceptanceMinor ?? 0, totals.fiatCurrency)}</strong><small>{t('Awaiting venue acceptance')}</small></div>
        <div><strong>{money(totals.refundPendingMinor ?? 0, totals.fiatCurrency)}</strong><small>{t('Awaiting refund')}</small></div>
      </div>
      <p className="m-muted">{t('Remote orders')}: {remote} · {t('Counter orders')}: {counter}</p>
      <PaymentMethodSummary cash={totals.cash} sales={totals.salesByPaymentMethod} ownerPayouts={totals.ownerCashPayouts}/>
      <div className="m-soft">
        <p>{cryptoAmount(totals.assets.NIM, 'NIM')}</p>
        <p>{cryptoAmount(totals.assets.USDT, 'USDT')}</p>
        <small>{t('Assets after refunds · no automatic conversion')}</small>
      </div>
    </section>
  )
}
