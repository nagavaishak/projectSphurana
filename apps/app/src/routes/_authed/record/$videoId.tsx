import { TeleprompterRecorder } from '@/features/record';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

// `uploadToken` turns this into an auth-free "magic link" target: the token
// (minted by the authed desktop) grants scoped upload access, so a phone that
// isn't logged in can still record and upload. The `_authed` guard exempts
// `/record` when this param is present.
const recordSearchSchema = z.object({
  uploadToken: z.string().optional(),
});

export const Route = createFileRoute('/_authed/record/$videoId')({
  component: RecordPage,
  validateSearch: recordSearchSchema,
});

function RecordPage() {
  const { videoId } = Route.useParams();
  const { uploadToken } = Route.useSearch();

  return (
    <>
      <title>Record | Borradh</title>
      <TeleprompterRecorder videoId={videoId} uploadToken={uploadToken} />
    </>
  );
}
