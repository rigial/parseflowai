import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app';
import { dynamo, ResumeRecord } from '../src/services/dynamo.service';
import { ai } from '../src/services/ai.service';

describe('Parse Route (POST /v1/resumes/parse)', { concurrency: 1 }, () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  const sampleResumeRecord: ResumeRecord = {
    resumeId: 'res_abc123',
    customerId: 'cust_test',
    status: 'ready',
    fileName: 'resume.pdf',
    fileSizeBytes: 1024,
    extractedText: 'John Doe\nSoftware Engineer\njohn@example.com\nSkills: React, Node.js',
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  };

  it('successfully parses ready resume with custom schema (200)', async () => {
    mock.method(dynamo, 'send', async (command: any) => {
      if (command.constructor.name === 'GetCommand' || command.input?.Key?.resumeId) {
        return { Item: sampleResumeRecord };
      }
      return {};
    });

    const expectedData = {
      name: 'John Doe',
      email: 'john@example.com',
      skills: ['React', 'Node.js'],
    };

    mock.method(ai.models, 'generateContent', async () => {
      return {
        text: JSON.stringify(expectedData),
      };
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: {
          name: 'string',
          email: 'string',
          skills: ['string'],
        },
      }),
    });

    assert.strictEqual(response.status, 200);
    const json = await response.json();
    assert.strictEqual(json.success, true);
    assert.deepStrictEqual(json.data, expectedData);
  });

  it('returns 202 EXTRACTION_PENDING when resume status is pending', async () => {
    mock.method(dynamo, 'send', async () => {
      return {
        Item: {
          ...sampleResumeRecord,
          status: 'pending',
          extractedText: undefined,
        },
      };
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 202);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'EXTRACTION_PENDING');
    assert.strictEqual(
      json.error.message,
      'Resume is still being processed, retry in a few seconds'
    );
  });

  it('returns 422 PARSE_FAILED when resume status is failed', async () => {
    mock.method(dynamo, 'send', async () => {
      return {
        Item: {
          ...sampleResumeRecord,
          status: 'failed',
          extractedText: undefined,
        },
      };
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 422);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'PARSE_FAILED');
    assert.strictEqual(
      json.error.message,
      'Could not extract text from this PDF'
    );
  });

  it('returns 404 RESUME_NOT_FOUND when record does not exist', async () => {
    mock.method(dynamo, 'send', async () => {
      return { Item: undefined };
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_non_existent',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 404);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'RESUME_NOT_FOUND');
    assert.strictEqual(json.error.message, 'Resume not found');
  });

  it('returns 502 AI_ERROR when record is ready but extractedText is missing', async () => {
    mock.method(dynamo, 'send', async () => {
      return {
        Item: {
          ...sampleResumeRecord,
          status: 'ready',
          extractedText: undefined,
        },
      };
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 502);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'AI_ERROR');
    assert.strictEqual(json.error.message, 'AI failed to process the resume');
  });

  it('returns 502 AI_ERROR when Gemini AI call fails', async () => {
    mock.method(dynamo, 'send', async () => {
      return { Item: sampleResumeRecord };
    });

    mock.method(ai.models, 'generateContent', async () => {
      throw new Error('Gemini API Error');
    });

    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 502);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'AI_ERROR');
    assert.strictEqual(json.error.message, 'AI failed to process the resume');
  });

  it('returns 400 INVALID_REQUEST when request body is invalid JSON', async () => {
    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json-{',
    });

    assert.strictEqual(response.status, 400);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INVALID_REQUEST');
  });

  it('returns 400 INVALID_REQUEST when resumeId is missing', async () => {
    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 400);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INVALID_REQUEST');
  });

  it('returns 400 INVALID_REQUEST when schema contains invalid types', async () => {
    const response = await app.request('/v1/resumes/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: {
          name: 'invalid_type',
        },
      }),
    });

    assert.strictEqual(response.status, 400);
    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.error.code, 'INVALID_REQUEST');
  });

  it('handles requests to /parse endpoint directly', async () => {
    mock.method(dynamo, 'send', async () => {
      return { Item: sampleResumeRecord };
    });

    mock.method(ai.models, 'generateContent', async () => {
      return {
        text: JSON.stringify({ name: 'John Doe' }),
      };
    });

    const response = await app.request('/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeId: 'res_abc123',
        schema: { name: 'string' },
      }),
    });

    assert.strictEqual(response.status, 200);
    const json = await response.json();
    assert.strictEqual(json.success, true);
    assert.deepStrictEqual(json.data, { name: 'John Doe' });
  });
});
