import { useEffect, useRef, useState, type RefObject } from 'react';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Issue = { control: Control; label: string; message: string };

/** Explain native field constraints even when a dialog's action is disabled. */
export function FormRequirements({ scope }: { scope: RefObject<HTMLElement | null> }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const current = useRef<Issue[]>([]);
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    let frame = 0;
    const refresh = () => {
      const next: Issue[] = [];
      for (const control of root.querySelectorAll<Control>('input, select, textarea')) {
        if (root.getAttribute('role') === 'dialog' ? control.closest('[role="dialog"]') !== root : !!control.closest('[role="dialog"]') || control.closest('.m-card') !== root) continue;
        if (control.disabled || ('readOnly' in control && control.readOnly) || control.type === 'hidden' || !control.getClientRects().length) {
          delete control.dataset.requirementInvalid;
          if (control.dataset.requirementAria) { control.removeAttribute('aria-invalid'); delete control.dataset.requirementAria; }
          continue;
        }
        const missing = control.required && (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type) ? !control.checked : !control.value.trim());
        const invalid = missing || !control.validity.valid;
        if (invalid) {
          const labelled = control.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
          const label = control.getAttribute('aria-label') || labelled || control.closest('label')?.querySelector('[data-field-label]')?.textContent || control.closest('label')?.textContent?.trim() || control.name || 'Required field';
          const message = control.dataset.validationMessage || (missing ? `Complete ${label}` : `Check ${label}`);
          next.push({ control, label, message });
          control.dataset.requirementInvalid = 'true';
          if (!control.hasAttribute('aria-invalid')) { control.setAttribute('aria-invalid', 'true'); control.dataset.requirementAria = 'true'; }
        } else {
          delete control.dataset.requirementInvalid;
          if (control.dataset.requirementAria) { control.removeAttribute('aria-invalid'); delete control.dataset.requirementAria; }
        }
      }
      if (next.length !== current.current.length || next.some((item, i) => item.control !== current.current[i]?.control || item.message !== current.current[i]?.message)) {
        current.current = next; setIssues(next);
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['required', 'disabled', 'readonly', 'hidden', 'value', 'min', 'max', 'minlength', 'maxlength', 'pattern', 'type', 'data-validation-message'] });
    root.addEventListener('input', schedule); root.addEventListener('change', schedule);
    refresh();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); root.removeEventListener('input', schedule); root.removeEventListener('change', schedule); };
  }, [scope]);
  // Controlled values and conditional requirements can change without DOM input events.
  useEffect(() => { scope.current?.dispatchEvent(new Event('input')); });
  return <div role="status" aria-live="polite" aria-atomic="true" className={issues.length ? 'm-form-requirements border-t border-red-100 bg-red-50/40 px-5 py-3 text-xs text-red-800' : 'sr-only'}>
    {issues.length > 0 && <><span className="font-medium">To continue, complete or correct: </span>{issues.map((issue, i) => <span key={i}>{i > 0 && '; '}<button type="button" className="rounded text-left underline decoration-red-300 underline-offset-2 focus-visible:outline-2 focus-visible:outline-red-600" onClick={() => {
      for (let detail = issue.control.closest('details'); detail; detail = detail.parentElement?.closest('details') ?? null) detail.open = true;
      issue.control.scrollIntoView({ block: 'center', behavior: 'smooth' }); issue.control.focus();
    }}>{issue.message}</button></span>)}.</>}
  </div>;
}
