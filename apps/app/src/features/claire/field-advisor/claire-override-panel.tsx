import {
  type CommitmentLevel,
  type MarketPosition,
  type OverrideAxesInput,
  type RetentionModel,
  commitmentLevelLabels,
  commitmentLevelValues,
  marketPositionLabels,
  marketPositionValues,
  retentionModelLabels,
  retentionModelValues,
} from '@borradh-workspace/api-client/types';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ClaireOverridePanelProps {
  isSaving?: boolean;
  onCancel: () => void;
  onSubmit: (input: OverrideAxesInput) => void;
}

/**
 * Three-axis editor surfaced when the owner clicks "This isn't right" on the
 * advisor card. Owner can override any subset of the three axes. Submission
 * fires the override mutation; the backend re-runs the classifier with the
 * overrides as constraints.
 */
export function ClaireOverridePanel({
  isSaving,
  onCancel,
  onSubmit,
}: ClaireOverridePanelProps) {
  const [retentionModel, setRetentionModel] = useState<
    RetentionModel | undefined
  >();
  const [commitmentLevel, setCommitmentLevel] = useState<
    CommitmentLevel | undefined
  >();
  const [marketPosition, setMarketPosition] = useState<
    MarketPosition | undefined
  >();

  const hasAny =
    retentionModel !== undefined ||
    commitmentLevel !== undefined ||
    marketPosition !== undefined;

  const handleSubmit = () => {
    if (!hasAny) return;
    onSubmit({
      axes: {
        ...(retentionModel && { retentionModel }),
        ...(commitmentLevel && { commitmentLevel }),
        ...(marketPosition && { marketPosition }),
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        Tell me what's actually true and I'll re-think.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor="advisor-retention" className="text-xs">
          How clients come back
        </Label>
        <Select
          value={retentionModel}
          onValueChange={(v) => setRetentionModel(v as RetentionModel)}
        >
          <SelectTrigger id="advisor-retention" className="h-9">
            <SelectValue placeholder="Keep Claire's pick" />
          </SelectTrigger>
          <SelectContent>
            {retentionModelValues.map((v) => (
              <SelectItem key={v} value={v}>
                {retentionModelLabels[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="advisor-commitment" className="text-xs">
          How much clients think before buying
        </Label>
        <Select
          value={commitmentLevel}
          onValueChange={(v) => setCommitmentLevel(v as CommitmentLevel)}
        >
          <SelectTrigger id="advisor-commitment" className="h-9">
            <SelectValue placeholder="Keep Claire's pick" />
          </SelectTrigger>
          <SelectContent>
            {commitmentLevelValues.map((v) => (
              <SelectItem key={v} value={v}>
                {commitmentLevelLabels[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="advisor-market" className="text-xs">
          Your prices vs other local clinics
        </Label>
        <Select
          value={marketPosition}
          onValueChange={(v) => setMarketPosition(v as MarketPosition)}
        >
          <SelectTrigger id="advisor-market" className="h-9">
            <SelectValue placeholder="Keep Claire's pick" />
          </SelectTrigger>
          <SelectContent>
            {marketPositionValues.map((v) => (
              <SelectItem key={v} value={v}>
                {marketPositionLabels[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isSaving || !hasAny}>
          Save
        </Button>
      </div>
    </div>
  );
}
