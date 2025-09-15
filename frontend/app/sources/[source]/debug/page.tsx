import { fetchSourceDebugData } from '@/lib/api';
import { notFound } from 'next/navigation';

export default async function SourceDebugPage({ params }: { params: { source: string } }) {
  const debugData = await fetchSourceDebugData(params.source);
  if (!debugData) return notFound();
  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Source Debug: {params.source}</h1>
      <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
        {JSON.stringify(debugData, null, 2)}
      </pre>
    </main>
  );
}
