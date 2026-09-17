import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { updatePractitionerForm } from '@/features/practitioners/api/update-practitioner';

/** Labels come from the form declaration — see `update-practitioner.form.ts`. */
const L = updatePractitionerForm.labels;

const HEADLINE_MAX = 64;
const BIO_MAX = 400;

interface HeadlineBioStepProps {
  headline: string;
  bio: string;
  onHeadlineChange: (value: string) => void;
  onBioChange: (value: string) => void;
}

/**
 * Public-profile copy: a short headline and a longer bio, both shown to clients.
 * Headline is distinct from the operational job `title`.
 */
export function HeadlineBioStep({
  headline,
  bio,
  onHeadlineChange,
  onBioChange,
}: HeadlineBioStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Create your profile</h1>
        <p className="text-muted-foreground text-sm">
          This is displayed on your public profile.
        </p>
      </div>

      <Field className="gap-1">
        <FieldLabel htmlFor="headline">{L.headline}</FieldLabel>
        <Input
          id="headline"
          value={headline}
          maxLength={HEADLINE_MAX}
          placeholder="e.g. Senior stylist & colour specialist"
          onChange={(e) => onHeadlineChange(e.target.value)}
        />
        <FieldDescription>
          {headline.length}/{HEADLINE_MAX}
        </FieldDescription>
      </Field>

      <Field className="gap-1">
        <FieldLabel htmlFor="bio">{L.bio}</FieldLabel>
        <Textarea
          id="bio"
          value={bio}
          maxLength={BIO_MAX}
          rows={5}
          placeholder="Tell clients about your experience and what you love doing."
          onChange={(e) => onBioChange(e.target.value)}
        />
        <FieldDescription>
          {bio.length}/{BIO_MAX}
        </FieldDescription>
      </Field>
    </div>
  );
}
