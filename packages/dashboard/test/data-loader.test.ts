import { afterEach, describe, expect, it } from 'vitest';
import { DatasetSchemaError, loadDataset } from '../src/data.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('loadDataset', () => {
  it('requests the dataset with a relative path so it resolves under any project subpath', async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          mode: 'public',
          generatedAt: '2026-09-01T10:00:00.000Z',
          capabilities: { characters: false, notes: false },
          runs: [],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const dataset = await loadDataset();

    expect(requested).toEqual(['data/runs.json']);
    expect(requested[0]?.startsWith('/')).toBe(false);
    expect(dataset.mode).toBe('public');
  });

  it('reports malformed dataset JSON as a DatasetSchemaError rather than a raw parse failure', async () => {
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response;
    }) as typeof fetch;

    await expect(loadDataset()).rejects.toThrow(DatasetSchemaError);
    await expect(loadDataset()).rejects.toThrow(/Unexpected token/);
  });

  it('reports a missing dataset file as a DatasetSchemaError without ever reading the body', async () => {
    let jsonCalls = 0;
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 404,
        json: async () => {
          jsonCalls += 1;
          return {};
        },
      } as unknown as Response;
    }) as typeof fetch;

    await expect(loadDataset()).rejects.toThrow(DatasetSchemaError);
    await expect(loadDataset()).rejects.toThrow(/HTTP 404/);
    expect(jsonCalls).toBe(0);
  });
});
