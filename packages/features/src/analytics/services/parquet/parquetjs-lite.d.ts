declare module 'parquetjs-lite' {
  interface SchemaField {
    type: string;
    optional?: boolean;
  }

  type SchemaDefinition = Record<string, SchemaField>;

  class ParquetSchema {
    constructor(definition: SchemaDefinition);
  }

  class ParquetEnvelopeWriter {
    static openStream(
      schema: ParquetSchema,
      outputStream: NodeJS.WritableStream,
      options?: Record<string, unknown>
    ): Promise<ParquetEnvelopeWriter>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }

  class ParquetWriter {
    static openStream(
      schema: ParquetSchema,
      outputStream: NodeJS.WritableStream,
      options?: Record<string, unknown>
    ): Promise<ParquetWriter>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
}
