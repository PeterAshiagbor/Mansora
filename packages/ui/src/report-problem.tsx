import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Field, Icon, Modal, Textarea } from './index';

/**
 * "Tell Mansora about a problem" (owner request 2026-11-14). A button that stays on every screen. The person
 * writes what went wrong and can point at the part of the screen it is about; reports reach Mansora in one email
 * every evening at 7pm. Only labels of what was pointed at are sent, never what someone typed into a field.
 */
export interface ProblemArea { label?: string; text?: string; path?: string; x?: number; y?: number; width?: number; height?: number; viewport?: string }
export interface ProblemReport { description: string; severity: 'blocking' | 'normal' | 'idea'; page?: string; area?: ProblemArea | null }

const MEANINGFUL = 'button,a,[role="tab"],[role="button"],[role="dialog"],input,select,textarea,label,th,h1,h2,h3,legend,[aria-label],section,article,form,table,nav,header,footer,main';
const SHOWS_TEXT = new Set(['BUTTON', 'A', 'H1', 'H2', 'H3', 'TH', 'LABEL', 'LEGEND']);
const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n) || undefined;

function nameOf(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return clip(aria, 80);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const wrapping = el.closest('label');
    return clip((id as HTMLElement | null)?.innerText ?? wrapping?.innerText ?? el.getAttribute('placeholder') ?? el.name, 80);
  }
  const titled = el.getAttribute('title');
  if (titled) return clip(titled, 80);
  if (SHOWS_TEXT.has(el.tagName)) return clip((el as HTMLElement).innerText, 80);
  const heading = el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > header h2, :scope > header h3');
  return clip((heading as HTMLElement | null)?.innerText, 80);
}

/** Describe an element by its role and visible label, never by what was typed into it. */
export function describeArea(target: Element): ProblemArea {
  const el = target.closest(MEANINGFUL) ?? target;
  const parts: string[] = [];
  for (let node: Element | null = el, depth = 0; node && depth < 5 && node !== document.body; node = node.parentElement?.closest(MEANINGFUL) ?? null, depth++) {
    const n = nameOf(node);
    parts.unshift(`${node.getAttribute('role') ?? node.tagName.toLowerCase()}${n ? ` "${n}"` : ''}`);
  }
  const r = el.getBoundingClientRect();
  return {
    label: nameOf(el) ?? el.getAttribute('role') ?? el.tagName.toLowerCase(),
    text: SHOWS_TEXT.has(el.tagName) ? clip((el as HTMLElement).innerText, 160) : undefined,
    path: parts.join(' > ').slice(0, 400),
    x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(r.width), height: Math.round(r.height),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

function Picker({ onPick, onCancel }: { onPick: (a: ProblemArea) => void; onCancel: () => void }) {
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    const own = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-report-ui]');
    const move = (e: MouseEvent) => { if (!own(e.target) && e.target instanceof Element) setBox((e.target.closest(MEANINGFUL) ?? e.target).getBoundingClientRect()); };
    const click = (e: MouseEvent) => {
      if (own(e.target) || !(e.target instanceof Element)) return;
      e.preventDefault(); e.stopPropagation();
      onPick(describeArea(e.target));
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } else if (!own(e.target)) { e.preventDefault(); e.stopPropagation(); } };
    // Pointing must not operate the page: swallow the press itself, not just the click that follows it.
    const swallow = (e: Event) => { if (!own(e.target)) { e.preventDefault(); e.stopPropagation(); } };
    const presses = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'dblclick', 'contextmenu'];
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    for (const t of presses) document.addEventListener(t, swallow, { capture: true, passive: false });
    document.body.style.cursor = 'crosshair';
    return () => {
      document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true);
      for (const t of presses) document.removeEventListener(t, swallow, true);
      document.body.style.cursor = '';
    };
  }, [onPick, onCancel]);
  return (
    <div data-report-ui>
      <div role="status" className="fixed inset-x-0 top-0 z-[1000] flex items-center justify-center gap-3 bg-slate-900 px-4 py-2 text-sm text-white">
        Click the part of the screen this is about. <Button size="sm" onClick={onCancel}>Cancel (Esc)</Button>
      </div>
      {box && <div aria-hidden className="pointer-events-none fixed z-[999] rounded border-2 border-red-600 bg-red-500/10" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
    </div>
  );
}

