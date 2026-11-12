import { ContactMansora } from '../components/ContactMansora';
import { useState } from 'react';
import { Button, Card, GuideBody, Icon, Input, Modal, PageHeader, type Guide } from '@mansora/ui';
import { CLIENT_GUIDES } from '@mansora/ui';
import type { Permission } from '@mansora/domain';
import { useApp } from '../lib';

export function HelpPage() {
  const { can, go } = useApp();
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<{ id: string; guide: Guide } | null>(null);
  const guides = Object.entries(CLIENT_GUIDES).filter(([id, guide]) => id !== 'help' && (!guide.permission || can(guide.permission as Permission)) && `${guide.title} ${guide.intro} ${guide.steps.join(' ')} ${guide.notes?.join(' ') ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div><PageHeader title="Help & getting started" subtitle="Practical steps for your daily work. Choose a guide, then open the page when you are ready." /><div className="mb-5"><ContactMansora /></div><Input aria-label="Search help guides" placeholder="Search guides: carton cost, discounts, reports…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-6 max-w-xl" /><div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">{guides.map(([id, guide]) => <Card key={id} title={guide.title}><p className="mb-5 text-sm leading-relaxed text-slate-600">{guide.intro}</p><div className="flex flex-wrap gap-2"><Button onClick={() => setSelected({ id, guide })}><Icon name="help" />Read guide</Button><Button variant="ghost" onClick={() => go(id)}>Open page →</Button></div></Card>)}</div>{!guides.length && <p className="py-10 text-center text-sm text-slate-600">No guides match. Try “stock”, “cost” or “sales”.</p>}{selected && <Modal title={`How to use: ${selected.guide.title}`} open wide onClose={() => setSelected(null)} footer={<><Button dismiss onClick={() => setSelected(null)}>Close</Button><Button variant="primary" onClick={() => { go(selected.id); setSelected(null); }}>Open page →</Button></>}><GuideBody guide={selected.guide} /></Modal>}</div>;
}
