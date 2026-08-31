'use client';

import * as React from 'react';

import { useIdentity } from '@/components/identity';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type UploadResult = {
  documentId: number;
  title: string;
  chunkCount: number;
  sections: string[];
  sensitivity: 'standard' | 'restricted';
};

export default function UploadPage() {
  const { matters, userId, loading: identityLoading } = useIdentity();

  const [matterId, setMatterId] = React.useState<string | null>(null);
  const [sensitivity, setSensitivity] = React.useState<string | null>('standard');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<UploadResult | null>(null);

  const formRef = React.useRef<HTMLFormElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Default to the first matter once they have loaded.
  React.useEffect(() => {
    if (matterId === null && matters.length > 0) setMatterId(String(matters[0].id));
  }, [matters, matterId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose a file to upload.');
    if (!matterId) return setError('Choose a matter.');
    if (userId === null) return setError('Choose who you are, in the header.');

    const body = new FormData();
    body.set('file', file);
    body.set('matterId', matterId);
    body.set('sensitivity', sensitivity ?? 'standard');
    body.set('userId', String(userId));

    setBusy(true);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status}).`);
        return;
      }
      setResult(data);
      formRef.current?.reset();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Upload a document</h1>
        <p className="text-sm text-muted-foreground">
          PDF or .txt, one at a time. The file is parsed, chunked and embedded before
          this page responds, so a long document takes a moment.
        </p>
      </div>

      {/* Exactly three fields: file, matter, sensitivity. Identity is in the
          header; document type is set server-side. */}
      <form ref={formRef} onSubmit={handleSubmit} className="max-w-lg space-y-6">
        <div className="space-y-2">
          <Label htmlFor="file">File</Label>
          <Input
            ref={fileRef}
            id="file"
            name="file"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            required
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            A scanned PDF holds images rather than text and will be rejected.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="matter">Matter</Label>
          <Select
            value={matterId}
            onValueChange={(v) => setMatterId(v as string)}
            disabled={busy || identityLoading}
          >
            <SelectTrigger id="matter" className="w-full">
              <SelectValue>
                {(value: string | null) =>
                  matters.find((m) => String(m.id) === value)?.title ??
                  (identityLoading ? 'Loading…' : 'Choose a matter')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {matters.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sensitivity">Sensitivity</Label>
          <Select
            value={sensitivity}
            onValueChange={(v) => setSensitivity(v as string)}
            disabled={busy}
          >
            <SelectTrigger id="sensitivity" className="w-full">
              <SelectValue>
                {(value: string | null) =>
                  value === 'restricted' ? 'Restricted' : 'Standard'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="restricted">Restricted</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Restricted documents are retrievable by attorneys only. Anyone may file
            one — classifying is not reading.
          </p>
        </div>

        <Button type="submit" disabled={busy || identityLoading}>
          {busy ? (
            <>
              <span
                aria-hidden
                className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              Parsing, chunking and embedding…
            </>
          ) : (
            'Upload'
          )}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="max-w-lg">
          <AlertTitle>
            Ingested {result.title}
            {result.sensitivity === 'restricted' && ' (restricted)'}
          </AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {result.chunkCount} chunks embedded. Sections found:{' '}
                {result.sections.slice(0, 3).join('; ')}
                {result.sections.length > 3 && ` and ${result.sections.length - 3} more`}
                .
              </p>
              {result.sensitivity === 'restricted' && (
                <p className="text-muted-foreground">
                  A paralegal asking about this will retrieve nothing from it.
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
