'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { getClients, getPayments, getProjects } from '@/lib/repositories';
import { summarisePayment, totals } from '@/lib/logic/payments';
import { toCSV } from '@/lib/logic/csv';
import { formatINR, todayIST } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Empty, Field, Loading, Modal, PageHead, downloadFile } from '@/components/dashboard/ui';
import { PaymentForm, PaymentsTable, ReceiptForm } from '@/components/dashboard/payments/PaymentsTable';

export default function PaymentsPage() {
  return <Suspense fallback={<Loading />}><Payments /></Suspense>;
}

function Payments() {
  const router = useRouter();
  const params = useSearchParams();
  const [project, setProject] = useState(params.get('project') ?? '');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [month, setMonth] = useState('');
  const [adding, setAdding] = useState(false);
  const recording = params.get('record') === '1';
  const [recordId, setRecordId] = useState('');
  const today = todayIST();

  const state = useData(async () => {
    const [payments, projects, clients] = await Promise.all([getPayments(), getProjects(), getClients()]);
    return { payments, projects, clients };
  });
  const rows = useMemo(() => {
    const d = state.data;
    if (!d) return [];
    return d.payments.map((p) => {
      const pr = d.projects.find((x) => x.id === p.projectId);
      return { payment: p, projectTitle: pr?.title ?? '—', clientName: d.clients.find((c) => c.id === pr?.clientId)?.name ?? '—', clientId: pr?.clientId ?? '' };
    }).filter((r) => {
      const s = summarisePayment(r.payment, today);
      const st = !status || (status === 'outstanding' ? s.outstanding > 0 : s.status === status);
      return st && (!project || r.payment.projectId === project) && (!client || r.clientId === client) && (!month || (r.payment.dueDate ?? '').startsWith(month));
    });
  }, [state.data, project, client, status, month, today]);
  const t = totals(rows.map((r) => r.payment), today);

  const exportCsv = () => {
    const lines: (string | number | null)[][] = [['Project', 'Client', 'Payment', 'Type', 'Due date', 'Status', 'Amount (INR)', 'Received (INR)', 'Outstanding (INR)', 'Receipts']];
    for (const r of rows) {
      const s = summarisePayment(r.payment, today);
      lines.push([r.projectTitle, r.clientName, r.payment.label, r.payment.type, r.payment.dueDate, s.status, r.payment.amount, s.received, s.outstanding,
        r.payment.receipts.map((x) => `${x.date} ${x.amount} ${x.mode}${x.reference ? ` ${x.reference}` : ''}`).join('; ')]);
    }
    downloadFile(`payments-${today}.csv`, toCSV(lines), 'text/csv;charset=utf-8');
  };
  const closeRecord = () => { setRecordId(''); router.replace('/dashboard/payments'); };

  return (
    <>
      <PageHead eyebrow="Money" title="Payments" actions={<>
        <button type="button" className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <button type="button" className="btn" onClick={() => setAdding(true)}>+ Payment</button>
        <button type="button" className="btn primary" onClick={() => router.replace('/dashboard/payments?record=1')}>Record receipt</button>
      </>} />
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="kpi"><span className="k">Billed</span><span className="v">{formatINR(t.billed)}</span></div>
        <div className="kpi"><span className="k">Received</span><span className="v">{formatINR(t.received)}</span></div>
        <div className="kpi warn"><span className="k">Outstanding</span><span className="v">{formatINR(t.outstanding)}</span></div>
        <div className={`kpi${t.overdueCount ? ' danger' : ''}`}><span className="k">Overdue</span><span className="v">{formatINR(t.overdue)}</span><span className="s">{t.overdueCount} payment{t.overdueCount === 1 ? '' : 's'}</span></div>
      </div>
      <div className="filters" role="group" aria-label="Filter payments">
        <div className="field"><label htmlFor="fp">Project</label><select id="fp" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All</option>{(state.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
        <div className="field"><label htmlFor="fc">Client</label><select id="fc" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All</option>{(state.data?.clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fs">Status</label><select id="fs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="outstanding">Outstanding (any)</option><option value="overdue">Overdue</option><option value="partially-paid">Partially paid</option><option value="invoiced">Invoiced</option><option value="pending">Pending</option><option value="paid">Paid</option></select></div>
        <div className="field"><label htmlFor="fm">Due month</label><input id="fm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      </div>
      <Async state={state}>
        {(d) => d.payments.length === 0 ? <Empty title="No payments yet" action={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add a payment</button>}>Schedule payments from an agreement, or add them here.</Empty>
          : rows.length === 0 ? <Empty title="No payments match these filters" /> : <PaymentsTable rows={rows} />}
      </Async>
      <Modal open={adding} onClose={() => setAdding(false)} title="New payment">
        {state.data && <PaymentForm projects={state.data.projects} defaultProjectId={project || undefined} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal open={recording} onClose={closeRecord} title="Record a receipt">
        {state.data && (() => {
          const open = state.data.payments.filter((p) => summarisePayment(p, today).outstanding > 0);
          const chosen = open.find((p) => p.id === recordId);
          if (!open.length) return <p className="muted">Nothing is outstanding.</p>;
          return (
            <>
              <Field label="Payment">{(id) => (
                <select id={id} value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                  <option value="">Choose…</option>
                  {open.map((p) => <option key={p.id} value={p.id}>{state.data!.projects.find((x) => x.id === p.projectId)?.title} — {p.label} ({formatINR(summarisePayment(p, today).outstanding)} due)</option>)}
                </select>
              )}</Field>
              {chosen && <ReceiptForm key={chosen.id} payment={chosen} onDone={closeRecord} />}
            </>
          );
        })()}
      </Modal>
    </>
  );
}
