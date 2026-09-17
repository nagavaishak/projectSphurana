import { PassThrough } from 'node:stream';
import parquet from 'parquetjs-lite';

const { ParquetSchema, ParquetWriter } = parquet;

export type SchemaDefinition = Record<
  string,
  { type: string; optional?: boolean }
>;

/**
 * Serialize rows into a Parquet buffer using parquetjs-lite.
 * Abstracts the Parquet library so it can be swapped without touching exporters.
 */
export async function toParquetBuffer(
  schema: SchemaDefinition,
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  const parquetSchema = new ParquetSchema(schema);

  const chunks: Buffer[] = [];
  const outputStream = new PassThrough();
  outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));

  const writer = await ParquetWriter.openStream(parquetSchema, outputStream);

  for (const row of rows) {
    await writer.appendRow(row);
  }

  await writer.close();

  return Buffer.concat(chunks);
}
