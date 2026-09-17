import { createFileRoute } from '@tanstack/react-router';

import { AnalysisSplitTest } from './-components/analysis-split-test';

export const Route = createFileRoute(
  '/_authed/dashboard/debug/analysis-split-test'
)({
  component: AnalysisSplitTestPage,
});

function AnalysisSplitTestPage() {
  return (
    <>
      <title>AI Analysis Split Test | Borradh</title>
      <AnalysisSplitTest />
    </>
  );
}
