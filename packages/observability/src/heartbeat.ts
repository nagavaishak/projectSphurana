/**
 * Fire-and-forget ping to a Better Stack heartbeat URL (dead-man's switch).
 *
 * Call this when a scheduled job runs (or completes successfully). If the job
 * stops running, the pings stop and Better Stack raises an incident — the
 * detector for the "silently stopped, nobody noticed" failure class.
 *
 * A missed ping IS the signal, so this never throws and swallows network
 * errors. No-ops when the URL is undefined (local/dev, or before the secret is
 * configured), so call sites can wire it unconditionally.
 */
export const pingHeartbeat = async (url: string | undefined): Promise<void> => {
  if (!url) return;
  try {
    await fetch(url);
  } catch {
    // a missed ping surfaces as a Better Stack incident — never throw
  }
};
