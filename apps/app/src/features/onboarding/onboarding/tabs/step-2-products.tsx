import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { Calendar, Megaphone, Users, Video } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step2ProductsProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const PRODUCT_OPTIONS = [
  {
    id: 'video-creation',
    label: 'Video Creation',
    description: 'Create professional marketing videos with AI',
    icon: Video,
  },
  {
    id: 'ai-ad-management',
    label: 'AI Ad Management',
    description: 'Automate your Meta ads with AI optimization',
    icon: Megaphone,
  },
  {
    id: 'content-scheduling',
    label: 'Content Scheduling',
    description: 'Plan and schedule social media content',
    icon: Calendar,
  },
  {
    id: 'lead-nurturing',
    label: 'Lead Nurturing',
    description: 'Automated follow-ups to convert leads',
    icon: Users,
  },
] as const;

export function Step2Products({ form }: Step2ProductsProps) {
  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">What are you interested in?</h1>
        <p className="text-muted-foreground">
          Select the features you&apos;d like to explore. You can always change
          this later.
        </p>
      </div>

      <Controller
        name="interestedProducts"
        control={form.control}
        render={({ field }) => {
          const selectedProducts = field.value || [];

          const toggleProduct = (productId: string) => {
            const isSelected = selectedProducts.includes(productId);
            if (isSelected) {
              field.onChange(
                selectedProducts.filter((id: string) => id !== productId)
              );
            } else {
              field.onChange([...selectedProducts, productId]);
            }
          };

          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PRODUCT_OPTIONS.map((product) => {
                const isSelected = selectedProducts.includes(product.id);
                const Icon = product.icon;

                return (
                  <Card
                    key={product.id}
                    className={cn(
                      'cursor-pointer p-4 transition-all hover:border-primary/50',
                      isSelected && 'border-primary bg-primary/5'
                    )}
                    onClick={() => toggleProduct(product.id)}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleProduct(product.id)}
                        className="mt-1"
                      />
                      <div className="flex flex-1 items-start gap-3">
                        <div
                          className={cn(
                            'rounded-lg p-2',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          )}
                        >
                          <Icon className="size-5" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel className="cursor-pointer text-sm font-medium">
                            {product.label}
                          </FieldLabel>
                          <p className="text-xs text-muted-foreground">
                            {product.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          );
        }}
      />

      <p className="text-center text-xs text-muted-foreground">
        This helps us personalize your dashboard. Skip if you&apos;re not sure.
      </p>
    </FieldGroup>
  );
}
