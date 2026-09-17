import { Check, X } from 'lucide-react';

/**
 * Interstitial: profile-photo guidelines (acceptable vs unsuitable) shown before
 * the upload step. Purely informational — Skip or Continue both advance.
 */
export function PhotoTipsStep() {
  const good = [
    'A clear, well-lit photo of your face',
    'Recent and looks like you',
    'Neutral or simple background',
  ];
  const bad = [
    'Group photos or logos',
    'Blurry, dark or heavily filtered',
    'Sunglasses or anything covering your face',
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Add a profile photo</h1>
        <p className="text-muted-foreground text-sm">
          Clients see this on your public profile. Here&apos;s what works best.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-sm font-medium text-green-600 dark:text-green-400">
            Do
          </p>
          <ul className="flex flex-col gap-2">
            {good.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-destructive mb-2 text-sm font-medium">Avoid</p>
          <ul className="flex flex-col gap-2">
            {bad.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm">
                <X className="text-destructive mt-0.5 size-4 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
