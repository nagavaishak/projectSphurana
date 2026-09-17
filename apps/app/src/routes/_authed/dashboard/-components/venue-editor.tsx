import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateVenue } from '@/features/venue/api';
import type { OrganizationLocation } from '@borradh-workspace/api-client/types';
import { useEffect, useState } from 'react';

interface VenueEditorProps {
  location: OrganizationLocation;
}

/**
 * The venue details form for one location: the public "about" prose. Everything
 * else on the public page (address, hours, services, team) is managed
 * elsewhere; this is the venue-specific copy.
 */
export function VenueEditor({ location }: VenueEditorProps) {
  const [about, setAbout] = useState(location.about ?? '');

  // When the selected location changes, reset the form to its values.
  useEffect(() => {
    setAbout(location.about ?? '');
  }, [location]);

  const { updateVenue, isSaving } = useUpdateVenue();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateVenue({
      locationId: location.id,
      about: about.trim() || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field>
        <FieldLabel htmlFor="venue-about">About</FieldLabel>
        <FieldDescription>
          The description shown in the "About" section of your public venue
          page.
        </FieldDescription>
        <Textarea
          id="venue-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder="Tell clients what makes your venue special…"
        />
      </Field>

      <Button type="submit" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save venue details'}
      </Button>
    </form>
  );
}
