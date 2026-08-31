/**
 * Turn an uploaded or on-disk file into plain text.
 *
 * Only .txt and .pdf, per CLAUDE.md.
 */

export type ParsedFile = {
  text: string;
  /** Page count for PDFs, undefined for plain text. Used as a citation fallback. */
  pageCount?: number;
};

export class EmptyExtractionError extends Error {
  constructor(filename: string) {
    super(
      `No text could be extracted from "${filename}". ` +
        'If this is a scanned PDF it contains images rather than text, and would ' +
        'need OCR - which is out of scope here.',
    );
    this.name = 'EmptyExtractionError';
  }
}

export class UnsupportedFileTypeError extends Error {
  constructor(filename: string) {
    super(`Unsupported file type: "${filename}". Only .pdf and .txt are accepted.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class CorruptFileError extends Error {
  constructor(filename: string, cause: unknown) {
    super(`"${filename}" could not be read as a PDF. The file may be corrupt or truncated.`, {
      cause,
    });
    this.name = 'CorruptFileError';
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * A scanned PDF parses successfully and yields whitespace, or a handful of
 * stray ligatures. Treat "nothing meaningful" as failure rather than ingesting
 * an empty document that then silently answers nothing.
 */
function isMeaningful(text: string): boolean {
  return text.replace(/\s+/g, '').length >= 20;
}

export async function parseFile(
  data: Buffer,
  filename: string,
): Promise<ParsedFile> {
  const ext = extensionOf(filename);

  if (ext === '.txt') {
    const text = data.toString('utf8');
    if (!isMeaningful(text)) throw new EmptyExtractionError(filename);
    return { text };
  }

  if (ext === '.pdf') {
    // pdf-parse v2 wraps pdfjs-dist. Imported lazily so that the plain-text
    // path - which is all the seed script needs - never pays to load it.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data });
    try {
      let result;
      try {
        result = await parser.getText();
      } catch (cause) {
        // pdfjs raises its own exception types (InvalidPDFException and
        // friends). Translate here so callers only ever see this module's
        // errors, and the upload page has something to show a person.
        throw new CorruptFileError(filename, cause);
      }
      // A scanned PDF is different: it parses fine and simply has no text
      // layer, so it lands on EmptyExtractionError below rather than here.
      if (!isMeaningful(result.text)) throw new EmptyExtractionError(filename);
      return { text: result.text, pageCount: result.pages.length };
    } finally {
      await parser.destroy();
    }
  }

  throw new UnsupportedFileTypeError(filename);
}
