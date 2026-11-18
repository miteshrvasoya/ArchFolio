'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { Channel } from '@/lib/schemas';
import { getDiscussions, getPhases, getProjects } from '@/lib/repositories';
import { useData } from '@/lib/hooks/useData';
import { Async, Empty, Loading, Modal, PageHead } from '@/components/dashboard/ui';
import { CHANNEL_LABEL } from '@/components/dashboard/status';
import { DiscussionEntry } from '@/components/dashboard/DiscussionEntry';
import { DiscussionForm } from '@/components/dashboard/forms/DiscussionForm';

export default function DiscussionsPage() {
  return <Suspense fallback={<Loading />}><Discussions /></Suspense>;
}

function Discussions() {
  const router = useRouter();
  const params = useSearchParams();
  const adding = params.get('new') === '1';
  const [project, setProject] = useState(params.get('project') ?? '');
  const [channel, setChannel] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const state = useData(async () => {
    const [discussions, projects, phases] = await Promise.all([getDiscussions(), getProjects(), getPhases()]);
    return { discussions, projects, phases };
  });
  const filtered = useMemo(() => (state.data?.discussions ?? []).filter((d) => {
    const s = q.trim().toLowerCase();
    return (!project || d.projectId === project) && (!channel || d.channel === channel)
      && (!kind || (kind === 'scope' ? d.scopeChange : kind === 'disputed' ? d.tags.includes('disputed') : d.actionItems.some((a) => !a.done)))
      && (!s || [d.summary, ...d.decisions, ...d.tags].some((f) => f.toLowerCase().includes(s)));
  }), [state.data, project, channel, kind, q]);

  return (
    <>
      <PageHead eyebrow="Record" title="Discussions" actions={<button type="button" className="btn primary" onClick={() => router.replace('/dashboard/discussions?new=1')}>+ Log discussion</button>} />
      <div className="filters" role="group" aria-label="Filter discussions">
        <div className="field"><label htmlFor="dq">Search</label><input id="dq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Summary, decisions…" /></div>
        <div className="field"><label htmlFor="dp">Project</label><select id="dp" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All</option>{(state.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
        <div className="field"><label htmlFor="dc">Channel</label><select id="dc" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All</option>{Channel.options.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
        <div className="field"><label htmlFor="dk">Show</label><select id="dk" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Everything</option><option value="scope">Scope changes</option><option value="disputed">Disputed</option><option value="open">Open action items</option></select></div>
      </div>
      <Async state={state}>
        {(d) => d.projects.length === 0 ? <Empty title="Create a project first">Discussions are logged against a project.</Empty>
          : filtered.length === 0 ? <Empty title={d.discussions.length ? 'No discussions match these filters' : 'No discussions logged yet'} /> : (
            <ol className="timeline" aria-label="All discussions">
              {filtered.map((x) => <li key={x.id} className={x.scopeChange ? 'scope' : x.tags.includes('disputed') ? 'disputed' : ''}><DiscussionEntry d={x} projectTitle={d.projects.find((p) => p.id === x.projectId)?.title} /></li>)}
            </ol>
          )}
      </Async>
      <Modal open={adding} onClose={() => router.replace('/dashboard/discussions')} title="Log a discussion" wide>
        {state.data && state.data.projects.length > 0 && <DiscussionForm projects={state.data.projects} phases={state.data.phases} projectId={project || undefined} onDone={() => router.replace('/dashboard/discussions')} />}
      </Modal>
    </>
  );
}
