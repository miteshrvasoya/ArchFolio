'use client';
import Link from 'next/link';
import type { Discussion } from '@/lib/schemas';
import { toggleActionItem } from '@/lib/repositories';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';
import { CHANNEL_LABEL } from './status';
import { Chip, useAction } from './ui';

export function DiscussionEntry({ d, projectTitle }: { d: Discussion; projectTitle?: string }) {
  const { run } = useAction();
  return (
    <article className="entry" aria-label={`${CHANNEL_LABEL[d.channel]} on ${formatDateTime(d.at)}`}>
      <div className="feed-meta">
        <span className="mono">{formatDateTime(d.at)}</span>
        <Chip>{CHANNEL_LABEL[d.channel]}</Chip>
        {d.scopeChange && <Chip tone="terra">Scope change</Chip>}
        {d.tags.filter((t) => t !== 'scope-change').map((t) => <Chip key={t} tone={t === 'disputed' ? 'danger' : 'neutral'}>{t}</Chip>)}
        {projectTitle && <Link href={`/dashboard/projects/${d.projectId}?tab=discussions`}>{projectTitle}</Link>}
      </div>
      <p>{d.summary}</p>
      {d.impact && (d.impact.days !== 0 || d.impact.costInr > 0 || d.impact.notes) && (
        <div className="impact">
          <strong>Impact:</strong> {d.impact.days !== 0 && <>{d.impact.days > 0 ? '+' : ''}{d.impact.days} days</>}
          {d.impact.days !== 0 && d.impact.costInr > 0 && ' · '}
          {d.impact.costInr > 0 && <>{formatINR(d.impact.costInr)}</>}
          {d.impact.notes && <> — {d.impact.notes}</>}
        </div>
      )}
      {d.decisions.length > 0 && (<><h4>Decisions</h4><ul>{d.decisions.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
      {d.actionItems.length > 0 && (
        <>
          <h4>Action items</h4>
          <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
            {d.actionItems.map((a) => (
              <li key={a.id}>
                <label className="check">
                  <input type="checkbox" checked={a.done} onChange={(e) => run(() => toggleActionItem(d.id, a.id, e.target.checked))} />
                  <span style={{ textDecoration: a.done ? 'line-through' : undefined }}>{a.text}</span>
                  <small className="faint">{[a.owner, a.due ? `due ${formatDate(a.due)}` : ''].filter(Boolean).join(' · ')}</small>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.attachments.length > 0 && (
        <>
          <h4>Attachments</h4>
          <ul>{d.attachments.map((a, i) => <li key={i}>{a.link ? <a href={a.link} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name} <small className="faint">({a.type.replace('-', ' ')}{a.note ? ` · ${a.note}` : ''})</small></li>)}</ul>
        </>
      )}
    </article>
  );
}
