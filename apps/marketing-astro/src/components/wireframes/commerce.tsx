'use client';

/**
 * Gift vouchers and the retail shop.
 *
 * Both come from the reference screenshots pinned to the wireframe rather than
 * from the spec — which is worth saying plainly, because the shop is a complete
 * e-commerce build (brand filters, cart, promo codes, shipping thresholds, tax)
 * and none of it appears in the eighteen numbered sections.
 *
 * The out-of-stock treatment is the one thing the product owner annotated
 * directly on the shop screenshot, so it is modelled properly here: the card
 * stays tappable, the price stays visible, and "Add" becomes "Notify me"
 * instead of a dead disabled button.
 */

import {
  MinusIcon,
  PlusIcon,
  SearchIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  TruckIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  BRAND_FILTERS,
  ORG,
  PRODUCTS,
  VOUCHER_AMOUNTS,
  type WfProduct,
} from './mock';
import { WfNote, WfPortalShell, WfSummaryCard } from './wf-shell';

/* -------------------------------------------------------------- voucher -- */

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

/* ----------------------------------------------------------------- shop -- */

export function ShopGrid() {
  return (
    <WfPortalShell
      backLabel="Shop"
      actions={
        <>
          <Button variant="outline" size="icon" aria-label="Search products">
            <SearchIcon className="size-4" />
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/wireframes/cart">
              <ShoppingBagIcon className="size-4" />2
            </a>
          </Button>
        </>
      }
    >
      <WfNote>
        Static page. No products table, no stock, no cart, no checkout — the
        entire shop is absent from Spec V2 and would need scoping before build.
      </WfNote>

      <div className="border-b bg-primary/5">
        <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-center text-sm sm:px-6">
          <TruckIcon className="size-4 text-muted-foreground" />
          Collect free from any Acme Skin &amp; Laser clinic
        </p>
      </div>

      <main className="mx-auto max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[240px_1fr]">
        {/* Brand filter, as in the reference. A sheet on mobile. */}
        <aside className="mb-6 lg:mb-0">
          <div className="lg:sticky lg:top-24">
            <Button variant="outline" className="w-full lg:hidden">
              <SlidersHorizontalIcon className="size-4" />
              Filters
            </Button>
            <div className="hidden lg:block">
              <h2 className="font-semibold">Brands</h2>
              <ul className="mt-3 space-y-2">
                {BRAND_FILTERS.map((brand) => (
                  <li key={brand.name}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border accent-primary"
                      />
                      <span className="flex-1">{brand.name}</span>
                      <span className="text-muted-foreground">
                        {brand.count}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Separator className="my-4" />
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border accent-primary"
                />
                In stock only
              </label>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-bold text-2xl">All products</h1>
            <Button variant="outline" size="sm">
              Name (A–Z)
            </Button>
          </div>

          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {PRODUCTS.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </div>
      </main>
    </WfPortalShell>
  );
}

/**
 * The out-of-stock card is the state the product owner called out.
 *
 * It stays legible and stays tappable — a customer who wants that product needs
 * to be able to open it and ask to be told when it returns. Greying the whole
 * card out of existence loses a sale that was otherwise willing.
 */
function ProductCard({ product }: { product: WfProduct }) {
  const isOut = product.stock === 'out';

  return (
    <Card className="overflow-hidden py-0">
      <div
        className={cn(
          'aspect-square bg-muted',
          isOut && 'opacity-60 grayscale'
        )}
      />
      <CardContent className="space-y-1 p-4">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {product.brand}
        </p>
        <p className="font-medium text-sm leading-snug">{product.name}</p>
        <p className={cn('font-semibold', isOut && 'text-muted-foreground')}>
          {product.priceLabel}
        </p>

        {isOut ? (
          <>
            <Badge variant="secondary" className="mt-1">
              Out of stock
            </Badge>
            <Button variant="outline" size="sm" className="mt-2 w-full">
              Notify me
            </Button>
          </>
        ) : (
          <>
            {product.lowStockLabel ? (
              <Badge variant="outline" className="mt-1">
                {product.lowStockLabel}
              </Badge>
            ) : null}
            <Button size="sm" className="mt-2 w-full">
              Add
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------- cart -- */

export function ShopCart() {
  return (
    <WfPortalShell backLabel="Your basket">
      <WfNote>
        Static page. The second line shows the state that matters most — an item
        that sold out while it sat in the basket. Checkout stays blocked until
        it's resolved, so nobody is charged for stock that isn't there.
      </WfNote>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0 space-y-6">
          <h1 className="font-bold text-3xl md:text-4xl">Your basket</h1>

          <Card>
            <CardContent className="divide-y p-0">
              <div className="flex items-start gap-4 p-5">
                <div className="size-16 shrink-0 rounded-lg bg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Age Diffusing Firming Mask</p>
                  <p className="text-muted-foreground text-sm">Murad</p>
                  <div className="mt-3 inline-flex items-center rounded-lg border">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-muted-foreground"
                      aria-label="Decrease quantity"
                    >
                      <MinusIcon className="size-3.5" />
                    </button>
                    <span className="border-x px-4 py-1.5 font-medium text-sm">
                      1
                    </span>
                    <button
                      type="button"
                      className="px-3 py-1.5"
                      aria-label="Increase quantity"
                    >
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
                <span className="font-semibold">£89.00</span>
              </div>

              {/* Sold out while in the basket. */}
              <div className="flex items-start gap-4 bg-destructive/5 p-5">
                <div className="size-16 shrink-0 rounded-lg bg-muted grayscale" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Barrier Repair Cream</p>
                  <p className="font-medium text-destructive text-sm">
                    Now out of stock — remove it to continue
                  </p>
                  <Button variant="outline" size="sm" className="mt-3">
                    <TrashIcon className="size-3.5" />
                    Remove
                  </Button>
                </div>
                <span className="text-muted-foreground line-through">
                  £62.00
                </span>
              </div>
            </CardContent>
          </Card>

          {/*
            FULFILMENT — the open question.

            Delivery is deferred, but NOT because it is expensive. Stripe Tax
            rates shipping via `txcd_92010001`, Checkout collects the delivery
            address, and Stripe shipping rates carry delivery estimates. What is
            actually left is packing a box and walking to a post office, which
            is a staffing decision rather than a build.

            The delivery row is rendered DISABLED AND LABELLED rather than
            hidden, so a reviewer sees the decision instead of guessing at an
            omission.
          */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="wf-fulfilment"
                  defaultChecked
                  className="mt-1 size-4 accent-primary"
                />
                <span className="text-sm">
                  <span className="font-medium">Collect at Hanley</span> — free,
                  ready in 2 hours
                  <span className="mt-0.5 block text-muted-foreground text-xs">
                    Pick up from reception during opening hours.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 opacity-50">
                <input
                  type="radio"
                  name="wf-fulfilment"
                  disabled
                  className="mt-1 size-4 accent-primary"
                />
                <span className="text-sm">
                  <span className="font-medium">Deliver</span>
                  <span className="mt-0.5 block text-muted-foreground text-xs">
                    Not available yet — this clinic collects orders in branch.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Input placeholder="Promo code" className="max-w-xs" />
            <Button variant="outline">Apply</Button>
          </div>
        </div>

        <aside>
          <WfSummaryCard>
            <p className="font-semibold">Order summary</p>
            <Separator className="my-4" />
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>£89.00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Collection at Hanley
                </span>
                <span>Free</span>
              </div>
            </div>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">£89.00</span>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              Includes VAT. Nothing to pay for collection.
            </p>
            <Button className="mt-4 w-full" size="lg" disabled>
              Checkout
            </Button>
            <p className="mt-3 text-center text-destructive text-xs">
              Remove the out-of-stock item to continue.
            </p>
          </WfSummaryCard>
        </aside>
      </main>
    </WfPortalShell>
  );
}
