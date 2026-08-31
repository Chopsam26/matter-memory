/**
 * The only place we talk to Ollama.
 *
 * Ollama runs natively on the host, not in Docker Compose - nothing in the
 * compose file needs to reach it.
 */

const BASE_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5:7b';

/** Matches vector(768) in db/schema.sql. A mismatch must fail loudly, not at INSERT. */
export const EMBEDDING_DIMENSIONS = 768;

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(
      `Cannot reach Ollama at ${BASE_URL}. Is \`ollama serve\` running?`,
      { cause },
    );
  }

  // Ollama reports model-load failures as a JSON `error` with a 4xx/5xx status.
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* not JSON - use the raw body */
    }
    throw new Error(`Ollama ${path} failed (${res.status}): ${detail}`);
  }
  return JSON.parse(text) as T;
}

/**
 * nomic-embed-text is trained with task prefixes and retrieves measurably worse
 * without them. Passages and questions get DIFFERENT prefixes, which is the
 * whole point - they are embedded into the same space from opposite directions.
 * Callers never have to remember this; embed() and embedQuery() apply it.
 */
const DOCUMENT_PREFIX = 'search_document: ';
const QUERY_PREFIX = 'search_query: ';

function assertDimensions(vectors: number[][], label: string): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `${label}: expected ${EMBEDDING_DIMENSIONS} dimensions but got ${v.length}. ` +
          `The schema declares vector(${EMBEDDING_DIMENSIONS}); either the model ` +
          `(${EMBED_MODEL}) changed or db/schema.sql did.`,
      );
    }
  }
}

/**
 * Embed passages for storage. Batches in one request - Ollama accepts an array.
 *
 * Note nomic-embed-text has a 2048-token context and silently truncates beyond
 * it. Our chunks are ~1000 characters (~250 tokens), so this is not close to
 * binding, but it is why chunk size cannot grow arbitrarily.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await post<{ embeddings: number[][] }>('/api/embed', {
    model: EMBED_MODEL,
    input: texts.map((t) => DOCUMENT_PREFIX + t),
  });
  assertDimensions(embeddings, 'embed()');
  return embeddings;
}

/** Embed a question for searching. Different prefix from embed() - deliberately. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embeddings } = await post<{ embeddings: number[][] }>('/api/embed', {
    model: EMBED_MODEL,
    input: [QUERY_PREFIX + text],
  });
  assertDimensions(embeddings, 'embedQuery()');
  return embeddings[0];
}

/**
 * Generate an answer. Non-streaming by design - CLAUDE.md puts streaming out of
 * scope.
 *
 * num_ctx is set explicitly because Ollama defaults to 4096 and silently drops
 * whatever does not fit. In a RAG pipeline that failure is invisible: the model
 * simply never sees the last retrieved chunks and answers as if they did not
 * exist. qwen2.5:7b handles far more, so we give it room.
 *
 * temperature 0 keeps demo runs reproducible.
 */
export async function generate(prompt: string): Promise<string> {
  const { response } = await post<{ response: string }>('/api/generate', {
    model: CHAT_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0, num_ctx: 8192 },
  });
  return response.trim();
}

/** For diagnostics - which models does this Ollama actually have? */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags failed (${res.status})`);
  const { models } = (await res.json()) as { models: { name: string }[] };
  return models.map((m) => m.name);
}

export const config = { BASE_URL, EMBED_MODEL, CHAT_MODEL };
