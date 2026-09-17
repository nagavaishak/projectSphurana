import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import NumberFlow from '@number-flow/react';
import { ArrowRight, BadgeCheck, Check } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step8PricingProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type is dynamic based on onboarding step
  form: UseFormReturn<any>;
}

const plans = [
  {
    id: 'hobby',
    name: 'Hobby',
    price: {
      monthly: 0,
      yearly: 0,
    },
    isFree: true,
    description: 'Perfect for trying out the platform and small projects.',
    features: [
      '50 credits / month',
      'Basic sequences',
      'Single-user account',
      'Email support',
    ],
    cta: 'Start Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: {
      monthly: 400,
      yearly: 334,
    },
    isFree: false,
    description: 'Everything you need to scale your business.',
    features: [
      '1,000 credits / month',
      'Unlimited sequences',
      'Multi-user account',
      'SMS, Email, Voice & WhatsApp',
      'Priority support',
    ],
    cta: 'Subscribe to Pro',
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: {
      monthly: null,
      yearly: null,
    },
    isFree: false,
    isEnterprise: true,
    description: 'Custom solutions for large teams with dedicated support.',
    features: [
      'Unlimited credits',
      'Custom integrations',
      'Dedicated account manager',
      'SLA guarantee',
      'On-premise option',
    ],
    cta: 'Contact Sales',
  },
];

export function Step8Pricing({ form }: Step8PricingProps) {
  const [frequency, setFrequency] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Choose your plan</h1>
        <p className="max-w-md text-muted-foreground">
          Select a plan that works for you. You can always upgrade later.
        </p>
        <Tabs
          defaultValue={frequency}
          onValueChange={(v) => setFrequency(v as 'monthly' | 'yearly')}
        >
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly">
              Yearly
              <Badge variant="secondary" className="ml-2">
                20% off
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Controller
        name="selectedPlan"
        control={form.control}
        render={({ field }) => (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const isSelected = field.value === plan.id;
              const priceValue = plan.price[frequency];

              return (
                <Card
                  className={cn(
                    'relative cursor-pointer transition-all hover:shadow-md',
                    plan.popular && 'ring-2 ring-primary',
                    isSelected && 'ring-2 ring-primary bg-primary/5'
                  )}
                  key={plan.id}
                  onClick={() => {
                    // Don't allow selecting enterprise in onboarding
                    if (!plan.isEnterprise) {
                      field.onChange(plan.id);
                    }
                  }}
                >
                  {plan.popular && (
                    <Badge className="-translate-x-1/2 -translate-y-1/2 absolute top-0 left-1/2 rounded-full">
                      Popular
                    </Badge>
                  )}
                  {isSelected && (
                    <div className="absolute top-3 right-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                        <Check className="h-4 w-4 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <CardTitle className="font-medium text-xl">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="min-h-[40px]">
                      {plan.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="mb-4">
                      {plan.isFree ? (
                        <span className="font-bold text-3xl">Free</span>
                      ) : plan.isEnterprise ? (
                        <span className="font-medium text-lg">
                          Custom pricing
                        </span>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <NumberFlow
                            className="font-bold text-3xl"
                            format={{
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 0,
                            }}
                            value={priceValue ?? 0}
                          />
                          <span className="text-muted-foreground text-sm">
                            /month
                          </span>
                        </div>
                      )}
                      {!plan.isFree &&
                        !plan.isEnterprise &&
                        frequency === 'yearly' && (
                          <p className="mt-1 text-muted-foreground text-xs">
                            Billed annually
                          </p>
                        )}
                    </div>
                    <div className="grid gap-2">
                      {plan.features.map((feature) => (
                        <div
                          className="flex items-center gap-2 text-sm"
                          key={feature}
                        >
                          <BadgeCheck className="h-4 w-4 flex-none text-primary" />
                          <span className="text-muted-foreground">
                            {feature}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter>
                    {plan.isEnterprise ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open('mailto:sales@borradh.io', '_blank');
                        }}
                      >
                        {plan.cta}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant={
                          isSelected
                            ? 'default'
                            : plan.popular
                              ? 'default'
                              : 'secondary'
                        }
                        className="w-full"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          field.onChange(plan.id);
                        }}
                      >
                        {isSelected ? (
                          <>
                            <Check className="mr-2 h-4 w-4" />
                            Selected
                          </>
                        ) : (
                          <>
                            {plan.cta}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      />

      <p className="text-center text-muted-foreground text-sm">
        All plans include a 30-day free trial. No credit card required for the
        Hobby plan.
      </p>
    </div>
  );
}
