'use client';

/**
 * §23.5 — buying a gift voucher.
 *
 * Extracted from the shop wireframe, where it had been sharing a file with the
 * product grid and basket. A voucher is not retail: it is stored value, it is
 * redeemed at the counter, and its tax point is redemption rather than sale.
 * Sharing a module with the shop implied the opposite, and it kept the portal
 * branch reaching into shop code for a page that is not a shop page.
 *
 * The recipient block is the part with no schema behind it: `gift_card` has a
 * code and a balance but no recipient_name, recipient_email, message or
 * deliver_at. A counter-issued card goes to whoever is standing there; one
 * bought online is almost always for someone else.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { ORG, VOUCHER_AMOUNTS } from './mock';
import { WfNote, WfPortalShell, WfSummaryCard } from './wf-shell';

export function VoucherPurchase() {
  const [amount, setAmount] = useState<string>('£100');
  const [recipient, setRecipient] = useState<'me' | 'other'>('other');

  return (
    <WfPortalShell backLabel="Gift voucher">
      <WfNote>
        Static page. Amount and recipient toggle, but nothing is saved and
        checkout goes nowhere.
      </WfNote>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0 space-y-6">
          <h1 className="font-bold text-3xl md:text-4xl">Buy a gift voucher</h1>

          <section className="space-y-3">
            <h2 className="font-semibold text-lg">Voucher value</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VOUCHER_AMOUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAmount(value)}
                  className={cn(
                    'rounded-xl border p-4 text-center font-medium transition-colors',
                    amount === value
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            {amount === 'Other' ? (
              <div className="space-y-1.5">
                <Label htmlFor="wf-voucher-other">Amount</Label>
                <Input
                  id="wf-voucher-other"
                  placeholder="£"
                  inputMode="decimal"
                />
                <p className="text-muted-foreground text-xs">
                  Minimum £25, maximum £1,000.
                </p>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold text-lg">Who is it for?</h2>
            <div className="flex gap-2">
              <Button
                variant={recipient === 'me' ? 'default' : 'outline'}
                onClick={() => setRecipient('me')}
              >
                Send to me
              </Button>
              <Button
                variant={recipient === 'other' ? 'default' : 'outline'}
                onClick={() => setRecipient('other')}
              >
                Send to someone else
              </Button>
            </div>

            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-voucher-email">Your email</Label>
                  <Input
                    id="wf-voucher-email"
                    placeholder="The receipt goes here"
                    type="email"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="wf-voucher-first">First name</Label>
                    <Input id="wf-voucher-first" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wf-voucher-last">Last name</Label>
                    <Input id="wf-voucher-last" />
                  </div>
                </div>

                {recipient === 'other' ? (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label htmlFor="wf-voucher-to">Recipient's email</Label>
                      <Input
                        id="wf-voucher-to"
                        placeholder="The voucher will be sent here"
                        type="email"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wf-voucher-msg">
                        Message for the recipient
                      </Label>
                      <Textarea
                        id="wf-voucher-msg"
                        rows={3}
                        placeholder="Happy birthday Mum — enjoy! Love Amy x"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wf-voucher-when">
                        When should we send it?
                      </Label>
                      <Input
                        id="wf-voucher-when"
                        defaultValue="Straight away"
                      />
                      <p className="text-muted-foreground text-xs">
                        Pick a date to schedule it — useful for birthdays and
                        Christmas.
                      </p>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </div>

        <aside>
          <WfSummaryCard>
            {/* A plain rendition of the voucher, so the buyer sees what lands. */}
            <div className="rounded-xl bg-primary p-5 text-primary-foreground">
              <p className="font-semibold">{ORG.name}</p>
              <p className="mt-1 text-primary-foreground/70 text-xs uppercase tracking-wide">
                Gift voucher
              </p>
              <p className="mt-6 font-bold text-3xl">
                {amount === 'Other' ? '£—' : amount}
              </p>
            </div>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">
                {amount === 'Other' ? '£0.00' : amount}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground text-sm">
              {recipient === 'other'
                ? 'Emailed to the recipient'
                : 'Emailed to you'}
            </p>
            <Button className="mt-4 w-full" size="lg">
              Checkout
            </Button>
            <p className="mt-3 text-center text-muted-foreground text-xs">
              Vouchers are redeemed in clinic. Valid for 12 months.
            </p>
          </WfSummaryCard>
        </aside>
      </main>
    </WfPortalShell>
  );
}
