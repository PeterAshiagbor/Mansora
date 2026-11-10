import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from './index';

const DraftContext = createContext<{ register: (id: string, label: string) => () => void; navigate: (action: () => void) => void }>({ register: () => () => {}, navigate: (action) => action() });
export const DialogDismiss = createContext<((action: () => void) => void) | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, string>()), pending = useRef<(() => void) | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const register = useCallback((id: string, label: string) => { drafts.current.set(id, label); return () => { drafts.current.delete(id); }; }, []);
  const navigate = useCallback((action: () => void) => {
    if (!drafts.current.size) { action(); return; }
    pending.current = action; setLabels([...new Set(drafts.current.values())]);
  }, []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (drafts.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before);
  }, []);
  const cancel = () => { pending.current = null; setLabels([]); };
  return <DraftContext.Provider value={{ register, navigate }}>{children}{labels.length > 0 && <Modal open trackChanges={false} title="Discard unsaved changes?" onClose={cancel} footer={<><Button onClick={cancel}>Keep working</Button><Button variant="danger" onClick={() => { const action = pending.current; pending.current = null; setLabels([]); action?.(); }}>Discard changes</Button></>}><p className="text-sm leading-relaxed">You have unfinished work in <strong>{labels.join(', ')}</strong>. Leaving now will discard those entries. Saved transactions will not be changed.</p></Modal>}</DraftContext.Provider>;
}
export const useNavigationGuard = () => useContext(DraftContext).navigate;
export function useUnsavedChanges(dirty: boolean, label: string) {
  const { register } = useContext(DraftContext), id = useId();
  useEffect(() => dirty ? register(id, label) : undefined, [dirty, id, label, register]);
}
