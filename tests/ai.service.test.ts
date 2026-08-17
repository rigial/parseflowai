import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { convertToGeminiSchema, extractStructuredData, ai } from '../src/services/ai.service';
import type { SchemaShorthand } from '../src/schemas/parse.schema';

describe('AI Service', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  describe('convertToGeminiSchema', () => {
    it('converts primitive leaf types', () => {
      assert.deepStrictEqual(convertToGeminiSchema('string'), { type: 'string' });
      assert.deepStrictEqual(convertToGeminiSchema('number'), { type: 'number' });
      assert.deepStrictEqual(convertToGeminiSchema('boolean'), { type: 'boolean' });
    });

    it('converts array of primitive types', () => {
      assert.deepStrictEqual(convertToGeminiSchema(['string']), {
        type: 'array',
        items: { type: 'string' },
      });
      assert.deepStrictEqual(convertToGeminiSchema(['number']), {
        type: 'array',
        items: { type: 'number' },
      });
    });

    it('converts flat object schema with required fields', () => {
      const shorthand: Record<string, SchemaShorthand> = {
        name: 'string',
        email: 'string',
        yearsOfExperience: 'number',
        isEmployed: 'boolean',
      };

      const result = convertToGeminiSchema(shorthand);
      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          yearsOfExperience: { type: 'number' },
          isEmployed: { type: 'boolean' },
        },
        required: ['name', 'email', 'yearsOfExperience', 'isEmployed'],
      });
    });

    it('converts complex nested object and array schema', () => {
      const shorthand: Record<string, SchemaShorthand> = {
        name: 'string',
        email: 'string',
        skills: ['string'],
        experience: [
          { company: 'string', role: 'string' },
        ],
      };

      const result = convertToGeminiSchema(shorthand);
      assert.deepStrictEqual(result, {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          skills: {
            type: 'array',
            items: { type: 'string' },
          },
          experience: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                company: { type: 'string' },
                role: { type: 'string' },
              },
              required: ['company', 'role'],
            },
          },
        },
        required: ['name', 'email', 'skills', 'experience'],
      });
    });
  });

  describe('extractStructuredData', () => {
    it('successfully extracts and parses structured JSON from Gemini with token usage metadata', async () => {
      const mockResult = {
        name: 'John Doe',
        email: 'john@example.com',
        skills: ['TypeScript', 'Node.js'],
      };

      mock.method(ai.models, 'generateContent', async (params: any) => {
        assert.ok(params.contents.includes('Extract the following information'));
        assert.ok(params.contents.includes('John Doe Resume Text'));
        assert.strictEqual(params.config.responseMimeType, 'application/json');
        assert.ok(params.config.responseSchema);

        return {
          text: JSON.stringify(mockResult),
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 50,
            totalTokenCount: 200,
          },
        };
      });

      const schema: Record<string, SchemaShorthand> = {
        name: 'string',
        email: 'string',
        skills: ['string'],
      };

      const res = await extractStructuredData('John Doe Resume Text', schema);
      assert.deepStrictEqual(res.data, mockResult);
      assert.ok(res.tokenUsage);
      assert.strictEqual(res.tokenUsage.inputTokens, 150);
      assert.strictEqual(res.tokenUsage.outputTokens, 50);
      assert.strictEqual(res.tokenUsage.totalTokens, 200);
    });

    it('throws error when Gemini returns empty response text', async () => {
      mock.method(ai.models, 'generateContent', async () => {
        return {
          text: '',
        };
      });

      const schema: Record<string, SchemaShorthand> = { name: 'string' };
      await assert.rejects(
        async () => {
          await extractStructuredData('Resume text', schema);
        },
        /Gemini returned an empty response/
      );
    });

    it('throws error when Gemini returns invalid JSON string', async () => {
      mock.method(ai.models, 'generateContent', async () => {
        return {
          text: 'NOT VALID JSON {',
        };
      });

      const schema: Record<string, SchemaShorthand> = { name: 'string' };
      await assert.rejects(
        async () => {
          await extractStructuredData('Resume text', schema);
        },
        /Gemini response was not valid JSON/
      );
    });

    it('propagates errors thrown by the Gemini API call', async () => {
      mock.method(ai.models, 'generateContent', async () => {
        throw new Error('API Rate Limit Exceeded');
      });

      const schema: Record<string, SchemaShorthand> = { name: 'string' };
      await assert.rejects(
        async () => {
          await extractStructuredData('Resume text', schema);
        },
        /API Rate Limit Exceeded/
      );
    });
  });
});
