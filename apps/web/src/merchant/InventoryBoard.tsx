import {PurchaseOrdersBoard} from './PurchaseOrdersBoard';
import {InventoryLotsBoard} from './InventoryLotsBoard';
import {StockMenuImpact} from './StockMenuImpact';
import {ProductionBoard} from './ProductionBoard';
import { StockOperations } from './StockOperations';
import { InventoryBarcodeScanner } from './InventoryBarcodeScanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { merchantError } from './errors';
import type { MerchantApi } from './client';
import type { InventoryItem as Item, InventoryMovement as Movement } from '@nimble/shared';
export function InventoryBoard({ api, venueId, scope, owner = false, manage = false, canCosts = false, currency = 'EUR' }: {
    api: MerchantApi;
    venueId: string;
    scope: string;
    owner?: boolean;
    manage?: boolean;
    canCosts?: boolean;
    currency?: 'EUR' | 'USD' | 'PLN';
}) {
    const [items, setItems] = useState<Item[]>([]), [selected, setSelected] = useState<string | null>(null), [history, setHistory] = useState<Movement[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [adding, setAdding] = useState(false);
    const [loading,setLoading]=useState(true);
    const errorFocus=useRef<HTMLParagraphElement|null>(null);
    useEffect(()=>{if(error)errorFocus.current?.focus()},[error]);
    const [page, setPage] = useState(0), [more, setMore] = useState(false), [historyPage, setHistoryPage] = useState(0), [historyMore, setHistoryMore] = useState(false);
    const [settingsRevision,setSettingsRevision]=useState(1),[showOperations,setShowOperations]=useState(false),[showProduction,setShowProduction]=useState(false),[showImpact,setShowImpact]=useState(false),[showLots,setShowLots]=useState(false),[showPurchases,setShowPurchases]=useState(false);
    const [barcode,setBarcode]=useState(''), [lookup,setLookup]=useState(''), [lookupBusy,setLookupBusy]=useState(false);
    const lookupRequest=useRef(0);
    const [name, setName] = useState(''), [unit, setUnit] = useState<Item['unit']>('PIECE'), [tracked, setTracked] = useState(true), [saleAvailable,setSaleAvailable]=useState(true), [opening, setOpening] = useState('0'), [threshold, setThreshold] = useState('0'), [delta, setDelta] = useState(''), [reason, setReason] = useState('');
    const selection = useRef(selected);
    selection.current = selected;
    const historyRequest = useRef(0);
    const generation = useRef(0), requests = useRef(0), lock = useRef(false), retry = useRef<{
        signature: string;
        key: string;
    } | null>(null);
    const path = `/venues/${venueId}/inventory`, auth = owner ? 'owner' : 'cashier', current = items.find(i => i.id === selected);
    const load = useCallback(async (nextPage = 0) => { const g = generation.current, n = ++requests.current;setLoading(true);try{const result = await api.request<{
        items: Item[];
        hasMore: boolean;
    }>(auth, 'GET', `${path}?page=${nextPage}&limit=50`); if (g === generation.current && n === requests.current) {
        setItems(old => nextPage ? [...old, ...result.items] : result.items);
        setPage(nextPage);
        setMore(result.hasMore);
    }}finally{if(g===generation.current&&n===requests.current)setLoading(false)} }, [api, auth, path]);
    useEffect(() => { const g = ++generation.current; requests.current++; setLoading(true);setItems([]); setSelected(null); setLookup(''); setBarcode(''); setShowOperations(false); setShowProduction(false); setShowImpact(false); setShowLots(false); setShowPurchases(false); setLookupBusy(false); lookupRequest.current++; setHistory([]); setMore(false); setHistoryMore(false); setHistoryPage(0); setPage(0); setError(null); setBusy(false); setAdding(false); setReason(''); retry.current = null; lock.current = false; void load().catch(e => { if (g === generation.current) {
        setItems([]);
        setError(merchantError(e));
    } }); return () => { generation.current++; requests.current++; }; }, [load, scope, manage, canCosts]);
    useEffect(() => { historyRequest.current++; setHistory([]); setHistoryMore(false); setHistoryPage(0); if (!selected)
        return; const g = generation.current; let active = true; void api.request<{
        movements: Movement[];
        hasMore: boolean;
    }>(auth, 'GET', `${path}/${selected}/movements?page=0&limit=50`).then(r => { if (active && g === generation.current) {
        setHistory(r.movements);
        setHistoryMore(r.hasMore);
    } }).catch(e => { if (active && g === generation.current)
        setError(merchantError(e)); }); return () => { active = false; }; }, [api, auth, path, selected, items]);
    const choose = (item: Item) => { setSelected(item.id); setSettingsRevision(item.revision); setName(item.name); setBarcode(item.barcode ?? ''); setTracked(item.tracked); setSaleAvailable(item.available!==false); setThreshold(String(item.threshold)); setReason(''); setDelta(''); setAdding(false); };
    const refresh = async () => { const g = generation.current; setError(null); try {
        await load();
    }
    catch (e) {
        if (g === generation.current) {
            setItems([]);
            setSelected(null);
            setHistory([]);
            setError(merchantError(e));
        }
    } };
    const write = async (endpoint: string, body: Record<string, unknown>, idempotent = true) => {
        if (lock.current)
            return;
        if (!reason.trim()) {
            setError(t('Add a reason before continuing.'));
            return;
        }
        const g = generation.current, payload = { ...body, reason: reason.trim() }, signature = JSON.stringify([endpoint, payload]);
        if (retry.current?.signature !== signature)
            retry.current = { signature, key: crypto.randomUUID() };
        lock.current = true;
        setBusy(true);
        setError(null);
        requests.current++;
        try {
            await api.request(auth, idempotent ? 'POST' : 'PATCH', endpoint, { ...payload, ...(idempotent ? { idempotencyKey: retry.current.key } : {}) });
            if (g !== generation.current)
                return;
            retry.current = null;
            setReason('');
            setDelta('');
            setAdding(false);
            await load();
            if(!idempotent && g===generation.current)setSelected(null);
        }
        catch (e) {
            if (g === generation.current) {
                setError(merchantError(e));
                if ((e as {
                    status?: number;
                }).status === 403) {
                    setItems([]);
                    setSelected(null);
                    setHistory([]);
                }
            }
        }
        finally {
            if (g === generation.current) {
                lock.current = false;
                setBusy(false);
            }
        }
    };
    const findBarcode = async (value: string) => {
        if(!value.trim()) return;
        const g=generation.current,n=++lookupRequest.current; setLookup(value.trim());setLookupBusy(true);setError(null);
        try {
            const result=await api.request<{items:Item[]}>(auth,'GET',`${path}/lookup?barcode=${encodeURIComponent(value.trim())}`);
            if(g!==generation.current || n!==lookupRequest.current)return;
            if(!result.items.length){setError(t('No stock item matches this barcode.'));return;}
            setItems(old=>[...old,...result.items.filter(i=>!old.some(o=>o.id===i.id))]);choose(result.items[0]);
        }catch(e){if(g===generation.current&&n===lookupRequest.current)setError(merchantError(e));}
        finally{if(g===generation.current&&n===lookupRequest.current)setLookupBusy(false);}
    };
    return <section className="m-panel"><h2>{t('Inventory')}</h2><p>{t('Linked, tracked resources are reserved at checkout and deducted after counter payment confirmation or remote order acceptance. Unlinked and untracked resources are unaffected.')}</p>{loading&&<p role="status">{t('Loading stock…')}</p>}{!loading&&!error&&!items.length&&<p>{t('No stock items yet.')}</p>}{error && <p role="alert" tabIndex={-1} ref={errorFocus}>{error}</p>}<button disabled={busy} onClick={() => void refresh()}>{t('Refresh stock')}</button>
 <form onSubmit={e=>{e.preventDefault();void findBarcode(lookup);}}><label>{t('Find stock item by barcode')}<input value={lookup} disabled={busy || lookupBusy} maxLength={100} onChange={e=>setLookup(e.target.value)}/></label><button disabled={busy||lookupBusy||!lookup.trim()}>{t('Find barcode')}</button></form><InventoryBarcodeScanner key={`${venueId}:${scope}:${manage}:${canCosts}`} disabled={busy||lookupBusy} onRead={value=>void findBarcode(value)}/>
 <div className="m-grid">{items.map(item => <article className="m-panel" key={item.id}><button disabled={busy} aria-pressed={selected === item.id} onClick={() => choose(item)}>{item.name}</button><p>{t('Physical stock')}: {item.quantity}{item.available===false&&<strong> · {t('Blocked for new sales')}</strong>}</p><p>{t('Reserved stock')}: {item.reservedQuantity ?? t('Unavailable')}</p><p>{t('Pending losses')}: {item.pendingLossQuantity ?? t('Unavailable')}</p><p>{t('Available to sell')}: {item.availableQuantity ?? t('Unavailable')} {t(({PIECE:'pieces',PORTION:'portions',MILLIGRAM:'mg',MILLILITRE:'ml'})[item.unit])}</p><small>{t(item.tracked ? 'Stock tracking enabled' : 'Stock tracking paused')}</small>{item.tracked && item.availableQuantity !== undefined && item.availableQuantity <= item.threshold && <p>{t('Low stock')}</p>}</article>)}</div>
 {manage && <button disabled={busy} onClick={() => { setAdding(true); setSelected(null); setName(''); setBarcode(''); setUnit('PIECE'); setTracked(true); setSaleAvailable(true); setOpening('0'); setThreshold('0'); setReason(''); }}>{t('Add stock item')}</button>}
 {manage && (adding || current) && <form onSubmit={e => { e.preventDefault(); void write(adding ? path : `${path}/${current!.id}`, adding ? { name, unit, tracked, available:saleAvailable, barcode: barcode.trim() || null, openingQuantity: Number(opening), threshold: Number(threshold) } : { name, tracked, available:saleAvailable, barcode: barcode.trim() || null, threshold: Number(threshold), revision: settingsRevision }, adding); }}><h3>{t(adding ? 'Add stock item' : 'Stock settings')}</h3>
 <label>{t('Stock item name')}<input required maxLength={120} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label>
 <label>{t('Item barcode')}<input maxLength={100} value={barcode} disabled={busy} onChange={e=>setBarcode(e.target.value)}/></label>{adding && <><label>{t('Stock unit')}<select value={unit} disabled={busy} onChange={e => setUnit(e.target.value as Item['unit'])}><option value="PIECE">{t('pieces')}</option><option value="PORTION">{t('portions')}</option><option value="MILLIGRAM">mg</option><option value="MILLILITRE">ml</option></select></label><label>{t('Opening quantity')}<input type="number" required min="0" max="2147483647" step="1" value={opening} disabled={busy} onChange={e => setOpening(e.target.value)}/></label></>}
 <label>{t('Low stock threshold')}<input type="number" required min="0" max="2147483647" step="1" value={threshold} disabled={busy} onChange={e => setThreshold(e.target.value)}/></label><label><input type="checkbox" checked={saleAvailable} disabled={busy} onChange={e=>setSaleAvailable(e.target.checked)}/>{t('Allow new sales using this resource')}</label><label><input type="checkbox" checked={tracked} disabled={busy} onChange={e => setTracked(e.target.checked)}/>{t('Track stock')}</label><label>{t('Reason')}<input value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)}/></label><button disabled={busy}>{t(adding ? 'Create stock item' : 'Save stock settings')}</button></form>}
 {current && <><button type="button" disabled={busy} aria-expanded={showLots} onClick={()=>setShowLots(v=>!v)}>{t('Stock lots and expiry')}</button>{showLots&&<InventoryLotsBoard api={api} venueId={venueId} itemId={current.id} scope={scope} owner={owner} manage={manage} revision={current.revision}/>}<h3>{t('Stock movements')}</h3>{manage && <form onSubmit={e => { e.preventDefault(); void write(`${path}/${current.id}/movements`, { delta: Number(delta), revision: current.revision }); }}><label>{t('Quantity change')}<input type="number" required min="-2147483647" max="2147483647" step="1" value={delta} disabled={busy} onChange={e => setDelta(e.target.value)}/></label><p>{t('Use deliveries, losses and stocktakes below for those operations. Manual changes are for other corrections.')}</p><button disabled={busy || !delta || Number(delta) === 0}>{t('Record stock change')}</button></form>}
 {historyMore && <button disabled={busy} onClick={() => { const g = generation.current, id = selected, next = historyPage + 1, n = ++historyRequest.current; void api.request<{
            movements: Movement[];
            hasMore: boolean;
        }>(auth, 'GET', `${path}/${id}/movements?page=${next}&limit=50`).then(r => { if (g === generation.current && id === selection.current && n === historyRequest.current) {
            setHistory(old => [...old, ...r.movements.filter(m => !old.some(existing => existing.id === m.id))]);
            setHistoryPage(next);
            setHistoryMore(r.hasMore);
        } }).catch(e => { if (g === generation.current && id === selection.current && n === historyRequest.current)
            setError(merchantError(e)); }); }}>{t('Load more stock movements')}</button>}{history.map(m => <article key={m.id}><strong>{m.delta > 0 ? '+' : ''}{m.delta}</strong> · {m.actorName} · <time>{new Date(m.createdAt).toLocaleString()}</time><p>{m.reason}</p>{m.lotAllocations?.map(l=><p key={l.lotId}>{l.label||l.lotId}: {l.delta} · {l.expiresAt??t('Unknown expiry')}</p>)}{manage && ['OPENING','ADJUSTMENT'].includes(m.kind) && !m.reversedByMovementId && !history.some(r => r.reversesMovementId === m.id) && <button disabled={busy} onClick={() => void write(`${path}/${current.id}/movements/${m.id}/reverse`, { revision: current.revision })}>{t('Reverse stock movement')}</button>}</article>)}</>}
 {more && <button disabled={busy} onClick={() => { const g = generation.current; void load(page + 1).catch(e => { if (g === generation.current)
        setError(merchantError(e)); }); }}>{t('Load more stock items')}</button>}
 {manage&&<><button type="button" disabled={busy} aria-expanded={showPurchases} onClick={()=>setShowPurchases(v=>!v)}>{t('Purchases and replenishment')}</button>{showPurchases&&<PurchaseOrdersBoard api={api} venueId={venueId} scope={scope} owner={owner} canCosts={canCosts} onChanged={refresh}/>}<button type="button" disabled={busy} aria-expanded={showImpact} onClick={()=>setShowImpact(v=>!v)}>{t('Ingredient availability impact')}</button>{showImpact&&<StockMenuImpact api={api} venueId={venueId} scope={scope} owner={owner} revision={items.map(i=>`${i.id}:${i.revision}`).join(',')}/>}<button type="button" disabled={busy} aria-expanded={showProduction} onClick={()=>setShowProduction(v=>!v)}>{t('Production and preparations')}</button>{showProduction&&<ProductionBoard api={api} venueId={venueId} scope={scope} owner={owner} items={items} onChanged={refresh}/>}</>}
 <button type="button" disabled={busy} aria-expanded={showOperations} onClick={()=>setShowOperations(true)}>{t('Deliveries, losses and stocktakes')}</button>{showOperations && <StockOperations api={api} venueId={venueId} scope={scope} owner={owner} manage={manage} canCosts={canCosts} items={items} currency={currency} onChanged={refresh}/>}
 </section>;
}
