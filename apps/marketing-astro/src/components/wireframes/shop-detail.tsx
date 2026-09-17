'use client';

/**
 * Product detail and checkout — §23.6.
 *
 * Two things on these screens are decisions rather than layout.
 *
 * OUT OF STOCK IS NOT A DISABLED BUTTON. The product owner annotated this
 * directly: the card stays usable, the price stays visible, and "Add to basket"
 * becomes "Notify me" — an email capture. Someone who came looking for a
 * specific £62 cream is the most qualified demand the shop will see all week,
 * and a greyed-out button converts that into a closed tab.
 *
 * CHECKOUT IS COLLECT-AT-CLINIC ONLY — but NOT because delivery is expensive.
 * An earlier draft said delivery was "six features", including goods VAT and
 * shipping-rate configuration. Stripe covers most of that: Stripe Tax rates
 * shipping via `txcd_92010001`, Checkout collects the delivery address, and
 * Stripe shipping rates carry delivery estimates. What remains is packing a box
 * and walking to a post office — a staffing decision, not a build.
 *
 * Retail here is an attachment to an appointment: the patient is coming in
 * anyway. The delivery row is rendered DISABLED AND LABELLED rather than
 * hidden, so a reviewer can see the decision instead of guessing at an
 * omission.
 */

import {
  BellIcon,
  CalendarCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  CreditCardIcon,
  LockIcon,
  MapPinIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  ShoppingBagIcon,
  StoreIcon,
  TruckIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { ORDER, PATIENT, PRODUCT_DETAIL } from './mock';
import { WfNote, WfPortalShell, WfSummaryCard } from './wf-shell';

/* --------------------------------------------------------- product page -- */

export function ProductDetail() {
  const [outOfStock, setOutOfStock] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  return (
    <WfPortalShell
      backLabel="Shop"
      actions={
        <Button variant="outline" size="sm" asChild>
          <a href="/wireframes/checkout">
            <ShoppingBagIcon className="size-4" />
            Basket
          </a>
        </Button>
      }
    >
      <WfNote>
        Static page. No products table, no stock, no basket — and the gallery
        tiles are placeholders, because no product photography exists.
      </WfNote>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8">
        {/* Review affordance only — not part of the design. */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">Preview:</span>
          <Button
            type="button"
            size="sm"
            variant={outOfStock ? 'outline' : 'default'}
            onClick={() => setOutOfStock(false)}
          >
            In stock
          </Button>
          <Button
            type="button"
            size="sm"
            variant={outOfStock ? 'default' : 'outline'}
            onClick={() => setOutOfStock(true)}
          >
            Out of stock
          </Button>
        </div>

        <div className="grid gap-8 md:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-6">
            <Gallery
              active={activeImage}
              onSelect={setActiveImage}
              dimmed={outOfStock}
            />

            <div className="space-y-2">
              <p className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
                {PRODUCT_DETAIL.brand}
              </p>
              <h1 className="font-bold text-2xl md:text-3xl">
                {PRODUCT_DETAIL.name}
              </h1>
              <p className="text-muted-foreground text-sm">
                {PRODUCT_DETAIL.sizeLabel}
              </p>
              {/* Price stays visible out of stock — it is what brings people back. */}
              <p className="font-bold text-2xl">{PRODUCT_DETAIL.priceLabel}</p>
              <StockLine outOfStock={outOfStock} />
            </div>

            <Separator />

            <div className="divide-y rounded-xl border">
              <Accordion
                title="Description"
                body={PRODUCT_DETAIL.description}
                defaultOpen
              />
              <Accordion
                title="Ingredients"
                body={PRODUCT_DETAIL.ingredients}
              />
              <Accordion title="How to use" body={PRODUCT_DETAIL.howToUse} />
            </div>
          </div>

          <aside>
            <WfSummaryCard>
              {outOfStock ? (
                <NotifyMe />
              ) : (
                <AddToBasket quantity={quantity} onQuantity={setQuantity} />
              )}
            </WfSummaryCard>
          </aside>
        </div>
      </main>
    </WfPortalShell>
  );
}

function Gallery({
  active,
  onSelect,
  dimmed,
}: {
  active: number;
  onSelect: (index: number) => void;
  dimmed: boolean;
}) {
  const tiles = Array.from({ length: PRODUCT_DETAIL.imageCount }, (_, i) => i);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex aspect-square w-full items-center justify-center rounded-xl border bg-muted/40',
          /* Greyscale and reduced opacity out of stock — the annotated look. */
          dimmed && 'opacity-60 grayscale'
        )}
      >
        <PackageIcon className="size-10 text-muted-foreground" />
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {tiles.map((index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`Photo ${index + 1} of ${PRODUCT_DETAIL.imageCount}`}
              className={cn(
                'flex size-16 shrink-0 items-center justify-center rounded-lg border bg-muted/40 transition-colors hover:bg-muted',
                active === index && 'border-primary ring-1 ring-primary'
              )}
            >
              <PackageIcon className="size-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StockLine({ outOfStock }: { outOfStock: boolean }) {
  if (outOfStock) {
    return (
      <p className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
        <Badge variant="secondary">Out of stock</Badge>
        {PRODUCT_DETAIL.outOfStockLabel}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 font-medium text-green-700 text-sm dark:text-green-400">
      <CheckIcon className="size-4" />
      {PRODUCT_DETAIL.stockLabel}
    </p>
  );
}

function AddToBasket({
  quantity,
  onQuantity,
}: {
  quantity: number;
  onQuantity: (next: number) => void;
}) {
  return (
    <>
      <p className="font-semibold">{PRODUCT_DETAIL.name}</p>
      <p className="text-muted-foreground text-sm">{PRODUCT_DETAIL.brand}</p>
      <Separator className="my-4" />

      <div className="flex items-center justify-between gap-4">
        <span className="font-medium text-sm">Quantity</span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Decrease quantity"
            disabled={quantity <= 1}
            onClick={() => onQuantity(Math.max(1, quantity - 1))}
          >
            <MinusIcon className="size-4" />
          </Button>
          <span className="w-9 text-center font-semibold tabular-nums">
            {quantity}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Increase quantity"
            onClick={() => onQuantity(quantity + 1)}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Separator className="my-4" />
      <div className="flex items-center justify-between">
        <span className="font-semibold">Total</span>
        <span className="font-semibold">{PRODUCT_DETAIL.priceLabel}</span>
      </div>

      <Button className="mt-4 w-full" size="lg">
        <ShoppingBagIcon className="size-4" />
        Add to basket
      </Button>
      <p className="mt-3 flex items-start gap-2 text-muted-foreground text-xs">
        <StoreIcon className="mt-0.5 size-3.5 shrink-0" />
        Collect from the clinic. We'll message you when it's ready.
      </p>
    </>
  );
}

/**
 * The out-of-stock action. An email capture, never a dead disabled button —
 * the click still does something, and the something is worth more to the clinic
 * than the click it replaced.
 */
function NotifyMe() {
  return (
    <>
      <p className="font-semibold">{PRODUCT_DETAIL.name}</p>
      <p className="text-muted-foreground text-sm">
        {PRODUCT_DETAIL.outOfStockLabel}
      </p>
      <Separator className="my-4" />
      <div className="space-y-1.5">
        <Label htmlFor="wf-notify-email">Email me when it's back</Label>
        <Input
          id="wf-notify-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={PATIENT.email}
        />
      </div>
      <Button className="mt-4 w-full" size="lg">
        <BellIcon className="size-4" />
        Notify me
      </Button>
      <p className="mt-3 text-muted-foreground text-xs">
        One message, when this product is back at your clinic. Nothing else.
      </p>
      <Separator className="my-4" />
      <Button variant="outline" className="w-full" asChild>
        <a href="/wireframes/shop">See similar products</a>
      </Button>
    </>
  );
}

function Accordion({
  title,
  body,
  defaultOpen = false,
}: {
  title: string;
  body: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left font-medium transition-colors hover:bg-muted/50"
      >
        {title}
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <p className="px-4 pb-4 text-muted-foreground text-sm leading-relaxed">
          {body}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- checkout -- */

export function ShopCheckout() {
  const [placed, setPlaced] = useState(false);

  return (
    <WfPortalShell backLabel={placed ? 'Order confirmed' : 'Checkout'}>
      <WfNote>
        Static page. Nothing is charged — the "Pay" button stands in for a
        redirect to Stripe Checkout, which is where card details are entered.
        Borradh never sees them.
      </WfNote>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8">
        {/* Review affordance only — not part of the design. */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">Preview:</span>
          <Button
            type="button"
            size="sm"
            variant={placed ? 'outline' : 'default'}
            onClick={() => setPlaced(false)}
          >
            Checkout
          </Button>
          <Button
            type="button"
            size="sm"
            variant={placed ? 'default' : 'outline'}
            onClick={() => setPlaced(true)}
          >
            Order confirmed
          </Button>
        </div>

        {placed ? <OrderConfirmed /> : <CheckoutForm />}
      </main>
    </WfPortalShell>
  );
}

function CheckoutForm() {
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <h1 className="font-bold text-2xl md:text-3xl">Checkout</h1>

        <section className="space-y-3">
          <h2 className="font-semibold text-lg">How you'll get it</h2>

          {/* Collect — the only live option in V1. */}
          <Card className="border-primary ring-1 ring-primary">
            <CardContent className="flex items-start gap-3 p-5">
              <StoreIcon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Collect at the clinic</p>
                <p className="text-muted-foreground text-sm">
                  {ORDER.collectionLocation}
                </p>
                <p className="mt-1 text-muted-foreground text-sm">
                  {ORDER.collectionHoursLabel}
                </p>
              </div>
              <CheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            </CardContent>
          </Card>

          {/*
            Disabled and LABELLED, not hidden. A reviewer needs to see that
            delivery was considered and deferred; a patient needs to know not
            to wait by the letterbox.
          */}
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex items-start gap-3 p-5">
              <TruckIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-muted-foreground">
                  Delivery to your address
                  <Badge variant="outline">Not available yet</Badge>
                </p>
                <p className="text-muted-foreground text-sm">
                  We don't post products at the moment. Everything is collected
                  from the clinic.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-lg">Who's collecting</h2>
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="wf-checkout-name">Name</Label>
                <Input
                  id="wf-checkout-name"
                  autoComplete="name"
                  defaultValue={`${PATIENT.firstName} ${PATIENT.lastName}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-checkout-phone">Mobile number</Label>
                <Input
                  id="wf-checkout-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  defaultValue={PATIENT.phone}
                />
                <p className="text-muted-foreground text-xs">
                  We message this number when your order is ready.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      <aside>
        <WfSummaryCard>
          <p className="font-semibold">Your order</p>
          <Separator className="my-4" />
          <ul className="space-y-3">
            {ORDER.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{item.name}</span>
                  <span className="block text-muted-foreground">
                    {item.brand} · Qty {item.quantity}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {item.lineTotalLabel}
                </span>
              </li>
            ))}
          </ul>
          <Separator className="my-4" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{ORDER.subtotalLabel}</span>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Collection</span>
            <span>Free</span>
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between">
            <span className="font-semibold">Total</span>
            <span className="font-semibold tabular-nums">
              {ORDER.totalLabel}
            </span>
          </div>

          <Button className="mt-4 w-full" size="lg">
            <CreditCardIcon className="size-4" />
            Pay {ORDER.totalLabel}
          </Button>
          <p className="mt-3 flex items-start gap-2 text-muted-foreground text-xs">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            You'll be taken to Stripe to pay. Card details never touch our
            servers.
          </p>
        </WfSummaryCard>
      </aside>
    </div>
  );
}

function OrderConfirmed() {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50">
          <CheckIcon className="size-6 text-green-700 dark:text-green-400" />
        </span>
        <h1 className="font-bold text-2xl">That's paid</h1>
        <p className="text-muted-foreground">
          Order {ORDER.reference} · {ORDER.totalLabel}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <MapPinIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">Collect from</p>
              <p className="text-muted-foreground text-sm">
                {ORDER.collectionLocation}
              </p>
              <p className="text-muted-foreground text-sm">
                {ORDER.collectionHoursLabel}
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-start gap-3">
            <CalendarCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">{ORDER.collectionReadyLabel}</p>
              <p className="text-muted-foreground text-sm">
                We'll message {PATIENT.phone} the moment it's on the shelf. Show
                the reference at reception.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="font-semibold">What you bought</p>
          <ul className="mt-3 space-y-2">
            {ORDER.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sm">
                <span>
                  {item.name} × {item.quantity}
                </span>
                <span className="tabular-nums">{item.lineTotalLabel}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" className="flex-1" asChild>
          <a href="/wireframes/account-sub">View my receipt</a>
        </Button>
        <Button className="flex-1" asChild>
          <a href="/wireframes/shop">Keep shopping</a>
        </Button>
      </div>
    </div>
  );
}
