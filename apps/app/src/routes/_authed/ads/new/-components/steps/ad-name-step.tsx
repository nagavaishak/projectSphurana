import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useFormContext } from 'react-hook-form';

import type { AdWizardFormData } from '../../-schema';

export function AdNameStep() {
  const { control } = useFormContext<AdWizardFormData>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Name your ad</h2>
        <p className="mt-1 text-muted-foreground">
          Choose a name to identify this ad in your dashboard
        </p>
      </div>

      <FormField
        control={control}
        name="adName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ad Name</FormLabel>
            <FormControl>
              <Input
                placeholder="My Ad"
                data-claire-target="ads-new-ad-name-input"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
