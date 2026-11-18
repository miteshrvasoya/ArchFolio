'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { createAgreement, getAgreements, getProjects, getTemplates, latest } from '@/lib/repositories';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Empty, Field, Loading, PageHead, useAction } from '@/components/dashboard/ui';
import { DISCLAIMER } from '@/components/agreement/AgreementDocument';

export default function NewAgreementPage() {
  return <Suspense fallback={<Loading />}><NewAgreement /></Suspense>;
}

function NewAgreement() {
  const router = useRouter();
  const params = useSearchParams();
  const { busy, run } = useAction();
  const state = useData(async () => {
    const [projects, templates, agreements] = await Promise.all([getProjects(), getTemplates(), getAgreements()]);
    return { projects, templates, agreements };
  });
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [source, setSource] = useState('tpl:tpl-residential');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <PageHead crumbs={[{ href: '/dashboard/agreements', label: 'Agreements' }]} title="New agreement" />
      <Async state={state}>
        {(d) => {
          if (d.projects.length === 0) return <Empty title="Create a project first" action={<Link className="btn primary" href="/dashboard/projects/new">New project</Link>}>An agreement belongs to a project.</Empty>;
          const pid = projectId || d.projects[0]!.id;
          const project = d.projects.find((p) => p.id === pid);
          const submit = async (e: FormEvent) => {
            e.preventDefault();
            const t = (title || `Architectural services — ${project?.title ?? ''}`).trim();
            if (!t) { setErr('Give the agreement a title'); return; }
            const [kind, id] = source.split(':');
            const a = await run(() => createAgreement({ projectId: pid, title: t, templateId: kind === 'tpl' ? id : null, fromAgreementId: kind === 'dup' ? id : null }), 'Draft created');
            if (a) router.replace(`/dashboard/agreements/${a.id}`);
          };
          return (
            <Card className="ink">
              <form onSubmit={submit} noValidate style={{ maxWidth: 640 }}>
                <Field label="Project">{(id) => <select id={id} value={pid} onChange={(e) => setProjectId(e.target.value)}>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}</Field>
                <fieldset className="field" style={{ border: 0, padding: 0 }}>
                  <legend className="label">Start from</legend>
                  {d.templates.map((t) => (
                    <label key={t.id} className="check" style={{ alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <input type="radio" name="src" value={`tpl:${t.id}`} checked={source === `tpl:${t.id}`} onChange={(e) => setSource(e.target.value)} />
                      <span><strong>{t.name}</strong><br /><small className="faint">{t.description}</small></span>
                    </label>
                  ))}
                  {d.agreements.length > 0 && (
                    <label className="check" style={{ alignItems: 'flex-start' }}>
                      <input type="radio" name="src" value={source.startsWith('dup:') ? source : `dup:${d.agreements[0]!.id}`} checked={source.startsWith('dup:')} onChange={() => setSource(`dup:${d.agreements[0]!.id}`)} />
                      <span><strong>Duplicate a previous agreement</strong><br /><small className="faint">Copies clauses, phases and fee schedule; parties and project details are refreshed.</small>
                        {source.startsWith('dup:') && (
                          <select aria-label="Agreement to duplicate" value={source.slice(4)} onChange={(e) => setSource(`dup:${e.target.value}`)} style={{ display: 'block', marginTop: '0.4rem', padding: '0.4rem' }}>
                            {d.agreements.map((a) => <option key={a.id} value={a.id}>{a.title} (v{latest(a).version})</option>)}
                          </select>
                        )}
                      </span>
                    </label>
                  )}
                </fieldset>
                <Field label="Title" error={err} hint={`Default: Architectural services — ${project?.title ?? ''}`}>{(id, dsc) => <input id={id} aria-describedby={dsc} value={title} onChange={(e) => { setTitle(e.target.value); setErr(null); }} />}</Field>
                <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>Create draft</button></div>
                <p className="disclaimer">{DISCLAIMER}</p>
              </form>
            </Card>
          );
        }}
      </Async>
    </>
  );
}
