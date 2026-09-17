import type { PractitionerSocialLinks } from '@borradh-workspace/api-client/types';
import { Facebook, Instagram, Music2 } from 'lucide-react';

import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export type SocialLinksState = Pick<
  PractitionerSocialLinks,
  'instagram' | 'tiktok' | 'facebook'
>;

interface SocialLinksStepProps {
  value: SocialLinksState;
  onChange: (value: SocialLinksState) => void;
}

const FIELDS: {
  key: keyof SocialLinksState;
  label: string;
  placeholder: string;
  icon: typeof Instagram;
}[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    placeholder: '@yourhandle',
    icon: Instagram,
  },
  { key: 'tiktok', label: 'TikTok', placeholder: '@yourhandle', icon: Music2 },
  {
    key: 'facebook',
    label: 'Facebook',
    placeholder: 'facebook.com/you',
    icon: Facebook,
  },
];

/**
 * Public-profile social handles. Stored on `practitioner.socialLinks` (jsonb).
 */
export function SocialLinksStep({ value, onChange }: SocialLinksStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Add your social links</h1>
        <p className="text-muted-foreground text-sm">
          Let clients follow your work. All optional.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {FIELDS.map(({ key, label, placeholder, icon: Icon }) => (
          <Field key={key} className="gap-1">
            <FieldLabel htmlFor={`social-${key}`}>
              <span className="flex items-center gap-2">
                <Icon className="size-4" />
                {label}
              </span>
            </FieldLabel>
            <Input
              id={`social-${key}`}
              value={value[key] ?? ''}
              placeholder={placeholder}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value || undefined })
              }
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
