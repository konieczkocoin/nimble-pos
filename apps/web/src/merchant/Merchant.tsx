import {CashRefundBoard,CashRefundControl} from './CashRefundPanel'
import {CashPaymentPanel} from './CashPaymentPanel'
import {EconomicsBoard} from './EconomicsBoard'
import {FinanceBoard} from './FinanceBoard'
import { DayCloseBoard } from './DayCloseBoard'
import { WorkTimeBoard } from './WorkTimeBoard'
import {DiscountPanel} from './DiscountPanel'
import {ShiftHandover} from './ShiftHandover'
import { PublicProductImage } from './ProductImage'
import { ProductInformation } from './ProductInformation'
import {OrderReadiness} from './OrderReadiness'
import {OrderContextPanel,useOrderContextQueue} from './OrderContext'
import {VenueOperations} from './VenueOperations'
import {PaymentExceptions} from './PaymentExceptions'
import { StockReservationStatus } from './StockReservationStatus'
import { ProductChoices, validProductChoices, OrderComposition } from './ProductChoices'
import { MenuWorkspaceBoard } from './MenuWorkspaceBoard'
import { ProductForm } from './ProductForm'
import {InventoryBoard} from './InventoryBoard'
import {TaskBoard} from './TaskBoard'
import { ScheduleBoard } from './ScheduleBoard'
import { EmployeeAccess, AuditTrail, hasPermission, type AccessEmployee } from './Access'
import { MerchantReport as Report } from './Report'
import { RemoteOwner, RemoteQueue, useRemotePresence } from '../remote/Remote'
import { LoyaltyApi, linkLoyaltyEvm } from '../loyalty/api'
import { LoyaltyOwner, LoyaltyQueue, useCheckoutLoyalty } from '../loyalty/Loyalty'
import { t } from '../i18n'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { toCanvas } from 'qrcode'
import { useApp } from '../AppContext'
import { uuid } from '../lib/uuid'
import { copyText } from '../lib/copy'
import {
  MerchantApi,
  type DisplayRates,
  type ProductInput,
  type VenueInput,
} from './client'
import { DemoCafe } from './demo'
import { cryptoAmount, demoReport, money, orderStatus, paidOrderSummary } from './format'
import type {
  MerchantAsset,
  MerchantCartLine,
  MerchantEmployee,
  MerchantFiat,
  MerchantOrder,
  MerchantProduct,
  MerchantReport,
  MerchantShift,
  MerchantVenue,
} from './contract'
import {
  getMerchantSender,
  getMerchantNimAddress,
  sendMerchantPayment,
} from '../wallet/merchantPayments'
import { merchantError, networkName } from './errors'
import {
  readSigningIntent,
  readSubmitted,
  restoreSubmittedHash,
  submitOnce,
} from './recovery'
import './merchant.css'
const example = new DemoCafe()
example.signIn('anna', '1234')
example.openShift()
const number = (order: MerchantOrder) => String(order.number).padStart(3, '0')
const emptyVenue: VenueInput = {
  name: '',
  fiatCurrency: 'EUR',
  nimAddress: '',
  usdtAddress: null,
}
type CashierSession = {
  token: string
  employee: MerchantEmployee
  venue: MerchantVenue
}
function stored<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as T
  } catch {
    return null
  }
}
function useMerchantApi() {
  const app = useApp()
  const prefix = `nimble:merchant:${app.api.baseUrl}:`
  const api = useMemo(
    () =>
      new MerchantApi(
        app.api.baseUrl,
        () => app.token,
        () => stored<CashierSession>(`${prefix}cashier`)?.token ?? null,
        () => localStorage.getItem(`${prefix}terminal`),
      ),
    [app.api.baseUrl, app.token, prefix],
  )
  return { app, api, prefix }
}
function Frame({
  demo = false,
  children,
  actions,
}: {
  demo?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <main className="merchant">
      <header className="m-header">
        <Link to="/" className="m-brand">
          nimble
          <span>·</span>
        </Link>
        <div className="m-header-right">
          {demo ? (
            <span className="m-demo">{t("DEMO · no real funds")}</span>
          ) : (
            <span className="m-label">{t("COUNTER")}</span>
          )}
          <Link to="/venues">{t('Order ahead')}</Link><Link to="/orders">{t('My orders')}</Link><Link to="/merchant/cards">{t('My loyalty cards')}</Link>
          {actions}
        </div>
      </header>
      {children}
      <footer className="m-footer">
        <span>{t("Made for good moments.")}</span>
        <Link to="/">{t("Pay by code ↗")}</Link>
      </footer>
    </main>
  )
}
function Notice({ text }: { text: string | null }) {
  return text ? (
    <p className="m-notice" role="status">
      {text}
    </p>
  ) : null
}
function RecoverTransaction({
  busy,
  onRestore,
}: {
  busy: boolean
  onRestore: (hash: string) => void
}) {
  const [hash, setHash] = useState('')
  return (
    <form
      className="m-soft m-form"
      onSubmit={(event) => {
        event.preventDefault()
        onRestore(hash)
      }}
    >
      <strong>Recover your wallet approval.</strong>
      <p>
        Your previous approval may still be open or may have sent a transfer.
        Check your wallet before continuing. We will not request another
        signature.
      </p>
      <label>
        Transaction hash from your wallet
        <input
          required
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the full transaction hash"
        />
      </label>
      <button className="m-primary" disabled={busy}>
        Verify original transfer →
      </button>
      <small>
        If your wallet shows no result yet, keep waiting or ask for help at the
        counter.
      </small>
    </form>
  )
}

