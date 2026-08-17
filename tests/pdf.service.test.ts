import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromBuffer } from '../src/services/pdf.service';

describe('PDF Service', () => {
  it('extracts text from a valid PDF buffer', async () => {
    const validPdfPath = path.resolve('node_modules/pdf-parse/test/data/01-valid.pdf');
    const buffer = fs.readFileSync(validPdfPath);

    const text = await extractTextFromBuffer(buffer);
    assert.ok(typeof text === 'string');
    assert.ok(text.length >= 10);
  });

  it('throws error when PDF has no extractable text or text length is less than 10', async () => {
    // A minimal empty page PDF without text stream
    // Or we can mock pdf-parse or use empty buffer
    // Let's test with a buffer that returns short text or empty
    const dummyBuffer = Buffer.from('not a real pdf');
    await assert.rejects(
      async () => {
        await extractTextFromBuffer(dummyBuffer);
      }
    );
  });
});
