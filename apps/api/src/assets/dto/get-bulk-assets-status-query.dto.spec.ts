import { GetBulkAssetsStatusQueryDto } from './get-bulk-assets-status-query.dto.js';

/**
 * The background analysis tracker asks about a whole upload in one request, so
 * the ids arrive as a comma-separated query param. Getting this wrong fails
 * softly — a single id string would validate as an array of one and the tracker
 * would silently watch only the first video of a batch.
 */
const schema = (
  GetBulkAssetsStatusQueryDto as unknown as {
    schema: {
      parse: (value: unknown) => { assetIds?: string[]; batchId?: string };
    };
  }
).schema;

describe('GetBulkAssetsStatusQueryDto', () => {
  it('splits a comma-separated list into ids', () => {
    expect(schema.parse({ assetIds: 'a,b,c' }).assetIds).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('accepts the repeated-param form Express also produces', () => {
    expect(schema.parse({ assetIds: ['a', 'b'] }).assetIds).toEqual(['a', 'b']);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(schema.parse({ assetIds: 'a, b, ,c,' }).assetIds).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('accepts a batchId on its own', () => {
    expect(schema.parse({ batchId: 'batch_1' }).batchId).toBe('batch_1');
  });

  it('rejects a query with neither', () => {
    // Without this the service would be handed an empty selector, and the
    // underlying feature schema's refine would surface as a 500 rather than
    // a 400.
    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ assetIds: '' })).toThrow();
  });
});