function QR({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current)
      void toCanvas(ref.current, url, {
        width: 208,
        margin: 1,
        color: { dark: '#173f32', light: '#ffffff' },
      }).catch(() => {})
  }, [url])
  return (
    <canvas className="m-qr" ref={ref} aria-label="Scan to open this order" />
  )
}
function Lines({ order }: { order: MerchantOrder }) {
  return (
    <div className="m-lines">
      {order.lines.map((line, i) => (
        <div className="m-line" key={i}>
          <div>
            <strong>
              {line.quantity} × {line.productName}
            </strong>
            <small>
              {[line.variantName, ...line.extras.map((e) => e.name)].join(
                ' · ',
              )}
            </small>
            <OrderComposition line={line}/>
          </div>
          <span>{money(line.totalMinor, order.fiatCurrency)}</span>
        </div>
      ))}
    </div>
  )
}
export function MerchantWelcome() {
  return (
    <Frame>
      <section className="m-hero">
        <span className="m-label">A LITTLE COUNTER. A BIG POSSIBILITY.</span>
        <h1>
          Good coffee.
          <br />
          Simple payments.
        </h1>
        <p>
          Your menu, your team, your everyday rhythm.
          <br />
          NIM and USDT, straight to your wallet.
        </p>
        <Link className="m-primary" to="/merchant/demo">
          Try Maison Café
          <span>↗</span>
        </Link>
        <small>A complete example café. No wallet or real money.</small>
        <Link to="/merchant/scan">Have an order? Scan your cashier’s QR →</Link>
      </section>
      <div className="m-entry-grid">
        <Link className="m-panel m-entry" to="/merchant/owner">
          <span>01 · OWNER</span>
          <h2>Make it yours.</h2>
          <p>Create your venue, menu and team.</p>
          <b>Set up a venue →</b>
        </Link>
        <Link className="m-panel m-entry" to="/merchant/terminal">
          <span>02 · SHARED PHONE</span>
          <h2>Ready for service.</h2>
          <p>Pair a terminal. Cashiers sign in with a PIN.</p>
          <b>Open terminal →</b>
        </Link>
      </div>
    </Frame>
  )
}
export function MerchantDemo() {
  const [role, setRole] = useState<'cashier' | 'owner' | 'customer'>('cashier')
  const [version, bump] = useState(0)
  const [current, setCurrent] = useState<string | null>(null)
  const refresh = () => bump((v) => v + 1)
  return (
    <Frame demo actions={<Link to="/merchant">Live setup ↗</Link>}>
      <div className="m-demo-strip">
        <span>
          Example rates. Payments, pairing and readiness signals are simulated.
        </span>
      </div>
      <nav className="m-tabs" aria-label="Demo perspective">
        {(['cashier', 'customer', 'owner'] as const).map((r) => (
          <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>
            {r === 'cashier'
              ? 'Cashier'
              : r === 'customer'
                ? 'Customer'
                : 'Owner'}
          </button>
        ))}
      </nav>
      <Link className="m-soft" to="/merchant/loyalty/demo">{t('Try the loyalty journey')} →</Link>
      {role === 'owner' ? (
        <Owner demo={example} version={version} refreshDemo={refresh} />
      ) : role === 'cashier' ? (
        <Terminal
          demo={example}
          version={version}
          refreshDemo={refresh}
          onCustomer={(id) => {
            setCurrent(id)
            setRole('customer')
          }}
        />
      ) : current ? (
        <Customer
          demo={example}
          orderId={current}
          version={version}
          refreshDemo={refresh}
        />
      ) : (
        <section className="m-panel">
          <h1>Your order starts at the counter.</h1>
          <p>
            Create a basket in the Cashier view, then open customer checkout.
          </p>
          <button className="m-primary" onClick={() => setRole('cashier')}>
            Visit the counter →
          </button>
        </section>
      )}
    </Frame>
  )
}
export function MerchantOwner() {
  return (
    <Frame actions={<Link to="/merchant/terminal">Shared terminal →</Link>}>
      <Owner />
    </Frame>
  )
}
export function MerchantTerminal() {
  return (
    <Frame actions={<Link to="/merchant">About Counter ↗</Link>}>
      <Terminal />
    </Frame>
  )
}
function Owner({
  demo,
  version = 0,
  refreshDemo = () => {},
}: {
  demo?: DemoCafe
  version?: number
  refreshDemo?: () => void
}) {
  const { app, api, prefix } = useMerchantApi()
  const [venues, setVenues] = useState<MerchantVenue[]>(
    demo ? [demo.venue] : [],
  )
  const [venue, setVenue] = useState<MerchantVenue | null>(demo?.venue ?? null)
  const [tab, setTab] = useState('Overview')
  const [products, setProducts] = useState<MerchantProduct[]>(
    demo?.products ?? [],
  )
  const [employees, setEmployees] = useState<MerchantEmployee[]>(
    demo?.employees ?? [],
  )
  const [orders, setOrders] = useState<MerchantOrder[]>(demo?.orders ?? [])
  const [report, setReport] = useState<MerchantReport | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pairToken, setPairToken] = useState<string | null>(null)
  const [editor, setEditor] = useState<MerchantProduct | 'new' | null>(null)
  const ownerScope = `${app.token}:${venue?.id ?? ''}`
  const ownerContext = useOrderContextQueue(api, venue?.id ?? '', ownerScope, orders.slice(0,20), true, !demo && !!app.token)
  const ownerScopeRef = useRef(ownerScope)
  ownerScopeRef.current = ownerScope
  const load = useCallback(async () => {
    const scope = ownerScope
    if (ownerScopeRef.current !== scope) return
    if (demo) {
      setVenue({ ...demo.venue })
      setProducts([...demo.products])
      setEmployees([...demo.employees])
      setOrders([...demo.orders])
      setReport(demoReport(demo.orders, demo.venue.fiatCurrency))
      return
    }
    if (!app.token) return
    const list = await api.venues()
    if(ownerScopeRef.current !== scope) return
    setVenues(list)
    const v = list.find((item) => item.id === venue?.id) ?? list[0]
    if (!v) return
    setVenue(v)
    const [p, e, o, r] = await Promise.all([
      api.catalog(v.id, true),
      api.employees(v.id),
      api.orders(v.id, true),
      api.report(v.id),
    ])
    if(ownerScopeRef.current !== scope) return
    setProducts(p)
    setEmployees(e)
    setOrders(o)
    setReport(r)
  }, [api, app.token, demo, venue?.id, ownerScope])
  useEffect(() => {
    void load().catch((e) => setNotice(merchantError(e)))
  }, [load, version])
  useEffect(() => {
    if (demo || !venue) return
    const timer = setInterval(
      () => void load().catch((e) => setNotice(merchantError(e))),
      5000,
    )
    return () => clearInterval(timer)
  }, [demo, venue?.id, load])
  const run = async (
    action: () => Promise<unknown> | unknown,
    success?: string,
  ) => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      refreshDemo()
      await load()
      if (success) setNotice(success)
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  const submitRefund = async (order: MerchantOrder) => {
    if (demo) return demo.approveRefund(order.id, 'owner')
    const refundKey = `${prefix}refund:${order.id}`
    const saved = readSubmitted(refundKey)
    if (saved) return api.refundPayment(order.id, saved.hash, saved.quoteId)
    if (order.refund?.pendingHash)
      return api.refundPayment(
        order.id,
        order.refund.pendingHash,
        order.refund.quote?.id,
      )
    if (readSigningIntent(refundKey)) throw new Error('SIGNING_UNCERTAIN')
    const currentQuote = order.refund?.quote
    const refreshQuote =
      !currentQuote ||
      !Number.isFinite(Date.parse(currentQuote.expiresAt)) ||
      Date.parse(currentQuote.expiresAt) <= Date.now()
    const approved =
      order.refund?.status === 'APPROVED' && !refreshQuote
        ? order
        : await api.approveRefund(order.id)
    const refundQuote = approved.refund?.quote
    if (!refundQuote) throw new Error('Refund quote unavailable.')
    return submitOnce(
      refundKey,
      { revision: order.revision, quoteId: refundQuote.id },
      () => sendMerchantPayment(refundQuote),
      (saved) => api.refundPayment(order.id, saved.hash, saved.quoteId),
    )
  }
  if (!demo && !app.token)
    return (
      <section className="m-hero">
        <span className="m-label">YOUR VENUE. YOUR WALLET.</span>
        <h1>
          A place of
          <br />
          your own.
        </h1>
        <p>
          Connect on your personal phone to manage your café.
          <br />
          Your shared terminal uses separate cashier credentials.
        </p>
        <button
          className="m-primary"
          disabled={busy}
          onClick={() => void run(() => app.login())}
        >
          Connect owner wallet →
        </button>
        <Notice text={notice} />
      </section>
    )
  return (
    <>
      <div className="m-heading">
        <div>
          <span className="m-label">{t('Owner workspace')}</span>
          <h1>{venue?.name ?? 'Create your venue.'}</h1>
        </div>
        {venues.length > 1 && (
          <select
            aria-label={t('Venue')}
            value={venue?.id ?? ''}
            onChange={(e) =>
              setVenue(venues.find((v) => v.id === e.target.value) ?? null)
            }
          >
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <nav className="m-tabs" aria-label={t('Owner sections')}>
        {['Overview', 'Payments', 'Financial reconciliation', 'Menu', 'Team', 'Schedule', 'Decision history', 'Day closing', 'Handover', 'Work time', 'Staff tasks', 'Inventory', 'Loyalty', 'Remote orders', 'Terminal', 'Venue'].map((label) => (
          <button key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>
            {t(label)}
          </button>
        ))}
      </nav>
      <Notice text={notice} />
      {!venue || tab === 'Venue' ? (
        <VenueForm
          venue={venue}
          busy={busy}
          onSave={(input) =>
            run(async () => {
              if (demo) {
                demo.updateVenue(input.name, input.fiatCurrency)
                Object.assign(demo.venue, input)
              } else {
                const v = await api.saveVenue(input, venue?.id)
                setVenue(v)
              }
            }, 'Venue saved.')
          }
        />
      ) : tab === 'Overview' ? (
        <>
          {demo ? <Report report={report} title="ALL VENUE SALES" /> : <VenueOperations api={api} venueId={venue.id} scope={ownerScope} onAction={section => {
            if (section === 'Refund approvals') document.getElementById('owner-refund-approvals')?.scrollIntoView({behavior:'smooth'});
            else if (section === 'Remote orders') document.getElementById('owner-recent-orders')?.scrollIntoView({behavior:'smooth'});
            else setTab(section);
          }}/>}

          {!demo&&<CashRefundBoard api={api} orders={orders} scope={ownerScope} actorId={app.address??venue.id} onChanged={()=>void load().catch(e=>setNotice(merchantError(e)))}/>}
          <section className="m-panel">
            <h2 id="owner-refund-approvals">{t('Refund approvals')}</h2>
            <p className="m-muted">
              Return the exact received asset and amount from your own wallet.
            </p>
            {orders
              .filter((o) => o.refund && o.status !== 'REFUNDED')
              .map((o) => (
                <div className="m-refund" key={o.id}>
                  <div>
                    <strong>Order #{number(o)}</strong>
                    <p>
                      {o.payment
                        ? cryptoAmount(o.payment.amountAtomic, o.payment.asset)
                        : money(paidOrderSummary(o).totalMinor, o.fiatCurrency)}
                    </p>
                    <small>{o.refund?.reason ?? 'Requested by cashier'}</small>
                  </div>
                  {!demo &&
                  readSigningIntent(`${prefix}refund:${o.id}`) &&
                  !o.refund?.pendingHash ? (
                    <RecoverTransaction
                      busy={busy}
                      onRestore={(hash) =>
                        void run(async () => {
                          const saved = restoreSubmittedHash(
                            `${prefix}refund:${o.id}`,
                            hash,
                          )
                          await api.refundPayment(
                            o.id,
                            saved.hash,
                            saved.quoteId,
                          )
                        }, 'Original refund submitted for verification.')
                      }
                    />
                  ) : (
                    <button
                      className="m-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => submitRefund(o),
                          demo
                            ? 'Simulated full refund complete.'
                            : 'Refund submitted for verification.',
                        )
                      }
                    >
                      {demo
                        ? 'Simulate owner approval'
                        : o.refund?.pendingHash ||
                            readSubmitted(`${prefix}refund:${o.id}`)
                          ? 'Check submitted refund'
                          : 'Approve in owner wallet'}
                    </button>
                  )}
                  {!demo && o.refund?.pendingHash && o.refund.quote && (
                    <RecoverTransaction
                      busy={busy}
                      onRestore={(hash) => void run(async () => {
                        const saved = restoreSubmittedHash(`${prefix}refund:${o.id}`, hash, {
                          revision: o.revision,
                          quoteId: o.refund!.quote!.id,
                        })
                        await api.refundPayment(o.id, saved.hash, saved.quoteId)
                      }, 'Refund transaction submitted for verification.')}
                    />
                  )}
                </div>
              ))}
            {!orders.some((o) => o.refund && o.status !== 'REFUNDED') && (
              <p className="m-muted">Nothing awaiting approval.</p>
            )}
          </section>
          <section className="m-panel">
            <h2 id="owner-recent-orders">{t('Recent orders')}</h2>{ownerContext.error&&<p role="alert">{t('Priority data may be stale.')} {ownerContext.error}</p>}
            {!demo && <p className="m-muted">{t('Accept and prepare orders on the paired terminal. Owner payment decisions are in Payments.')}</p>}
            {orders.length ? (
              ownerContext.orders.map((o) => (
                <div key={o.id}><div className="m-line">
                  <span>
                    #{number(o)}
                    <small>{orderStatus(o.status)}</small>
                  </span>
                  <strong>{money(paidOrderSummary(o).totalMinor, o.fiatCurrency)}</strong>
                </div>{!demo&&<DiscountPanel api={api} venueId={venue.id} order={o} scope={ownerScope} owner/>}<OrderContextPanel api={api} venueId={venue.id} orderId={o.id} scope={ownerScope} owner canWrite summary={ownerContext.summaries.get(o.id)} onChanged={()=>void ownerContext.refresh()} demo={!!demo}/>{!demo&&['PREPARING','READY'].includes(o.status)&&<OrderReadiness api={api} venueId={venue.id} order={o} scope={ownerScope} owner canWrite={false}/>}</div>
              ))
            ) : (
              <p className="m-muted">Your first sale will appear here.</p>
            )}
          </section>
        </>
      ) : tab === 'Financial reconciliation' ? (
        demo ? <p>{t('Financial reconciliation requires a connected venue.')}</p> : <><FinanceBoard api={api} venueId={venue.id} scope={ownerScope}/><EconomicsBoard api={api} venueId={venue.id} scope={ownerScope}/></>
      ) : tab === 'Payments' ? (
        demo ? <p>{t('Payment exception decisions require a connected venue.')}</p> : <PaymentExceptions api={api} venueId={venue.id} scope={ownerScope} onRefunds={() => {setTab('Overview'); setTimeout(() => document.getElementById('owner-refund-approvals')?.scrollIntoView({behavior:'smooth'}), 0)}}/>
      ) : tab === 'Remote orders' ? (
        demo ? <Link to="/remote/demo">Try remote ordering demo →</Link> : <RemoteOwner merchant={api} venue={venue} />
      ) : tab === 'Inventory' ? (
        demo ? <p>{t('Inventory requires a connected venue.')}</p> : <InventoryBoard key={ownerScope} api={api} venueId={venue.id} scope={ownerScope} owner manage canCosts currency={venue.fiatCurrency}/>
      ) : tab === 'Schedule' ? (
        demo ? <p>Schedules require a connected venue.</p> : <ScheduleBoard api={api} venueId={venue.id} employeeId="" manage owner/>
      ) : tab === 'Day closing' ? (
        demo ? <p>Day closing requires a connected venue.</p> : <DayCloseBoard api={api} venueId={venue.id} scope={ownerScope} owner/>
      ) : tab === 'Work time' ? (
        demo ? <p>Work time requires a connected venue.</p> : <WorkTimeBoard api={api} venueId={venue.id} scope={ownerScope} owner manage employees={employees}/>
      ) : tab === 'Handover' ? (
        demo ? <p>{t('Handover requires a connected venue.')}</p> : <ShiftHandover key={ownerScope} api={api} venueId={venue.id} scope={ownerScope} owner employees={employees}/>
      ) : tab === 'Staff tasks' ? (
        demo ? <p>{t('Staff tasks require a connected venue.')}</p> : <TaskBoard key={ownerScope} api={api} venueId={venue.id} scope={ownerScope} owner manage employees={employees}/>
      ) : tab === 'Loyalty' ? (
        <LoyaltyOwner api={api} venue={venue} products={products} demo={demo} />
      ) : tab === 'Menu' ? (
        !demo ? <MenuWorkspaceBoard key={ownerScope} api={api} venue={venue} scope={ownerScope} products={products} onPublished={load}/> : <>
          <div className="m-row">
            <h2>Your menu</h2>
            <button className="m-primary" onClick={() => setEditor('new')}>
              Add product +
            </button>
          </div>
          {editor && (
            <ProductForm
              products={products}
              product={editor === 'new' ? undefined : editor}
              currency={venue.fiatCurrency}
              busy={busy}
              onClose={() => setEditor(null)}
              onSave={(input) =>
                run(async () => {
                  if (demo) {
                    const p = { ...input, id: input.id ?? uuid() }
                    const i = demo.products.findIndex((x) => x.id === p.id)
                    if (i >= 0) demo.products[i] = p
                    else demo.products.push(p)
                  } else await api.saveProduct(venue.id, input)
                  setEditor(null)
                }, 'Menu saved.')
              }
            />
          )}
          {products.map((p) => (
            <div className="m-panel m-menu-row" key={p.id}>
              <div>
                <small>{p.category}</small>
                <h3>{p.name}</h3>
                <p>
                  {p.variants
                    .map(
                      (v) =>
                        `${v.name} ${money(v.priceMinor, venue.fiatCurrency)}`,
                    )
                    .join(' · ')}
                </p>
                <small>
                  {p.extras.length} paid extras ·{' '}
                  {p.available ? 'Available' : 'Unavailable'}
                </small>
              </div>
              <button onClick={() => setEditor(p)}>Edit →</button>
            </div>
          ))}
        </>
      ) : tab === 'Decision history' ? (
        demo ? <section className="m-panel"><h2>{t('Decision history')}</h2><p>{t('No decisions recorded yet.')}</p></section> : <AuditTrail key={`${app.token}:${venue.id}`} api={api} venueId={venue.id} />
      ) : tab === 'Team' ? (
        <>
          <EmployeeForm
            busy={busy}
            onSave={(name, pin) =>
              run(
                () =>
                  demo
                    ? demo.addEmployee(name, pin)
                    : api.addEmployee(venue.id, name, pin),
                'Employee added.',
              )
            }
          />
          <section className="m-panel">
            <h2>Your people</h2>
            {employees.map((e) => (
              <div key={e.id}><div className="m-line">
                <span>
                  <strong>{e.name}</strong>
                  <small>
                    {e.active ? 'Active profile' : 'Disabled profile'}
                  </small>
                </span>
                <div className="m-row">
                  <button
                    disabled={busy}
                    onClick={() => {
                      const pin = window.prompt('New 4–8 digit PIN')
                      if (pin)
                        void run(() => {
                          if (demo) demo.resetPin(e.id, pin)
                          else return api.editEmployee(e.id, { pin })
                        }, 'PIN updated.')
                    }}
                  >
                    Reset PIN
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() => {
                        if (demo) e.active = !e.active
                        else
                          return api.editEmployee(e.id, { active: !e.active })
                      })
                    }
                  >
                    {e.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div><EmployeeAccess key={`${app.token}:${venue.id}:${e.id}`} employee={e} disabled={busy} onSave={async changes => { if(demo) {Object.assign(e,changes);refreshDemo()} else {await api.editEmployee(e.id,changes);await load()} }} /></div>
            ))}
          </section>
        </>
      ) : (
        <section className="m-panel">
          <span className="m-label">ONE SHARED PHONE</span>
          <h2>
            A separate space
            <br />
            for your team.
          </h2>
          <p>
            Generate a pairing token here. Enter it on the shared phone at
            <strong>Terminal</strong>. Staff use their own profile and PIN; your
            wallet stays on your phone.
          </p>
          <div className="m-actions">
            <button
              className="m-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPairToken(
                    demo
                      ? 'DEMO-PAIRING-NO-CREDENTIALS'
                      : (await api.pair(venue.id)).terminalToken,
                  )
                }, 'New pairing replaces the previous terminal and ends its sessions.')
              }
            >
              Generate pairing token
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!demo) await api.revoke(venue.id)
                  setPairToken(null)
                }, 'Terminal access revoked.')
              }
            >
              Revoke terminal
            </button>
          </div>
          {pairToken && (
            <div className="m-soft">
              <label>
                {t("Pairing token")}
                <textarea readOnly value={pairToken} />
              </label>
              <button
                onClick={() =>
                  void copyText(pairToken).then((ok) =>
                    setNotice(
                      ok
                        ? 'Pairing token copied.'
                        : 'Select and copy the token.',
                    ),
                  )
                }
              >
                Copy token
              </button>
              <small>
                Treat as a credential. Share only with your terminal.
              </small>
            </div>
          )}
        </section>
      )}
    </>
  )
}
function VenueForm({
  venue,
  busy,
  onSave,
}: {
  venue: MerchantVenue | null
  busy: boolean
  onSave: (input: VenueInput) => Promise<void>
}) {
  const [input, setInput] = useState<VenueInput>(venue ?? emptyVenue)
  useEffect(() => setInput(venue ?? emptyVenue), [venue?.id])
  return (
    <form
      className="m-panel m-form"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(input)
      }}
    >
      <h2>{venue ? 'Venue details' : 'Welcome to your counter.'}</h2>
      <label>
        Venue name
        <input
          required
          maxLength={80}
          value={input.name}
          placeholder="Your café"
          onChange={(e) => setInput({ ...input, name: e.target.value })}
        />
      </label>
      <label>
        Menu currency
        <select
          value={input.fiatCurrency}
          onChange={(e) =>
            setInput({ ...input, fiatCurrency: e.target.value as MerchantFiat })
          }
        >
          {['EUR', 'PLN', 'USD'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Nimiq receiving address
        <input
          required
          minLength={10}
          value={input.nimAddress}
          placeholder="NQ…"
          onChange={(e) => setInput({ ...input, nimAddress: e.target.value })}
        />
      </label>
      <label>
        USDT receiving address · Polygon
        <input
          value={input.usdtAddress ?? ''}
          pattern="0x[0-9a-fA-F]{40}"
          placeholder="0x… (optional)"
          onChange={(e) =>
            setInput({ ...input, usdtAddress: e.target.value || null })
          }
        />
      </label>
      <p className="m-muted">
        Sales go directly to these addresses in the asset the customer chooses.
      </p>
      <button className="m-primary" disabled={busy}>
        Save venue →
      </button>
    </form>
  )
}
function EmployeeForm({
  busy,
  onSave,
}: {
  busy: boolean
  onSave: (name: string, pin: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  return (
    <form
      className="m-panel m-form"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(name, pin).then(() => {
          setName('')
          setPin('')
        })
      }}
    >
      <h2>Add a team member</h2>
      <label>
        Name
        <input
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t("Personal PIN")}
        <input
          required
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4,8}"
          minLength={4}
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </label>
      <button className="m-primary" disabled={busy}>
        Add employee +
      </button>
    </form>
  )
}
function ProductArt({ name, category }: { name: string; category: string }) {
  const pastry = /croissant|bakery|pastry|bread/i.test(`${name} ${category}`)
  return (
    <div
      className={`m-art ${pastry ? 'm-art-bakery' : /matcha/i.test(name) ? 'm-art-matcha' : ''}`}
      aria-hidden="true"
    >
      {pastry ? (
        <svg viewBox="0 0 200 140">
          <ellipse
            cx="102"
            cy="114"
            rx="65"
            ry="9"
            fill="#bc8754"
            opacity=".13"
          />
          <path
            d="M29 80Q41 61 56 60Q63 35 81 41Q95 24 109 36Q130 28 141 51Q164 48 175 79L152 101Q146 87 131 81Q118 77 101 80Q85 76 67 89L47 107Z"
            fill="#bb783c"
          />
          <path
            d="M31 78Q43 68 57 69L49 97ZM59 60Q66 47 81 48L74 85L57 95ZM85 42Q97 32 109 40L112 77L82 80ZM114 39Q127 36 137 54L131 79L116 77ZM144 57Q161 58 173 79L153 92L135 81Z"
            fill="#e5b16b"
          />
          <path
            d="M64 66L73 53M91 49L99 43M122 47L128 56"
            stroke="#f3cc92"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <div className="m-cup">
          <div className="m-coffee">
            <span />
          </div>
        </div>
      )}
    </div>
  )
}
function Terminal({
  demo,
  version = 0,
  refreshDemo = () => {},
  onCustomer,
}: {
  demo?: DemoCafe
  version?: number
  refreshDemo?: () => void
  onCustomer?: (id: string) => void
}) {
  const { api, prefix } = useMerchantApi()
  const [session, setSession] = useState<CashierSession | null>(() =>
    demo?.cashier
      ? { token: 'demo', employee: demo.cashier, venue: demo.venue }
      : stored<CashierSession>(`${prefix}cashier`),
  )
  const [venue, setVenue] = useState<MerchantVenue | null>(
    demo?.venue ?? session?.venue ?? null,
  )
  const [profiles, setProfiles] = useState<MerchantEmployee[]>(
    demo?.employees ?? [],
  )
  const [terminalToken, setTerminalToken] = useState('')
  const [profile, setProfile] = useState(demo?.cashier?.id ?? '')
  const [pin, setPin] = useState('')
  const [tab, setTab] = useState('Sale')
  const [category, setCategory] = useState('All')
  const [displayAsset, setDisplayAsset] = useState<MerchantAsset>('NIM')
  const [rates, setRates] = useState<DisplayRates>({ NIM: null, USDT: null })
  const [clock, setClock] = useState(Date.now())
  const [products, setProducts] = useState<MerchantProduct[]>(
    demo?.products ?? [],
  )
  const [orders, setOrders] = useState<MerchantOrder[]>(demo?.orders ?? [])
  const [shift, setShift] = useState<MerchantShift | null>(demo?.shift ?? null)
  const posContext = useOrderContextQueue(api,venue?.id ?? '',session?.token ?? '',orders.filter(o=>(o as MerchantOrder & {source?:string}).source!=='REMOTE'&&!['CANCELLED','REFUNDED'].includes(o.status)),false,!demo&&!!session)
  const remotePresence = useRemotePresence(api, venue?.id ?? null, !demo && Boolean(session && shift))
  const [report, setReport] = useState<MerchantReport | null>(null)
  const [cart, setCart] = useState<MerchantCartLine[]>([])
  const [selected, setSelected] = useState<MerchantProduct | null>(null)
  const [shared, setShared] = useState<MerchantOrder | null>(null)
  const activeShared = shared ? orders.find(o=>o.id===shared.id && o.revision>=shared.revision) ?? shared : null
  const [editing, setEditing] = useState<MerchantOrder | null>(null)
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cashBusy,setCashBusy] = useState(false)
  const [verifiedAuthority,setVerifiedAuthority] = useState<string|null>(demo ? session?.token ?? null : null)
  const authority = useRef(session?.token)
  authority.current = session?.token
  useEffect(() => {
    if (demo || !session) return
    let active = true
    let running = false
    const token = session.token
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const fresh = await api.session()
        if (!fresh?.employee?.id || !fresh?.venue?.id) throw new Error('Invalid session response')
        if (!active || authority.current !== token) return
        setVerifiedAuthority(token)
        const next = {...fresh,token}
        sessionStorage.setItem(`${prefix}cashier`,JSON.stringify(next))
        setSession(next)
      } catch (error) {
        if (!active || authority.current !== token) return
        setVerifiedAuthority(null)
        // Fail closed for delegated tools until authority can be refreshed.
        setSession(current => current?.token === token ? {...current,employee:{...current.employee,role:'CASHIER',permissions:[]} as AccessEmployee} : current)
      } finally {running=false}
    }
    void refresh()
    const timer = setInterval(()=>void refresh(),3000)
    return () => {active=false;clearInterval(timer)}
  },[api,demo,session?.token,prefix])
  const key = useRef(uuid())
  useEffect(() => {
    if (demo) return
    // Shared-terminal data belongs to the signed-in cashier, even while the next load is pending.
    setProducts([])
    setOrders([])
    setShift(null)
    setReport(null)
    setCart([])
    setSelected(null)
    setShared(null)
    setEditing(null)
    setCode('')
    setRates({NIM:null,USDT:null})
    setCategory('All')
    key.current=uuid()
  },[demo,session?.token])
  const loadProfiles = async (isCurrent = () => true) => {
    const token = authority.current
    const terminal = localStorage.getItem(`${prefix}terminal`)
    if (demo) {
      setProfiles([...demo.employees])
      setVenue(demo.venue)
      return
    }
    const data = await api.profiles()
    if (!isCurrent() || authority.current !== token || localStorage.getItem(`${prefix}terminal`) !== terminal) return
    if (session && data.venue?.id !== session.venue.id) return
    setProfiles(data.employees)
    setVenue(data.venue)
  }
  const load = useCallback(async () => {
    if (demo) {
      setProducts([...demo.products])
      setOrders([...demo.orders])
      setShift(demo.shift)
      setVenue(demo.venue)
      if (demo.shift)
        setReport(
          demoReport(
            demo.orders.filter((o) => o.shiftId === demo.shift?.id),
            demo.venue.fiatCurrency,
          ),
        )
      return
    }
    if (!session) return
    const token = session.token
    const [p, o, s] = await Promise.all([
      api.catalog(session.venue.id),
      api.orders(session.venue.id),
      api.shift(),
    ])
    if (authority.current !== token) return
    setProducts(p)
    setOrders(o)
    setShift(s)
    if (s) { const result = await api.report(s.id,true); if(authority.current === token)setReport(result) }
  }, [api, demo, session?.token])
  useEffect(() => {
    let active = true
    const token = session?.token
    // Restored sessions also need the terminal roster for handovers and tasks.
    void loadProfiles(() => active).catch((e) => {
      if (active && authority.current === token && localStorage.getItem(`${prefix}terminal`))
        setNotice(merchantError(e))
    })
    if (session) void load().catch((e) => {
      if (active && authority.current === token) setNotice(merchantError(e))
    })
    return () => {active=false}
  }, [load, version, session?.token])
  useEffect(() => {
    if (demo || !session) return
    let active = true
    const token = session.token
    const timer = setInterval(
      () =>
        void load().catch((e) => {
          if (!active || authority.current !== token) return
          setNotice(merchantError(e))
          if (e.status === 401) {
            sessionStorage.removeItem(`${prefix}cashier`)
            setSession(null)
          }
        }),
      3000,
    )
    return () => {active=false;clearInterval(timer)}
  }, [load, demo, session?.token, prefix])
  useEffect(() => {
    if (demo || !session) return
    let cancelled = false
    const update = async () => {
      try {
        const next = await api.rates(session.venue.id)
        if (!cancelled) setRates(next)
      } catch {
        if (!cancelled) setRates({ NIM: null, USDT: null })
      }
    }
    void update()
    const timer = setInterval(() => {
      void update()
    }, 60000)
    const expiry = setInterval(() => setClock(Date.now()), 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
      clearInterval(expiry)
    }
  }, [api, demo, session?.token])
  const estimate = (minor: number) => {
    if (demo) {
      const eurMinor =
        minor /
        (venue?.fiatCurrency === 'PLN'
          ? 4.3
          : venue?.fiatCurrency === 'USD'
            ? 1.08
            : 1)
      return `≈ ${cryptoAmount(String(Math.round(eurMinor * (displayAsset === 'NIM' ? 500000 : 10800))), displayAsset)} · demo`
    }
    const rate = rates[displayAsset]
    const age = rate
      ? Math.max(clock, Date.now()) - Date.parse(rate.at)
      : Infinity
    if (
      !rate ||
      !Number.isFinite(age) ||
      age < -10000 ||
      age > 120000 ||
      !Number.isFinite(Number(rate.value)) ||
      Number(rate.value) <= 0
    )
      return t('Live estimate unavailable · quote at checkout')
    return `≈ ${(minor / 100 / Number(rate.value)).toLocaleString('en', { maximumFractionDigits: displayAsset === 'NIM' ? 5 : 6 })} ${displayAsset}`
  }
  const run = async (
    action: () => Promise<unknown> | unknown,
    success?: string,
  ) => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      refreshDemo()
      await load()
      if (success) setNotice(success)
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      setBusy(false)
    }
  }
  const signIn = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (demo) {
        demo.signIn(profile, pin)
        setSession({
          token: 'demo',
          employee: demo.cashier!,
          venue: demo.venue,
        })
      } else {
        const s = await api.login(profile, pin)
        sessionStorage.setItem(`${prefix}cashier`, JSON.stringify(s))
        setSession(s)
      }
      setPin('')
    })
  }
  const total = cart.reduce((n, line) => {
    const p = products.find((x) => x.id === line.productId)
    const v = p?.variants.find((x) => x.id === line.variantId)
    return (
      n +
      ((v?.priceMinor ?? 0) +
        line.extraIds.reduce(
          (sum, id) =>
            sum + (p?.extras.find((x) => x.id === id)?.priceMinor ?? 0),
          0,
        )) *
        line.quantity
    )
  }, 0)
  const createCheckout = () =>
    run(async () => {
      const order = editing
        ? demo
          ? demo.editOrder(editing.id, cart)
          : await api.editOrder(editing, cart)
        : demo
          ? demo.createOrder(cart)
          : await api.createOrder(cart, key.current)
      setShared(order)
      setCart([])
      setEditing(null)
      key.current = uuid()
    })
  if (!session)
    return (
      <>
        <section className="m-heading">
          <span className="m-label">{t("SHARED TERMINAL")}</span>
          <h1>
            {t("A good shift")}
            <br />
            {t("starts here.")}
          </h1>
          <p>{t("Choose your profile. Your PIN keeps your shift personal.")}</p>
        </section>
        <Notice text={notice} />
        {!venue && !demo ? (
          <form
            className="m-panel m-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                localStorage.setItem(`${prefix}terminal`, terminalToken.trim())
                await loadProfiles()
              }, 'Phone paired. Choose your cashier profile.')
            }}
          >
            <h2>{t("Pair this phone")}</h2>
            <p className="m-muted">
              {t("Enter the pairing token generated on the owner’s personal phone.")}
            </p>
            <label>
              {t("Pairing token")}
              <textarea
                required
                value={terminalToken}
                onChange={(e) => setTerminalToken(e.target.value)}
                placeholder="Paste the token here"
              />
            </label>
            <button className="m-primary" disabled={busy}>
              {t("Pair terminal →")}
            </button>
          </form>
        ) : (
          <form className="m-panel m-form" onSubmit={signIn}>
            <span className="m-label">{venue?.name}</span>
            <label>
              {t("Cashier profile")}
              <select
                required
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
              >
                <option value="">{t("Choose your name")}</option>
                {profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t("Personal PIN")}
              <input
                required
                type="password"
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
            {demo && <small>Anna: 1234 · Leo: 5678</small>}
            <button className="m-primary" disabled={busy}>
              {t("Start your day →")}
            </button>
            {!demo && (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(`${prefix}terminal`)
                  setVenue(null)
                  setProfiles([])
                }}
              >
                {t("Pair a different terminal")}
              </button>
            )}
          </form>
        )}
      </>
    )
  return (
    <>
      <div className="m-heading m-row">
        <div>
          <span className="m-label">{venue?.name}</span>
          <h1>
            {tab === 'Inventory' ? t('Inventory') : tab === 'Management' ? t('Manage your venue') : tab === 'Sale' ? (
              <>
                {t("Something good")}
                <br />
                {t("for your day.")}
              </>
            ) : tab === 'Queue' ? (
              t('The daily rhythm.')
            ) : tab === 'Availability' ? (
              t('Fresh, when it is.')
            ) : (
              t('Your shift.')
            )}
          </h1>
        </div>
        <div className="m-profile">
          <span className="m-avatar">
            {session.employee.name
              .split(' ')
              .map((x) => x[0])
              .slice(0, 2)
              .join('')}
          </span>
          <small>
            {session.employee.name}
            <br />
            <span>{shift ? '● '+t('Shift open') : t('Shift closed')}</span>
          </small>
        </div>
      </div>
      <nav className="m-tabs" aria-label={t('Cashier sections')}>
        {['Sale', 'Queue', 'Availability', 'Shift', ...(verifiedAuthority === session.token && hasPermission(session.employee,'reports.view') && hasPermission(session.employee,'tasks.manage') ? ['Day closing'] : []), 'Handover', 'Work time', 'Schedule', 'Staff tasks', 'Inventory', ...(verifiedAuthority === session.token && (hasPermission(session.employee,'menu.manage') || hasPermission(session.employee,'reports.view') || hasPermission(session.employee,'audit.view')) ? ['Management'] : [])].map((label) => (
          <button key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>
            {t(label)}
            {label === 'Queue' &&
            orders.filter((o) => ['PREPARING', 'READY'].includes(o.status))
              .length
              ? ` · ${orders.filter((o) => ['PREPARING', 'READY'].includes(o.status)).length}`
              : ''}
          </button>
        ))}
      </nav>
      <Notice text={notice} />
      {tab === 'Schedule' ? (
        demo ? <p>{t('Schedules are available when a venue is connected.')}</p> : verifiedAuthority === session.token ? <ScheduleBoard key={`${session.token}:${session.employee.id}`} api={api} venueId={session.venue.id} employeeId={session.employee.id} manage={hasPermission(session.employee, 'schedule.manage')} /> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : null}
      {!shift && (
        <section className="m-soft m-row">
          <div>
            <strong>{t("Open your personal shift.")}</strong>
            <small>{t("Sales are recorded under your cashier profile.")}</small>
          </div>
          <button
            className="m-primary"
            disabled={busy}
            onClick={() =>
              void run(() => (demo ? demo.openShift() : api.openShift()))
            }
          >
            {t("Open shift →")}
          </button>
        </section>
      )}
      {tab === 'Schedule' ? null : tab === 'Inventory' ? (
        demo ? <p>{t('Inventory requires a connected venue.')}</p> : verifiedAuthority === session.token ? <InventoryBoard key={`${session.token}:${JSON.stringify(session.employee)}`} api={api} venueId={session.venue.id} scope={`${session.token}:${JSON.stringify(session.employee)}`} manage={hasPermission(session.employee,'inventory.manage')} canCosts={hasPermission(session.employee,'inventory.costs')} currency={session.venue.fiatCurrency}/> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : tab === 'Day closing' ? (
        demo ? <p>Day closing requires a connected venue.</p> : verifiedAuthority === session.token && hasPermission(session.employee,'reports.view') && hasPermission(session.employee,'tasks.manage') ? <DayCloseBoard api={api} venueId={session.venue.id} scope={session.token}/> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : tab === 'Work time' ? (
        demo ? <p>Work time requires a connected venue.</p> : verifiedAuthority === session.token ? <WorkTimeBoard api={api} venueId={session.venue.id} scope={session.token+JSON.stringify(session.employee)} employeeId={session.employee.id} manage={hasPermission(session.employee,'time.manage')} employees={profiles}/> : <p>Operational access is unavailable.</p>
      ) : tab === 'Handover' ? (
        demo ? <p>{t('Handover requires a connected venue.')}</p> : verifiedAuthority === session.token ? <ShiftHandover key={session.token} api={api} venueId={session.venue.id} scope={session.token} employeeId={session.employee.id} employees={profiles}/> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : tab === 'Staff tasks' ? (
        demo ? <p>{t('Staff tasks require a connected venue.')}</p> : verifiedAuthority === session.token ? <TaskBoard key={`${session.token}:${JSON.stringify(session.employee)}`} api={api} venueId={session.venue.id} scope={`${session.token}:${JSON.stringify(session.employee)}`} employeeId={session.employee.id} manage={hasPermission(session.employee,'tasks.manage')} viewPhotos={hasPermission(session.employee,'photos.view')} employees={profiles}/> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : tab === 'Management' ? (
        verifiedAuthority === session.token ? <ManagerTools key={`${session.token}:${JSON.stringify(session.employee)}`} api={api} venue={session.venue} employee={session.employee} products={products} reload={load} onQueue={()=>setTab('Queue')} /> : <p>{t('Operational access is unavailable. Ask the owner.')}</p>
      ) : tab === 'Sale' ? (
        <>
          <div className="m-row">
            <span className="m-label">MENU · {venue?.fiatCurrency}</span>
            <label className="m-rate-selector">
              {t("Estimates in")}
              <select
                aria-label={t('Display payment estimates in')}
                value={displayAsset}
                onChange={(e) =>
                  setDisplayAsset(e.target.value as MerchantAsset)
                }
              >
                <option>NIM</option>
                <option>USDT</option>
              </select>
            </label>
          </div>
          <nav className="m-categories" aria-label={t('Menu categories')}>
            {['All', ...new Set(products.map((p) => p.category))].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c === 'All' ? t('All') : c}
              </button>
            ))}
          </nav>
          <div className="m-sale-grid">
            <div className="m-products">
              {products
                .filter((p) => category === 'All' || p.category === category)
                .map((p) => (
                  <button
                    className="m-product"
                    key={p.id}
                    disabled={!p.available || !shift || busy}
                    onClick={() => setSelected(p)}
                  >
                    {p.imageId ? <PublicProductImage imageId={p.imageId} alt={p.name} /> : <ProductArt name={p.name} category={p.category} />}
                    <div className="m-product-info">
                      <strong>{p.name}</strong><ProductInformation product={p} products={products}/>
                      <div className="m-row">
                        <span>
                          {money(
                            p.variants[0]?.priceMinor ?? 0,
                            venue?.fiatCurrency,
                          )}
                        </span>
                        <b className="m-add">+</b>
                      </div>
                      <small>
                        {!p.available
                          ? 'Temporarily unavailable'
                          : estimate(p.variants[0]?.priceMinor ?? 0)}
                      </small>
                    </div>
                  </button>
                ))}
              {!products.length && (
                <p className="m-muted">
                  {t("The owner can add products in the Menu workspace.")}
                </p>
              )}
            </div>
            <section className="m-basket">
              <div className="m-row">
                <span className="m-label">
                  {editing
                    ? `EDIT ORDER #${number(editing)}`
                    : t('TODAY’S LITTLE JOYS')}
                </span>
                <small>{cart.reduce((n, x) => n + x.quantity, 0)} {t("items")}</small>
              </div>
              <h2>{t("Your basket.")}</h2>
              {cart.length ? (
                cart.map((line, i) => {
                  const p = products.find((x) => x.id === line.productId)
                  const v = p?.variants.find((x) => x.id === line.variantId)
                  const price =
                    ((v?.priceMinor ?? 0) +
                      line.extraIds.reduce(
                        (n, id) =>
                          n +
                          (p?.extras.find((x) => x.id === id)?.priceMinor ?? 0),
                        0,
                      )) *
                    line.quantity
                  return (
                    <div className="m-line" key={i}>
                      <div>
                        <strong>
                          {line.quantity} × {p?.name}
                        </strong>
                        <small>
                          {[
                            v?.name,
                            ...line.extraIds.map(
                              (id) => p?.extras.find((x) => x.id === id)?.name,
                            ),
                          ].join(' · ')}
                        </small>
                        <div className="m-quantity">
                          <button
                            aria-label={`${t('Decrease')} ${p?.name}`}
                            onClick={() =>
                              setCart(
                                cart.flatMap((x, j) =>
                                  j !== i
                                    ? [x]
                                    : x.quantity > 1
                                      ? [{ ...x, quantity: x.quantity - 1 }]
                                      : [],
                                ),
                              )
                            }
                          >
                            −
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            aria-label={`${t('Increase')} ${p?.name}`}
                            disabled={line.quantity >= 99}
                            onClick={() =>
                              setCart(
                                cart.map((x, j) =>
                                  j === i
                                    ? { ...x, quantity: x.quantity + 1 }
                                    : x,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div>
                        <strong>{money(price, venue?.fiatCurrency)}</strong>
                        <button
                          className="m-remove"
                          aria-label={`${t('Remove')} ${p?.name}`}
                          onClick={() =>
                            setCart(cart.filter((_, j) => j !== i))
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="m-muted">
                  {t("Choose something from the menu.")}
                  <br />
                  {t("We’ll take it from here.")}
                </p>
              )}
              <button
                className="m-primary"
                disabled={!cart.length || !shift || busy}
                onClick={() => void createCheckout()}
              >
                {editing ? t('Update checkout') : t('Share checkout')}
                <span>{money(total, venue?.fiatCurrency)} →</span>
              </button>
              {editing && (
                <button
                  onClick={() => {
                    setEditing(null)
                    setCart([])
                  }}
                >
                  {t("Discard edit")}
                </button>
              )}
              <small className="m-centered">
                {cart.length ? `${estimate(total)} · ` : ''}
                {demo
                  ? t('Example rates · no real transactions')
                  : t('Server confirms prices and availability')}
              </small>
            </section>
          </div>
          {activeShared && (
            <section className="m-panel m-share">
              <div>
                <span className="m-label">{t("ORDER #")}{number(activeShared)}</span>
                <h2>
                  {t("A moment for")}
                  <br />
                  {t("your customer.")}
                </h2>
                <Lines
                  order={orders.find((o) => o.id === activeShared.id) ?? activeShared}
                />
                {!cashBusy && !activeShared.cashReceipt && <p className="m-muted">
                  {t("Customer scans the QR or shows their six-digit Nimble payment code.")}
                </p>}
                {demo ? (
                  <button
                    className="m-primary"
                    onClick={() => onCustomer?.(activeShared.id)}
                  >
                    {t("Open customer view →")}
                  </button>
                ) : !cashBusy && !activeShared.cashReceipt ? (
                  <>
                    <Link
                      className="m-primary"
                      to={`/merchant/checkout/${activeShared.checkoutToken}`}
                    >
                      {t("Open customer checkout ↗")}
                    </Link>
                    <form
                      className="m-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void run(
                          () => api.claim(activeShared.id, code),
                          'Code paired. The customer can review this order.',
                        )
                      }}
                    >
                      <label>
                        {t("Customer’s payment code")}
                        <input
                          required
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </label>
                      <button disabled={busy}>{t("Pair code →")}</button>
                    </form>
                  </>
                ) : null}
                {!demo && activeShared.source === 'COUNTER' && session?.employee && <CashPaymentPanel api={api} order={activeShared} scope={session.token} cashierId={session.employee.id} disabled={busy||!shift} onBusy={setCashBusy} onRecorded={next=>{setShared(next);void load().catch(e=>setNotice(merchantError(e)))}}/>}
                <div className="m-actions">
                  <button
                    onClick={() => {
                      setEditing(
                        orders.find((o) => o.id === activeShared.id) ?? activeShared,
                      )
                      setCart(
                        activeShared.lines.map((l) => ({
                          productId: l.productId,
                          variantId: l.variantId,
                          extraIds: l.extraIds,
                          quantity: l.quantity,
                        })),
                      )
                      setShared(null)
                    }}
                    disabled={cashBusy||activeShared.status !== 'AWAITING_PAYMENT'}
                  >
                    {t("Edit basket")}
                  </button>
                  <button disabled={cashBusy} onClick={() => setShared(null)}>{t("Back to menu")}</button>
                </div>
              </div>
              {!cashBusy && !activeShared.cashReceipt && <div className="m-centered">
                <QR
                  url={`${window.location.origin}${demo ? '/merchant/demo' : `/merchant/checkout/${activeShared.checkoutToken}`}`}
                />
                <small>
                  {demo
                    ? t('Demo link · same browser example')
                    : t('Scan to review & pay')}
                </small>
                {!demo && (
                  <button
                    onClick={() =>
                      void copyText(
                        `${window.location.origin}/merchant/checkout/${activeShared.checkoutToken}`,
                      ).then((ok) =>
                        setNotice(
                          ok
                            ? 'Checkout link copied.'
                            : 'Copy the address from customer checkout.',
                        ),
                      )
                    }
                  >
                    {t("Copy checkout link")}
                  </button>
                )}
              </div>}
            </section>
          )}
        </>
      ) : tab === 'Queue' ? (
        <div className="m-queue">
          {venue && !demo && <RemoteQueue key={`${session.token}:${venue.id}`} contextScope={session.token} merchant={api} venueId={venue.id} shiftActive={Boolean(shift)} presence={remotePresence.venue} presenceError={remotePresence.error} onChanged={() => void load()} />}
          {venue && <LoyaltyQueue api={api} venueId={venue.id} demo={demo} refreshDemo={refreshDemo} />}
          {posContext.error&&<p role="alert">{t('Priority data may be stale.')} {posContext.error}</p>}
          {posContext.orders
            .map((o) => (
              <section className="m-panel m-order" key={o.id}>
                <div className="m-row">
                  <span className="m-order-number">#{number(o)}</span>
                  <span
                    className={`m-status m-status-${o.status.toLowerCase()}`}
                  >
                    {orderStatus(o.status)}
                  </span>
                </div>
                <Lines order={paidOrderSummary(o)} />
                {venue&&!demo&&['PREPARING','READY'].includes(o.status)&&<OrderReadiness api={api} venueId={venue.id} order={o} scope={session.token} canWrite={!!shift} onChanged={()=>void load()}/>}
                {venue&&!demo&&<DiscountPanel api={api} venueId={venue.id} order={o} scope={session.token}/ >}{venue&&<OrderContextPanel api={api} venueId={venue.id} orderId={o.id} scope={session.token} canWrite={!!shift} summary={posContext.summaries.get(o.id)} onChanged={()=>void posContext.refresh()} demo={!!demo}/>}
                <div className="m-row">
                  <strong>{money(paidOrderSummary(o).totalMinor, o.fiatCurrency)}</strong>
                  {o.payment && (
                    <small>
                      {cryptoAmount(o.payment.amountAtomic, o.payment.asset)}
                    </small>
                  )}
                </div>
                <div className="m-actions">
                  {o.cashReceipt && <button onClick={()=>{setShared(o);setTab('Sale')}}>{t('Check cash receipt')}</button>}
                  {o.status === 'AWAITING_PAYMENT' && (
                    <>
                      <button
                        onClick={() => {
                          setShared(o)
                          setTab('Sale')
                        }}
                      >
                        {t("Share checkout")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(o)
                          setCart(
                            o.lines.map((l) => ({
                              productId: l.productId,
                              variantId: l.variantId,
                              extraIds: l.extraIds,
                              quantity: l.quantity,
                            })),
                          )
                          setShared(null)
                          setTab('Sale')
                        }}
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            demo
                              ? demo.cancel(o.id)
                              : api.status(o, 'CANCELLED'),
                          )
                        }
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {o.status === 'PREPARING' && demo && (
                    <button className="m-primary" disabled={busy} onClick={()=>void run(()=>demo.advance(o.id))}>{t("All items ready →")}</button>
                  )}
                  {o.status === 'READY' && (
                    <button
                      className="m-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          demo
                            ? demo.advance(o.id)
                            : api.status(o, 'COLLECTED'),
                        )
                      }
                    >
                      {t("Mark collected ✓")}
                    </button>
                  )}
                  {!demo&&o.cashReceipt&&<CashRefundControl api={api} order={o} scope={session.token} actorId={session.employee.id} authority="cashier" disabled={busy||!shift} onChanged={()=>void load().catch(e=>setNotice(merchantError(e)))}/>}
                  {!o.cashReceipt && ['PREPARING', 'READY', 'COLLECTED'].includes(o.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            demo ? demo.requestRefund(o.id) : api.refund(o.id),
                          'Refund requested. The owner approves on their own phone.',
                        )
                      }
                    >
                      {t("Request full refund")}
                    </button>
                  )}
                </div>
              </section>
            ))}
          {!orders.length && (
            <section className="m-panel">
              <h2>{t("A quiet counter.")}</h2>
              <p>{t("Your orders will appear here after checkout.")}</p>
            </section>
          )}
        </div>
      ) : tab === 'Availability' ? (
        <section className="m-panel">
          <h2>{t("What’s available today?")}</h2>
          <p className="m-muted">
            {t("Manual availability for products and extras. No stock tracking.")}
          </p>
          {products.map((p) => (
            <div className="m-availability" key={p.id}>
              <label className="m-row">
                <strong>{p.name}</strong><ProductInformation product={p} products={products}/>
                <input
                  type="checkbox"
                  checked={p.available}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      demo
                        ? demo.setAvailability(p.id, e.target.checked)
                        : api.availability(venue!.id, p.id, e.target.checked),
                    )
                  }
                />
              </label>
              {p.extras.map((x) => (
                <label className="m-row m-extra" key={x.id}>
                  <span>{x.name}</span>
                  <input
                    type="checkbox"
                    checked={x.available}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() =>
                        demo
                          ? demo.setAvailability(p.id, e.target.checked, x.id)
                          : api.availability(
                              venue!.id,
                              p.id,
                              e.target.checked,
                              x.id,
                            ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </section>
      ) : (
        <>
          <Report
            report={report}
            title={`${session.employee.name.toUpperCase()} · ${t('Personal shift')}`}
          />
          <section className="m-panel">
            <h2>{t("A good day’s work.")}</h2>
            <p className="m-muted">
              {t("Your summary covers only your shift. The owner sees venue-wide reporting.")}
            </p>
            {shift && (
              <p>
                {t("Opened")}{' '}
                {new Date(shift.openedAt).toLocaleTimeString('en', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
            <div className="m-actions">
              {shift && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (demo) {
                        setReport(
                          demoReport(
                            demo.orders.filter(
                              (o) => o.shiftId === demo.shift?.id,
                            ),
                            demo.venue.fiatCurrency,
                          ),
                        )
                        demo.closeShift()
                      } else setReport(await api.closeShift(shift.id))
                      setShift(null)
                    }, 'Shift closed. Your summary is ready.')
                  }
                >
                  {t("Close my shift")}
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (demo) demo.signOut()
                    else {
                      await api.logout()
                      sessionStorage.removeItem(`${prefix}cashier`)
                    }
                    setSession(null)
                    setShared(null)
                    setCart([])
                    setPin('')
                    await loadProfiles()
                  })
                }
              >
                {t("Sign out / switch cashier")}
              </button>
            </div>
          </section>
        </>
      )}
      {tab === 'Sale' && cart.length > 0 && (
        <div className="m-mobile-checkout">
          <button
            className="m-primary"
            disabled={busy || !shift}
            onClick={() => void createCheckout()}
            aria-label={t('Checkout basket')}
          >
            <span>
              {cart.reduce((count, line) => count + line.quantity, 0)} {t("items · Checkout")}
            </span>
            <span>{money(total, venue!.fiatCurrency)} →</span>
          </button>
        </div>
      )}
      {selected && (
        <Options
          product={selected}
          products={products}
          currency={venue!.fiatCurrency}
          onClose={() => setSelected(null)}
          onAdd={(line) => {
            setCart([...cart, line])
            setSelected(null)
          }}
        />
      )}
    </>
  )
}
export function Options({
  product,
  products = [],
  currency,
  onClose,
  onAdd,
}: {
  product: MerchantProduct
  products?: MerchantProduct[]
  currency: MerchantFiat
  onClose: () => void
  onAdd: (line: MerchantCartLine) => void
}) {
  const [variant, setVariant] = useState(product.variants[0]!.id)
  const [extras, setExtras] = useState<string[]>([])
  const panel = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  )
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
      returnFocus.current?.focus()
    }
  }, [])
  const price =
    (product.variants.find((v) => v.id === variant)?.priceMinor ?? 0) +
    product.extras
      .filter((e) => extras.includes(e.id))
      .reduce((n, e) => n + e.priceMinor, 0)
  return (
    <div
      className="m-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Tab') {
          const focusable = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), select, input:not(:disabled)',
            ) ?? [],
          )
          const first = focusable[0]
          const last = focusable.at(-1)
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <div
        className="m-modal-inner m-form"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="m-options-title"
      >
        <div className="m-row">
          <span className="m-label">{t("JUST THE WAY YOU LIKE IT")}</span>
          <button aria-label={t('Close product options')} onClick={onClose}>
            ×
          </button>
        </div>
        <h2 id="m-options-title">{product.name}</h2>
        <label>
          {t("Size")}
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {money(v.priceMinor, currency)}
              </option>
            ))}
          </select>
        </label>
        <ProductChoices variantId={variant} products={products} product={product} selected={extras} onChange={setExtras} currency={currency}/>
        <button
          className="m-primary"
          disabled={!validProductChoices(product,extras,products,variant)}
          onClick={() =>
            validProductChoices(product,extras,products,variant) && onAdd({
              productId: product.id,
              variantId: variant,
              extraIds: extras,
              quantity: 1,
            })
          }
        >
          {t("Add to basket")}
          <span>{money(price, currency)} +</span>
        </button>
      </div>
    </div>
  )
}
export function MerchantCheckout() {
  const { token } = useParams<{
    token: string
  }>()
  return (
    <Frame>
      <Customer checkoutToken={token} />
    </Frame>
  )
}
function Customer({
  demo,
  orderId,
  checkoutToken,
  version = 0,
  refreshDemo = () => {},
}: {
  demo?: DemoCafe
  orderId?: string
  checkoutToken?: string
  version?: number
  refreshDemo?: () => void
}) {
  const { api, prefix } = useMerchantApi()
  const [order, setOrder] = useState<MerchantOrder | null>(
    demo && orderId ? demo.order(orderId) : null,
  )
  const [asset, setAsset] = useState<MerchantAsset>('NIM')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingKey = `${prefix}submitted:${checkoutToken}`
  const [pending, setPending] = useState<{
    hash: string
    revision: number
    quoteId: string
  } | null>(() => (demo ? null : readSubmitted(pendingKey)))
  const loadGeneration = useRef(0)
  const load = useCallback(async (generation = loadGeneration.current) => {
    const next =
      demo && orderId
        ? demo.order(orderId)
        : checkoutToken
          ? await api.checkout(checkoutToken)
          : null
    if (generation !== loadGeneration.current) return
    if (next) {
      setOrder({ ...next })
      if (next.quote) setAsset(next.quote.asset)
      if (next.pendingPaymentHash && next.quote)
        setPending(readSubmitted(pendingKey) ?? {
          hash: next.pendingPaymentHash,
          revision: next.pendingPaymentRevision ?? next.revision,
          quoteId: next.quote.id,
        })
      if (next.payment) {
        localStorage.removeItem(pendingKey)
        setPending(null)
      }
    }
  }, [api, demo, orderId, checkoutToken, pendingKey])
  useEffect(() => {
    let active = true
    const generation = ++loadGeneration.current
    if (!demo) {
      setOrder(null)
      setPending(readSubmitted(pendingKey))
    }
    setNotice(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try { await load(generation) } catch (e) { if (active) setNotice(merchantError(e)) }
      if (active && !demo) timer = setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => { active = false; loadGeneration.current++; clearTimeout(timer) }
  }, [load, demo, version, pendingKey])
  const loyalty = useCheckoutLoyalty({merchant: api, order, checkoutToken, demo, disabled: Boolean(order?.quote || order?.payment || order?.cashReceipt || order?.pendingPaymentHash)})
  const actionLock = useRef(false)
  const run = async (action: () => Promise<void> | void) => {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setNotice(null)
    try {
      await action()
      await load()
      refreshDemo()
    } catch (e) {
      setNotice(merchantError(e))
    } finally {
      actionLock.current = false
      setBusy(false)
      const saved = readSubmitted(pendingKey)
      if (saved) setPending(saved)
    }
  }
  const quote = () =>
    run(async () => {
      if (!order || !checkoutToken) return
      const sender = await getMerchantSender(asset)
      if ((order as MerchantOrder & {source?: string}).source === 'REMOTE' && asset === 'USDT' && !loyalty.participating) await linkLoyaltyEvm(new LoyaltyApi(api), sender)
      await loyalty.prepare(asset, sender)
      const nimAddress =
        asset === 'USDT'
          ? await getMerchantNimAddress().catch(() => undefined)
          : sender
      setOrder(
        await api.quote(
          checkoutToken,
          order.revision,
          asset,
          sender,
          nimAddress,
        ),
      )
    })
  const register = async (sent: {
    hash: string
    revision: number
    quoteId: string
  }) => {
    if (!checkoutToken) return
    setOrder(
      await api.payment(checkoutToken, sent.revision, sent.quoteId, sent.hash),
    )
  }
  const pay = () =>
    run(async () => {
      if (!order) return
      if (demo) {
        demo.simulatePayment(order.id, asset)
        return
      }
      if (pending) return register(pending)
      if (order.status === 'PAYMENT_PENDING' || order.pendingPaymentHash)
        throw new Error('Your submitted payment is awaiting verification.')
      if (
        !order.quote ||
        order.quote.asset !== asset ||
        new Date(order.quote.expiresAt).getTime() <= Date.now()
      )
        throw new Error('Quote expired. Get a fresh quote before paying.')
      const active = order.quote
      await submitOnce(
        pendingKey,
        { revision: order.revision, quoteId: active.id },
        () => sendMerchantPayment(active),
        async (registration) => {
          setPending(registration)
          await register(registration)
        },
      )
    })
  if (!order)
    return (
      <section className="m-panel">
        <span className="m-label">CUSTOMER CHECKOUT</span>
        <h1>
          Your moment
          <br />
          is on its way.
        </h1>
        <p>{notice ?? 'Loading your order…'}</p>
      </section>
    )
  const remote = (order as MerchantOrder & {source?: string}).source === 'REMOTE'
  const awaitingAcceptance = String(order.status) === 'AWAITING_ACCEPTANCE'
  const paid = Boolean(order.payment || order.cashReceipt)
  const receipt = paidOrderSummary(order)
  const signing = !demo && !paid ? readSigningIntent(pendingKey) : null
  const expired =
    !order.quote || new Date(order.quote.expiresAt).getTime() <= Date.now()
  const exactQuote = order.quote?.asset === asset && !expired
  return (
    <section className="m-customer">
      <span className="m-label">
        {demo?.venue.name ?? 'YOUR ORDER'} · #{number(order)}
      </span>
      <h1>
        {order.status === 'READY' ? (
          <>
            Your order
            <br />
            is waiting.
          </>
        ) : order.status === 'COLLECTED' ? (
          'See you again.'
        ) : awaitingAcceptance ? (
          t('Waiting for the venue')
        ) : paid ? (
          'A moment for you.'
        ) : (
          <>
            Your moment.
            <br />
            Your coffee.
          </>
        )}
      </h1>
      <p className="m-muted">
        {order.status === 'READY'
          ? remote ? t('Open your order and show your pickup QR at the counter.') : 'Come to the counter and show your number.'
          : order.status === 'COLLECTED'
            ? 'Thank you for stopping by.'
            : order.status === 'REFUND_PENDING'
              ? order.cashReceipt?t('Cash refund requested — money has not been handed back.'):'Your refund is awaiting owner authorization.'
              : order.status === 'REFUNDED'
                ? order.cashReceipt?t('The owner has confirmed your full cash refund.'):'Your full original crypto payment has been refunded.'
                : awaitingAcceptance
                  ? t('Payment received. The cashier must accept your order before preparation starts.')
                : paid
                  ? 'Payment received. We’re preparing your order.'
                  : 'Review every little detail, then choose how to pay.'}
      </p>
      <Notice text={notice} />
      {remote && <><Link className="m-primary r-link-button" to={`/orders/${order.id}`}>{t('Open my order')} →</Link>{!paid && <p className="r-warning">{t('Payment comes before venue acceptance. A rejected or unanswered order requires a refund approved by the owner.')}</p>}</>}
      {loyalty.node}
      {paid && !remote && (
        <div className="m-ticket">
          <span className="m-label">YOUR PICKUP NUMBER</span>
          <strong>{number(order)}</strong>
          <span className={`m-status m-status-${order.status.toLowerCase()}`}>
            {orderStatus(order.status)}
          </span>
          <div className="m-progress">
            <span className="done">Paid</span>
            <span
              className={
                ['READY', 'COLLECTED'].includes(order.status) ? 'done' : ''
              }
            >
              Ready
            </span>
            <span className={order.status === 'COLLECTED' ? 'done' : ''}>
              Collected
            </span>
          </div>
        </div>
      )}
      <section className="m-receipt">
        <span className="m-label">
          {paid ? 'YOUR ORDER RECEIPT' : 'TOTAL TO PAY'}
        </span>
        <p className="m-total">
          {money(receipt.totalMinor, receipt.fiatCurrency)}
        </p>
        {demo ? (
          <span className="m-conversion">
            ≈ {cryptoAmount(demo.quote(order.id, asset), asset)} · example rate
          </span>
        ) : order.payment ? (
          <span className="m-conversion">
            {cryptoAmount(order.payment.amountAtomic, order.payment.asset)} ·
            paid
          </span>
        ) : order.cashReceipt ? (<span>{t('Cash recorded')}</span>) : exactQuote && order.quote ? (
          <span className="m-conversion">
            {cryptoAmount(order.quote.amountAtomic, order.quote.asset)} · exact
            quote
          </span>
        ) : (
          <p className="m-muted">Choose an asset to obtain a current quote.</p>
        )}
        {!demo && <StockReservationStatus reservation={order.stockReservation} />}
        <Lines order={receipt} />
        {order.payment && (
          <small className="m-tx">
            {demo
              ? 'Simulated payment · no transaction sent'
              : `${networkName(order.payment.network)} · tx ${order.payment.hash}`}
          </small>
        )}
      </section>
      {!paid &&
        !['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.status) && (
          <>
            <span className="m-label">I’LL PAY WITH</span>
            <div className="m-asset-choice">
              {(['NIM', 'USDT'] as const).map((a) => (
                <button
                  key={a}
                  aria-pressed={asset === a}
                  disabled={
                    busy ||
                    Boolean(pending) ||
                    Boolean(signing) ||
                    Boolean(order.quote && order.quote.asset !== a)
                  }
                  onClick={() => {
                    setAsset(a)
                    setNotice(null)
                  }}
                >
                  {a}
                  <small>{a === 'NIM' ? 'Nimiq' : 'Polygon'}</small>
                </button>
              ))}
            </div>
            {!demo && order.quote && (
              <p className="m-muted">
                Reserved for {order.quote.asset} and your selected wallet. Ask
                the cashier to update your order to change payment asset.
              </p>
            )}
            {!demo && exactQuote && order.quote && (
              <dl className="m-quote">
                <dt>Recipient</dt>
                <dd>{order.quote.recipient}</dd>
                <dt>Network</dt>
                <dd>{networkName(order.quote.network)}</dd>
                <dt>Rate checked</dt>
                <dd>{new Date(order.quote.rateAt).toLocaleTimeString()}</dd>
                <dt>Quote expires</dt>
                <dd>{new Date(order.quote.expiresAt).toLocaleTimeString()}</dd>
                <dt>Network fee</dt>
                <dd>Shown by your wallet before approval</dd>
              </dl>
            )}
            {demo ? (
              <button
                className="m-primary"
                disabled={busy}
                onClick={() => void pay()}
              >
                Simulate payment
                <span>→</span>
              </button>
            ) : signing ? (
              <RecoverTransaction
                busy={busy}
                onRestore={(hash) =>
                  void run(async () => {
                    const saved = restoreSubmittedHash(pendingKey, hash)
                    setPending(saved)
                    await register(saved)
                  })
                }
              />
            ) : pending ? (
              <div className="m-soft">
                <p>
                  Your wallet submitted a transaction. Verification is pending.
                  We’ll never submit it a second time.
                </p>
                <small className="m-tx">{pending.hash}</small>
                <button
                  className="m-primary"
                  disabled={busy}
                  onClick={() => void run(() => register(pending))}
                >
                  Check submitted payment →
                </button>
                <RecoverTransaction busy={busy} onRestore={(hash) => void run(async () => {
                  const saved = restoreSubmittedHash(pendingKey, hash, pending)
                  setPending(saved)
                  await register(saved)
                })} />
              </div>
            ) : order.status === 'PAYMENT_PENDING' ? (
              <div className="m-soft">
                Your submitted payment is being verified. Keep this checkout
                open.
              </div>
            ) : exactQuote ? (
              <button
                className="m-primary"
                disabled={busy}
                onClick={() => void pay()}
              >
                Approve exact amount in wallet →
              </button>
            ) : (
              <button
                className="m-primary"
                disabled={busy}
                onClick={() => void quote()}
              >
                Get exact {asset} quote →
              </button>
            )}
            <p className="m-security">
              ◇ Directly to the venue’s wallet.
              <br />
              <small>
                {demo
                  ? 'No wallet connection. No signing. No funds sent.'
                  : 'You approve the displayed amount in your own wallet. A payment is accepted only after verification.'}
              </small>
            </p>
          </>
        )}
      {!paid &&
        signing &&
        ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.status) && (
          <RecoverTransaction
            busy={busy}
            onRestore={(hash) =>
              void run(async () => {
                const saved = restoreSubmittedHash(pendingKey, hash)
                setPending(saved)
                await register(saved)
              })
            }
          />
        )}
      {order.status === 'CANCELLED' && (
        <div className="m-soft">
          This order was cancelled. Please ask at the counter.
        </div>
      )}
      {demo && paid && (
        <section className="m-soft">
          <span className="m-label">DEMO · CASHIER CONTROLS</span>
          {['PREPARING', 'READY'].includes(order.status) && (
            <button
              className="m-primary"
              disabled={busy}
              onClick={() => void run(() => demo.advance(order.id))}
            >
              {order.status === 'PREPARING'
                ? 'Simulate ready for pickup'
                : 'Simulate collection'}{' '}
              →
            </button>
          )}
          {order.status === 'READY' && (
            <p className="m-muted">
              Example readiness signal · no 1-luna transfer or system
              notification is sent.
            </p>
          )}
        </section>
      )}
      {!demo && paid && (
        <p className="m-muted m-centered">
          Keep this page open to follow your order. Readiness signals depend on
          venue configuration and device support.
        </p>
      )}
    </section>
  )
}

