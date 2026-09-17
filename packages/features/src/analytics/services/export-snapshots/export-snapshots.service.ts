import { logError, trackedResult } from '@borradh-workspace/observability';
import { getAnalyticsBucket, upload } from '@borradh-workspace/storage';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import type { DbConnection } from '../../../shared/index.js';
import { allExporters } from '../exporters/index.js';
import {
  type ExportSnapshotsInput,
  exportSnapshotsSchema,
} from './export-snapshots.schema.js';

import type { Result } from '../../../shared/index.js';

interface ExportSnapshotsResult {
  exported: string[];
  failed: string[];
}

const exportSnapshotsImpl = async (
  db: DbConnection,
  input: ExportSnapshotsInput
): Promise<Result<ExportSnapshotsResult>> => {
  const parsed = exportSnapshotsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { date } = parsed.data;
  const dateStr = date.toISOString().split('T')[0] ?? '';
  const bucket = getAnalyticsBucket();

  const exported: string[] = [];
  const failed: string[] = [];

  for (const exporter of allExporters) {
    try {
      const buffer = await exporter.export(db, date);
      const key = `domain=${exporter.domain}/dt=${dateStr}/snapshot.parquet`;

      await upload({
        bucket,
        key,
        body: buffer,
        contentType: 'application/octet-stream',
      });

      exported.push(exporter.domain);
    } catch (error) {
      logError(`analytics.export.${exporter.domain}`, error, {
        feature: 'analytics',
        extra: { domain: exporter.domain, date: dateStr },
      });
      failed.push(exporter.domain);
    }
  }

  return ok({ exported, failed });
};

export const exportSnapshots = (
  db: DbConnection,
  input: ExportSnapshotsInput
) =>
  trackedResult(
    'analytics.exportSnapshots',
    () => exportSnapshotsImpl(db, input),
    {
      properties: { date: input.date.toISOString() },
    }
  );

export type { ExportSnapshotsResult };
