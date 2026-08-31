import { resolveUser } from '@/lib/auth';
import { matterExists } from '@/lib/matters';
import { ingestDocument, type Sensitivity } from '@/lib/ingest';
import {
  EmptyExtractionError,
  UnsupportedFileTypeError,
  CorruptFileError,
} from '@/lib/parse';

// pdf-parse wraps pdfjs-dist, which needs Node APIs. This will not run on Edge.
export const runtime = 'nodejs';
// Embedding a whole document is slow; this is synchronous by design (CLAUDE.md
// puts job queues out of scope), so give it room.
export const maxDuration = 300;

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  // Identity first, before parsing the file or doing any other work. An unknown
  // user costs one indexed lookup and gets nothing.
  const rawUserId = form.get('userId');
  const user = await resolveUser(Number(rawUserId));
  if (!user) {
    return Response.json({ error: 'Unknown user.' }, { status: 401 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.` },
      { status: 413 },
    );
  }

  const matterId = Number(form.get('matterId'));
  if (!Number.isInteger(matterId) || !(await matterExists(matterId))) {
    return Response.json({ error: 'Choose a matter.' }, { status: 400 });
  }

  const sensitivity = form.get('sensitivity');
  if (sensitivity !== 'standard' && sensitivity !== 'restricted') {
    return Response.json({ error: 'Choose a sensitivity.' }, { status: 400 });
  }

  const title = String(form.get('title') ?? '').trim() || file.name;

  try {
    const result = await ingestDocument({
      matterId,
      title,
      // Uploads have no doc_type picker - that would be a fourth field, and
      // CLAUDE.md fixes the form at three.
      docType: 'uploaded',
      sensitivity: sensitivity as Sensitivity,
      sourceFilename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    });

    return Response.json({
      documentId: result.documentId,
      title,
      chunkCount: result.chunkCount,
      sections: result.sections,
      sensitivity,
      uploadedBy: user.name,
    });
  } catch (err) {
    // parse.ts owns every file-format failure and raises its own error types,
    // so each one can be given a status and a message a person can act on.
    if (err instanceof EmptyExtractionError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof CorruptFileError) {
      // The underlying pdfjs error is not shown to the user, but without it in
      // the log an environment problem is indistinguishable from a bad file.
      console.error('PDF parse failed:', err.cause);
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UnsupportedFileTypeError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && err.message.startsWith('Cannot reach Ollama')) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    console.error('upload failed:', err);
    return Response.json(
      { error: 'Ingestion failed. Check the server log.' },
      { status: 500 },
    );
  }
}