function ManagerTools({ api, venue, employee, products, reload, onQueue }: {
    api: MerchantApi;
    venue: MerchantVenue;
    employee: AccessEmployee;
    products: MerchantProduct[];
    reload: () => Promise<void>;
    onQueue: () => void;
}) {
    const [report, setReport] = useState<MerchantReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const menu = hasPermission(employee, 'menu.manage');
    const reports = hasPermission(employee, 'reports.view');
    const audit = hasPermission(employee, 'audit.view');
    useEffect(() => { let active = true; if (reports)
        void api.venueReport(venue.id).then(value => { if (active)
            setReport(value); }).catch(error => { if (active)
            setError(merchantError(error)); }); return () => { active = false; }; }, [api, venue.id, reports]);
    if (!menu && !reports && !audit)
        return <section className="m-panel">
      <p>{t('Operational access is unavailable. Ask the owner.')}
      </p>
      </section>;
    return <>
      <h2>{t('Manage your venue')}
      </h2>{error && <p role="alert">{error}
      </p>}{menu && <MenuWorkspaceBoard api={api} venue={venue} scope={`${venue.id}:${employee.id}:${JSON.stringify(employee.permissions)}`} products={products} cashier onPublished={reload}/>}{reports && <><VenueOperations api={api} venueId={venue.id} scope={`${venue.id}:${employee.id}:${JSON.stringify(employee.permissions)}`} cashier onAction={onQueue}/><Report report={report} title={t('Venue report')}/></>}{audit && <AuditTrail api={api} venueId={venue.id} cashier/>}
      </>;
}
