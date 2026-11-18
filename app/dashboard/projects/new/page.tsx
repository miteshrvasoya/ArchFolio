'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { getClients } from '@/lib/repositories';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Empty, Loading, PageHead } from '@/components/dashboard/ui';
import { ProjectForm } from '@/components/dashboard/forms/ProjectForm';

export default function NewProjectPage() {
  return <Suspense fallback={<Loading />}><NewProject /></Suspense>;
}

function NewProject() {
  const router = useRouter();
  const params = useSearchParams();
  const clients = useData(() => getClients());
  return (
    <>
      <PageHead crumbs={[{ href: '/dashboard/projects', label: 'Projects' }]} title="New project" />
      <Async state={clients}>
        {(list) => list.length === 0 ? (
          <Empty title="Add a client first" action={<Link className="btn primary" href="/dashboard/clients?new=1">New client</Link>}>Every project belongs to a client.</Empty>
        ) : (
          <Card className="ink">
            <ProjectForm clients={list} defaultClientId={params.get('client') ?? undefined} onDone={(p) => router.replace(`/dashboard/projects/${p.id}`)} />
          </Card>
        )}
      </Async>
    </>
  );
}
