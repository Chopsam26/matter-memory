'use client';

import * as React from 'react';

import { useIdentity } from '@/components/identity';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Chunk = {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  section: string;
  ordinal: number;
  sensitivity: 'standard' | 'restricted';
  similarity: number;
  content: string;
};

type Citation = {
  n: number;
  documentId: number;
  documentTitle: string;
  section: string;
  chunkId: number;
};

type QueryResult = {
  answer: string;
  citations: Citation[];
  chunks: Chunk[];
  user: { id: number; name: string; role: 'attorney' | 'paralegal' };
};

const SUGGESTIONS = [
  'Why was Daniel excluded from the estate?',
  'Who receives the residuary estate?',
  'How is the house at 14 Willow Lane held, and who receives it?',
];

/** Render [1] markers in the answer as something you can see and hover. */
function AnswerText({ answer, citations }: { answer: string; citations: Citation[] }) {
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  const parts = answer.split(/(\[\d+\])/g);

  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        const citation = byNumber.get(Number(match[1]));
        if (!citation) return <React.Fragment key={i}>{part}</React.Fragment>;
        return (
          <a
            key={i}
            href={`#chunk-${citation.chunkId}`}
            title={`${citation.documentTitle} — ${citation.section}`}
            className="rounded bg-muted px-1 text-xs font-medium text-foreground no-underline hover:bg-accent"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}

export default function QueryPage() {
  const { matters, userId, user, loading: identityLoading } = useIdentity();

  const [matterId, setMatterId] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [showChunks, setShowChunks] = React.useState(true);

  React.useEffect(() => {
    if (matterId === null && matters.length > 0) setMatterId(String(matters[0].id));
  }, [matters, matterId]);

  // An answer belongs to the role and matter that produced it. Leaving the last
  // one on screen after switching role is worse here than anywhere else: the
  // header would read "paralegal" above an answer built from restricted chunks,
  // which is precisely the confusion this app exists to remove.
  React.useEffect(() => {
    setResult(null);
    setError(null);
  }, [userId, matterId]);

  async function ask(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    // Clear before the request too, so the previous role's chunks are never on
    // screen while the next answer is loading.
    setResult(null);

    if (!matterId) return setError('Choose a matter.');
    if (userId === null) return setError('Choose who you are, in the header.');
    if (question.trim().length < 3) return setError('Ask a question.');

    setBusy(true);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          matterId: Number(matterId),
          question: question.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Query failed (${res.status}).`);
        setResult(null);
        return;
      }
      setResult(data);
    } catch {
      setError('Could not reach the server.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const restrictedCount =
    result?.chunks.filter((c) => c.sensitivity === 'restricted').length ?? 0;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ask about a matter</h1>
        <p className="text-sm text-muted-foreground">
          Answers are drawn only from this matter&apos;s documents, and only from the
          ones your role may retrieve.
        </p>
      </div>

      <form onSubmit={ask} className="space-y-4">
        <div className="max-w-sm space-y-2">
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
          <Label htmlFor="question">Question</Label>
          <Textarea
            id="question"
            rows={3}
            value={question}
            disabled={busy}
            placeholder="Who are the beneficiaries?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ask();
            }}
          />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => setQuestion(s)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || identityLoading}>
            {busy ? (
              <>
                <span
                  aria-hidden
                  className="mr-2 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
                Retrieving and answering…
              </>
            ) : (
              'Ask'
            )}
          </Button>
          {user && (
            <span className="text-xs text-muted-foreground">
              asking as {user.name} · {user.role}
            </span>
          )}
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-6">
          <div className="space-y-3 rounded-lg border p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Answer</h2>
              <Badge variant={result.user.role === 'attorney' ? 'default' : 'secondary'}>
                answered as {result.user.role}
              </Badge>
            </div>

            <AnswerText answer={result.answer} citations={result.citations} />

            {result.citations.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Sources</p>
                {result.citations.map((c) => (
                  <p key={c.n} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">[{c.n}]</span>{' '}
                    {c.documentTitle} — {c.section}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/*
            The evidence panel. The claim "restricted chunks never reached the
            model" is invisible in a chat UI - an absent answer looks identical
            to a model that chose to decline. This shows exactly what the SQL
            returned, which is exactly what the prompt was built from. Switch
            role in the header, ask the same question, and watch the list change.
          */}
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowChunks((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-left"
            >
              <span className="text-sm font-medium">
                {result.chunks.length} chunks retrieved
                {restrictedCount > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {restrictedCount} restricted
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {showChunks ? 'hide' : 'show'}
              </span>
            </button>

            {showChunks && (
              <div className="space-y-3 border-t px-5 py-4">
                <p className="text-xs text-muted-foreground">
                  Everything the {result.user.role} role was permitted to retrieve for
                  this matter, in rank order. Nothing else was sent to the model.
                </p>

                {result.chunks.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing was retrieved, so the model was never called.
                  </p>
                )}

                {result.chunks.map((c, i) => (
                  <div
                    key={c.chunkId}
                    id={`chunk-${c.chunkId}`}
                    className={cn(
                      'rounded-md border p-3 text-xs scroll-mt-20',
                      c.sensitivity === 'restricted' && 'border-amber-500/50 bg-amber-500/5',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">#{i + 1}</span>
                      <span className="font-mono text-muted-foreground">
                        {c.similarity.toFixed(3)}
                      </span>
                      <span className="font-medium">{c.documentTitle}</span>
                      {c.sensitivity === 'restricted' && (
                        <Badge variant="outline" className="border-amber-500/60">
                          restricted
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">{c.section}</p>
                    <p className="mt-2 line-clamp-3 text-muted-foreground">
                      {c.content.replace(/\s+/g, ' ').trim()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
