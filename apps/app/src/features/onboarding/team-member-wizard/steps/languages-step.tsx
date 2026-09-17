import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SUGGESTED = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Polish',
  'Mandarin',
  'Arabic',
];

interface LanguagesStepProps {
  languages: string[];
  onChange: (languages: string[]) => void;
}

/**
 * Multi-select language chips: tap a suggestion to toggle it, or add a custom
 * language. Selected languages render as removable chips.
 */
export function LanguagesStep({ languages, onChange }: LanguagesStepProps) {
  const [custom, setCustom] = useState('');

  const toggle = (lang: string) => {
    if (languages.includes(lang)) {
      onChange(languages.filter((l) => l !== lang));
    } else {
      onChange([...languages, lang]);
    }
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    if (!languages.some((l) => l.toLowerCase() === value.toLowerCase())) {
      onChange([...languages, value]);
    }
    setCustom('');
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Languages you speak</h1>
        <p className="text-muted-foreground text-sm">
          Help clients find a team member they can chat with.
        </p>
      </div>

      {languages.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="selected-languages">
          {languages.map((lang) => (
            <Badge key={lang} variant="secondary" className="gap-1 pr-1">
              {lang}
              <button
                type="button"
                aria-label={`Remove ${lang}`}
                onClick={() => toggle(lang)}
                className="hover:bg-muted rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {SUGGESTED.filter((l) => !languages.includes(l)).map((lang) => (
          <Button
            key={lang}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => toggle(lang)}
          >
            <Plus className="size-3" />
            {lang}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={custom}
          placeholder="Add another language"
          aria-label="Add another language"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addCustom}>
          Add
        </Button>
      </div>
    </div>
  );
}
