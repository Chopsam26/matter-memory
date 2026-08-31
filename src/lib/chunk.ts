/**
 * Split a document into overlapping chunks, each tagged with the section it
 * came from.
 *
 * The section label is what a citation points at, so it has to be something a
 * reader recognises - "ARTICLE IV - RESIDUARY ESTATE / Section 4.2" rather than
 * "chunk 7".
 */

export type Chunk = {
  /** Human-readable location, e.g. 'ARTICLE III - SPECIFIC BEQUESTS / Section 3.2'. */
  section: string;
  /** Position within the document, starting at 0. */
  ordinal: number;
  content: string;
};

/**
 * Roughly 1000 characters, ~250 tokens. Tuned by scripts/eval.ts, not guessed
 * at - see step 5b. The hard ceiling is nomic-embed-text's 2048-token context,
 * beyond which it truncates silently, but retrieval quality binds long before
 * that: chunks that straddle two unrelated clauses match neither well.
 */
const TARGET_CHARS = 1000;
const OVERLAP_CHARS = 150;
/** Below this, prefer to keep packing rather than emit a stub chunk. */
const MIN_CHARS_TO_BREAK_ON_HEADING = 300;

/**
 * Top-level headings. Deliberately a fixed keyword list rather than "any line
 * in capitals" - legal documents end with the signatory's name in capitals on
 * its own line, and that would otherwise become a section label.
 */
const TOP_HEADING = /^(ARTICLE|SECTION|SCHEDULE|EXHIBIT|APPENDIX)\s+\S+.*$/;

/** Inline subsection prefix, e.g. 'Section 4.3. The Trustee shall...'. */
const SUB_HEADING = /^(Section\s+\d+(?:\.\d+)*)\.?\s/;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, '')) // trailing space only; the account
    .join('\n'); // statements use leading space for alignment
}

/** Take the tail of a chunk for overlap, trimmed forward to a clean boundary. */
function overlapTail(content: string): string {
  if (content.length <= OVERLAP_CHARS) return content;
  const tail = content.slice(-OVERLAP_CHARS);
  // Start at the first sentence or line break so the overlap never begins
  // mid-word.
  const boundary = tail.search(/(?<=[.;:])\s|\n/);
  return boundary === -1 ? tail : tail.slice(boundary).trim();
}

/** Break a single oversized paragraph on sentence boundaries. */
function splitLongBlock(block: string): string[] {
  if (block.length <= TARGET_CHARS) return [block];
  const sentences = block.split(/(?<=[.;:])\s+/);
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > TARGET_CHARS) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkText(text: string): Chunk[] {
  const blocks = normalise(text)
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];

  let currentTop: string | null = null;
  let currentSub: string | null = null;

  let buffer: string[] = [];
  let bufferChars = 0;
  let overlap = '';
  let sectionAtStart: string | null = null;
  let topAtStart: string | null = null;

  const label = (): string | null => {
    if (currentTop && currentSub) return `${currentTop} / ${currentSub}`;
    return currentTop ?? currentSub;
  };

  const flush = () => {
    if (buffer.length === 0) return;
    const body = buffer.join('\n\n');
    const content = (overlap ? `${overlap}\n\n${body}` : body).trim();

    // A short trailing article gets absorbed rather than emitted as a stub, so
    // a chunk can end in a different article than it began. Say so: naming only
    // the opening article would point a citation at the wrong place, which is
    // worse than an ugly label.
    let section = sectionAtStart ?? `Part ${chunks.length + 1}`;
    if (topAtStart && currentTop && currentTop !== topAtStart) {
      section = `${section} … ${currentTop}`;
    }

    chunks.push({ section, ordinal: chunks.length, content });
    overlap = overlapTail(content);
    buffer = [];
    bufferChars = 0;
    sectionAtStart = null;
    topAtStart = null;
  };

  for (const block of blocks) {
    const firstLine = block.split('\n', 1)[0].trim();

    // A new top-level heading resets the subsection beneath it.
    const isTopHeading = TOP_HEADING.test(firstLine);
    if (isTopHeading) {
      // Start a fresh chunk at an article boundary, so a citation names the
      // article the text is actually in - but only once we have enough content
      // to be worth emitting.
      if (bufferChars >= MIN_CHARS_TO_BREAK_ON_HEADING) flush();
      currentTop = firstLine;
      currentSub = null;
    } else {
      const sub = firstLine.match(SUB_HEADING);
      if (sub) currentSub = sub[1];
    }

    for (const piece of splitLongBlock(block)) {
      if (bufferChars > 0 && bufferChars + piece.length + 2 > TARGET_CHARS) {
        flush();
      }
      if (buffer.length === 0) {
        // Attribute the chunk to the section its own content starts in - not
        // the section the carried-over overlap came from.
        sectionAtStart = label();
        topAtStart = currentTop;
      }
      buffer.push(piece);
      bufferChars += piece.length + 2;
    }
  }

  flush();
  return chunks;
}
