import { TaskPhotos } from './TaskPhotos'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { merchantError } from './errors';
import type { MerchantApi } from './client';
import type { MerchantEmployee } from './contract';
import type {TaskInstance, TaskTemplate as Template, TaskTemplateInput as TemplateInput} from '@nimble/shared';
export type StaffTask = TaskInstance;
type Schedule = TemplateInput['schedule'];
const blank: TemplateInput = { title: '', instructions: '', category: 'CLEANING', schedule: 'ONCE', timeZone: 'Europe/Warsaw', dueTime: '18:00', scheduledFor: null, assigneeEmployeeId: null, reviewerEmployeeId: null, requiredPhotos: 'NONE', active: true };
const statuses: Record<string, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', SUBMITTED: 'Awaiting review', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', SKIPPED: 'Skipped' };
const makeKey = () => crypto.randomUUID();
export function TaskBoard({ api, venueId, scope, employeeId, manage = false, owner = false, employees = [], viewPhotos = false, renderEvidence, onlyTaskId }: {
    api: MerchantApi;
    venueId: string;
    scope: string;
    employeeId?: string;
    manage?: boolean;
    owner?: boolean;
    employees?: MerchantEmployee[];
    viewPhotos?: boolean;
    onlyTaskId?: string;
    renderEvidence?: (task: StaffTask, refresh: () => Promise<void>) => ReactNode;
}) {
    const [tasks, setTasks] = useState<StaffTask[]>([]), [templates, setTemplates] = useState<Template[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const [loading,setLoading]=useState(true);
    const errorFocus=useRef<HTMLParagraphElement|null>(null);
    useEffect(()=>{if(error)errorFocus.current?.focus()},[error]);
    const [editor, setEditor] = useState<Template | 'new' | null>(null);
    const [people, setPeople] = useState<MerchantEmployee[]>(employees);
    const generation = useRef(0), locked = useRef(false), requestNumber = useRef(0);
    const auth = owner ? 'owner' : 'cashier';
    const path = `/venues/${venueId}`;
    const load = useCallback(async () => { const g = generation.current, n = ++requestNumber.current; setLoading(true);try{const result = await api.request<{
        tasks: StaffTask[];
    }>(auth, 'GET', `${path}/tasks`); if (g === generation.current && n === requestNumber.current)
        setTasks(onlyTaskId ? result.tasks.filter(t=>t.id===onlyTaskId) : result.tasks); if (manage) {
        const [result, staff] = await Promise.all([api.request<{
                templates: Template[];
            }>(auth, 'GET', `${path}/task-templates`), api.request<{
                employees: MerchantEmployee[];
            }>(auth, 'GET', `${path}/task-people`)]);
        if (g === generation.current && n === requestNumber.current) {
            setTemplates(result.templates);
            setPeople(staff.employees);
        }
    } if(g===generation.current&&n===requestNumber.current)setError(null);
    }finally{if(g===generation.current&&n===requestNumber.current)setLoading(false)} }, [api, auth, path, manage, onlyTaskId]);
    useEffect(() => {
        const g = ++generation.current;
        let running = false;
        setLoading(true);setTasks([]); setTemplates([]); setPeople([]); setEditor(null); setError(null); setBusy(false);
        locked.current = false;
        const refresh = async () => {
            if (locked.current || running) return;
            running = true;
            const expectedRequest = requestNumber.current + 1;
            try { await load(); }
            catch (error) { if (g === generation.current && expectedRequest === requestNumber.current) setError(merchantError(error)); }
            finally { running = false; }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), 5000);
        return () => { generation.current++; requestNumber.current++; clearInterval(timer); };
    }, [load, scope]);
    const run = async (action: () => Promise<unknown>, done?: () => void) => { if (locked.current)
        return; locked.current = true; const g = generation.current; requestNumber.current++; setBusy(true); setError(null); try {
        await action();
        if (g !== generation.current)
            return;
        await load();
        if (g === generation.current)
            done?.();
    }
    catch (e) {
        if (g === generation.current)
            setError(merchantError(e));
    }
    finally {
        if (g === generation.current) {
            locked.current = false;
            setBusy(false);
        }
    } };
    return <section className="m-panel"><h2>{t('Staff tasks')}</h2>{loading&&<p role="status">{t('Loading staff tasks…')}</p>}{error && <p role="alert" tabIndex={-1} ref={errorFocus}>{error} <button disabled={busy} onClick={() => void run(load)}>{t('Retry')}</button></p>}
 {manage && <><button onClick={() => setEditor('new')}>{t('Create task template')}</button>{templates.map(template => <div className="m-line" key={template.id}><span>{template.title} · {t(template.schedule === 'DAILY' ? 'Daily' : template.schedule === 'SHIFT' ? 'Every shift' : 'One-off')}{!template.active && ` · ${t('Inactive')}`}</span><button onClick={() => setEditor(template)}>{t('Edit')}</button></div>)}</>}
 {editor && <TemplateForm key={editor === 'new' ? 'new' : `${editor.id}:${editor.revision}`} initial={editor === 'new' ? undefined : editor} employees={manage ? people : employees} busy={busy} onClose={() => setEditor(null)} onSave={(input, reason, key) => run(() => api.request(auth, editor === 'new' ? 'POST' : 'PATCH', `${path}/task-templates${editor === 'new' ? '' : `/${editor.id}`}`, editor === 'new' ? { ...input, idempotencyKey: key } : { ...input, revision: editor.revision, reason }), () => setEditor(null))}/>}
 {!loading&&!error&&!tasks.length && <p className="m-muted">{t('No staff tasks yet.')}</p>}
 {tasks.map(task => <TaskCard key={`${scope}:${task.id}`} task={task} employeeId={employeeId} manage={manage} owner={owner} busy={busy} employees={manage ? people : employees} evidence={renderEvidence ? renderEvidence(task, load) : (owner || task.completedBy === `employee:${employeeId}` || (manage && viewPhotos)) && task.completedBy ? <TaskPhotos key={`${scope}:${task.id}:${viewPhotos}`} api={api} venueId={venueId} taskId={task.id} scope={scope} submissionNumber={task.submissionNumber} cashier={!owner} editable={(owner ? Boolean(task.completedBy?.startsWith('owner:')) : task.completedBy === `employee:${employeeId}`) && ['IN_PROGRESS','CHANGES_REQUESTED'].includes(task.status)} /> : null} assignment={(manage || owner) && task.status === 'TODO' ? <TaskAssignment key={`${task.id}:${task.revision}`} task={task} people={people} busy={busy} onSave={(assigneeEmployeeId, reviewerEmployeeId, reason, idempotencyKey) => run(() => api.request(auth, 'POST', `${path}/tasks/${task.id}/actions`, {action:'ASSIGN',revision:task.revision,assigneeEmployeeId,reviewerEmployeeId,reason,idempotencyKey}))}/> : null} onAction={(action, reason, comment, key) => run(() => api.request(auth, 'POST', `${path}/tasks/${task.id}/actions`, { action, revision: task.revision, idempotencyKey: key, reason: reason.trim() || undefined, comment: comment.trim() || undefined }))}/>)}
 </section>;
}
function TaskCard({ task, employeeId, manage, owner, busy, employees, evidence, assignment, onAction }: {
    task: StaffTask;
    employeeId?: string;
    manage: boolean;
    owner: boolean;
    busy: boolean;
    employees: MerchantEmployee[];
    evidence: ReactNode;
    assignment: ReactNode;
    onAction: (action: string, reason: string, comment: string, key: string) => Promise<void>;
}) {
    const [reason, setReason] = useState(''), [comment, setComment] = useState('');
    const retry = useRef<{
        signature: string;
        key: string;
    } | null>(null);
    const action = (name: string) => { const signature = JSON.stringify([task.revision, name, reason, comment]); if (retry.current?.signature !== signature)
        retry.current = { signature, key: makeKey() }; return onAction(name, reason, comment, retry.current.key); };
    const ownerPerformed = owner && Boolean(task.completedBy?.startsWith('owner:'));
    const assigned = owner ? ownerPerformed || !task.assigneeEmployeeId : Boolean(employeeId && task.assigneeEmployeeId === employeeId);
    const review = owner ? !ownerPerformed : manage && task.assigneeEmployeeId !== employeeId && task.completedBy !== `employee:${employeeId}` && (!task.reviewerEmployeeId || task.reviewerEmployeeId === employeeId);
    const done = ['APPROVED', 'SKIPPED'].includes(task.status);
    return <article className="m-panel"><div className="m-row"><h3>{task.title}</h3><strong>{t(statuses[task.status] ?? task.status)}</strong>{task.ownerDeclared && <span className="r-pill">{t(task.photoExceptionReason ? 'Owner accepted photo exception' : 'Owner declaration · no independent review')}</span>}</div><p style={{ whiteSpace: 'pre-wrap' }}>{task.instructions}</p><p>{t('Due')}: {new Date(task.dueAt).toLocaleString()}</p><p>{t('Assignee')}: {employees.find(e => e.id === task.assigneeEmployeeId)?.name ?? (assigned ? t('You') : task.assigneeEmployeeId ?? t('Unassigned'))}</p>{task.reviewComment && <p>{t(task.photoExceptionReason ? 'Photo exception reason' : 'Reviewer comment')}: {task.photoExceptionReason ?? task.reviewComment}</p>}{task.submissionComment && <p>{t('Completion comment')}: {task.submissionComment}</p>}{evidence}{assignment}
 {!done && <fieldset disabled={busy}><label>{t('Completion comment')}<textarea value={comment} onChange={e => setComment(e.target.value)}/></label><label>{t('Reason')}<input value={reason} onChange={e => setReason(e.target.value)}/></label><div className="m-row">
 {!task.assigneeEmployeeId && !owner && <button onClick={() => void action('CLAIM')}>{t('Claim task')}</button>}
 {assigned && ['TODO', 'CHANGES_REQUESTED'].includes(task.status) && <button onClick={() => void action('START')}>{t('Start task')}</button>}
 {assigned && (!owner || ownerPerformed) && ['IN_PROGRESS','CHANGES_REQUESTED'].includes(task.status) && <button onClick={() => void action('SUBMIT')}>{t('Submit for review')}</button>}
 {review && task.status === 'SUBMITTED' && <><button onClick={() => void action('APPROVE')}>{t('Approve task')}</button><button disabled={!reason.trim()} onClick={() => void action('REQUEST_CHANGES')}>{t('Request changes')}</button></>}
 {(manage || owner) && <button disabled={!reason.trim()} onClick={() => void action('SKIP')}>{t('Skip with reason')}</button>}
 {owner && task.requiredPhotos !== 'NONE' && ['IN_PROGRESS','CHANGES_REQUESTED','SUBMITTED'].includes(task.status) && <button disabled={!reason.trim()} onClick={() => void action('OWNER_EXCEPTION')}>{t('Approve photo exception')}</button>}
 {ownerPerformed && task.status === 'SUBMITTED' && <button disabled={!reason.trim()} onClick={() => void action('OWNER_DECLARE')}>{t('Record owner declaration')}</button>}
 </div></fieldset>}</article>;
}
function TemplateForm({ initial, employees, busy, onClose, onSave }: {
    initial?: Template;
    employees: MerchantEmployee[];
    busy: boolean;
    onClose: () => void;
    onSave: (input: TemplateInput, reason: string, key: string) => Promise<void>;
}) {
    const [draft, setDraft] = useState<TemplateInput>(initial ?? blank), [reason, setReason] = useState('');
    const key = useRef(makeKey());
    const change = (patch: Partial<TemplateInput>) => { key.current = makeKey(); setDraft(d => ({ ...d, ...patch })); };
    return <form className="m-panel" onSubmit={e => { e.preventDefault(); void onSave({ ...draft, scheduledFor: draft.schedule === 'ONCE' ? draft.scheduledFor : null }, reason, key.current); }}><h3>{t(initial ? 'Edit task template' : 'Create task template')}</h3><fieldset disabled={busy}>
 <label>{t('Task title')}<input required value={draft.title} onChange={e => change({ title: e.target.value })}/></label><label>{t('Instructions')}<textarea required value={draft.instructions} onChange={e => change({ instructions: e.target.value })}/></label>
 <label>{t('Task category')}<select value={draft.category} onChange={e => change({ category: e.target.value as TemplateInput['category'] })}>{Object.entries({ OPENING: 'Opening', CLOSING: 'Closing', CLEANING: 'Cleaning', OTHER: 'Other' }).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></label>
 <label>{t('Schedule')}<select value={draft.schedule} onChange={e => change({ schedule: e.target.value as Schedule })}><option value="ONCE">{t('One-off')}</option><option value="DAILY">{t('Daily')}</option><option value="SHIFT">{t('Every shift')}</option></select></label>
 {draft.schedule === 'ONCE' ? <label>{t('Due')}<input type="datetime-local" required value={draft.scheduledFor ? new Date(new Date(draft.scheduledFor).getTime() - new Date(draft.scheduledFor).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={e => change({ scheduledFor: e.target.value ? new Date(e.target.value).toISOString() : null })}/></label> : <><label>{t('Due time')}<input type="time" required value={draft.dueTime} onChange={e => change({ dueTime: e.target.value })}/></label><label>{t('Time zone')}<input required value={draft.timeZone} onChange={e => change({ timeZone: e.target.value })}/></label></>}
 {(['assigneeEmployeeId', 'reviewerEmployeeId'] as const).map((field, i) => <label key={field}>{t(i ? 'Reviewer' : 'Assignee')}<select value={draft[field] ?? ''} onChange={e => change({ [field]: e.target.value || null })}><option value="">{t('Unassigned')}</option>{employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>)}
 <label>{t('Required task photos')}<select value={draft.requiredPhotos} onChange={event=>change({requiredPhotos:event.target.value as TemplateInput['requiredPhotos']})}><option value="NONE">{t('No photos required')}</option><option value="BEFORE">{t('Before task')}</option><option value="AFTER">{t('After task')}</option><option value="BOTH">{t('Before and after task')}</option></select></label>
 <label><input type="checkbox" checked={draft.active} onChange={e => change({ active: e.target.checked })}/>{t('Active')}</label>{initial && <label>{t('Reason')}<input required value={reason} onChange={e => { key.current = makeKey(); setReason(e.target.value); }}/></label>}
 <button type="submit" disabled={!draft.title.trim() || !draft.instructions.trim() || (Boolean(initial) && !reason.trim())}>{t('Save task template')}</button><button type="button" onClick={onClose}>{t('Cancel')}</button>
 </fieldset></form>;
}

function TaskAssignment({task,people,busy,onSave}:{task:StaffTask;people:MerchantEmployee[];busy:boolean;onSave:(assignee:string|null,reviewer:string|null,reason:string,key:string)=>Promise<void>}) {
    const [assignee,setAssignee]=useState(task.assigneeEmployeeId??'');
    const [reviewer,setReviewer]=useState(task.reviewerEmployeeId??'');
    const [reason,setReason]=useState('');
    const key=useRef(makeKey());
    return <details><summary>{t('Change task assignment')}</summary><form onSubmit={event=>{event.preventDefault();void onSave(assignee||null,reviewer||null,reason.trim(),key.current)}}><fieldset disabled={busy}>
        <label>{t('Assignee')}<select value={assignee} onChange={event=>{setAssignee(event.target.value);key.current=makeKey()}}><option value="">{t('Unassigned')}</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>{t('Reviewer')}<select value={reviewer} onChange={event=>{setReviewer(event.target.value);key.current=makeKey()}}><option value="">{t('Unassigned')}</option>{people.filter(person=>person.id!==assignee).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>{t('Reason for reassignment')}<input required value={reason} onChange={event=>{setReason(event.target.value);key.current=makeKey()}}/></label><button disabled={!reason.trim()||Boolean(assignee&&reviewer===assignee)}>{t('Save assignment')}</button>
    </fieldset></form></details>
}