export const OPEN_EVENT = 'mansora:report-problem';
/** Open the report form from anywhere, for example a menu item. */
export function openProblemReport() { window.dispatchEvent(new Event(OPEN_EVENT)); }
/** The menu item shown in the sidebar footer of every page. */
export function ReportProblemNavItem() {
  return <button className="m-nav-item" type="button" onClick={openProblemReport} aria-label="Report a problem to Mansora"><Icon name="help" /><span>Report a problem</span></button>;
}

/** Mount once at the app root. The form keeps its draft while the person moves between pages. */
export function ReportProblemButton({ page, onSubmit }: { page: string; onSubmit: (r: ProblemReport) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<ProblemReport['severity']>('normal');
  const [area, setArea] = useState<ProblemArea | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; sent?: boolean }>({});
  const reset = () => { setDescription(''); setSeverity('normal'); setArea(null); setState({}); };
  const pick = useCallback((a: ProblemArea) => { setArea(a); setPicking(false); setOpen(true); }, []);
  const cancelPick = useCallback(() => { setPicking(false); setOpen(true); }, []);
  const send = async () => {
    setState({ busy: true });
    try { await onSubmit({ description: description.trim(), severity, page, area }); setState({ sent: true }); }
    catch (e: any) { setState({ error: e?.message ?? 'The report could not be sent. Your text is kept: try again.' }); }
  };
  useEffect(() => {
    const show = () => { if (state.sent) reset(); setOpen(true); };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, [state.sent]);
  return (
    <div data-report-ui>
      {picking && <Picker onPick={pick} onCancel={cancelPick} />}
      {open && (
        <Modal title="Tell Mansora about a problem" open onClose={() => setOpen(false)} trackChanges={false}
          footer={state.sent ? <Button variant="primary" onClick={() => { reset(); setOpen(false); }}>Done</Button> : <>
            <Button dismiss onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" disabled={state.busy || description.trim().length < 3} onClick={send}>{state.busy ? 'Sending…' : 'Send report'}</Button>
          </>}>
          {state.sent ? <Alert tone="good">Thank you. Your report was sent. Mansora reads every report each evening at 7pm.</Alert> : (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-700">What kind of report?</legend>
                <div className="flex flex-wrap gap-3 text-sm">
                  {([['blocking', 'It stops my work'], ['normal', 'Something is wrong'], ['idea', 'An idea or request']] as const).map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1.5"><input type="radio" name="report-severity" checked={severity === v} onChange={() => setSeverity(v)} />{l}</label>
                  ))}
                </div>
              </fieldset>
              <Field label="What happened?" hint="What you were doing, what you expected, and what happened instead. Do not include passwords or customers' details.">
                <Textarea rows={5} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
              </Field>
              <div className="rounded-md border border-slate-200 p-3 text-sm">
                {area ? <p>Pointing at: <strong>{area.label}</strong>{area.text && area.text !== area.label ? ` "${area.text}"` : ''}</p> : <p className="text-slate-600">Optional: show us where on the screen.</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => { setOpen(false); setPicking(true); }}>{area ? 'Point again' : 'Point to it on the screen'}</Button>
                  {area && <Button size="sm" variant="ghost" onClick={() => setArea(null)}>Remove</Button>}
                </div>
              </div>
              <p className="text-xs text-slate-600">Sent with: this page ({page}), your name and role, and the app version.</p>
              {state.error && <Alert tone="bad">{state.error}</Alert>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
