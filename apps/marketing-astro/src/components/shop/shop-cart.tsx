'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeftIcon, ShoppingBagIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Product = {
  id: string;
  name: string;
  retailPriceCents: number | null;
  images: string[] | null;
  inStock: boolean;
};
type CartLine = { productId: string; quantity: number };
type Location = {
  id: string;
  name: string | null;
  addressLine1: string;
  city: string;
  postalCode: string | null;
};
const cartKey = (slug: string) => `borradh-shop-cart:${slug}`;
const cartIdKey = (slug: string) => `borradh-shop-cart-id:${slug}`;
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(
    cents / 100
  );

export function ShopCart({
  slug,
  products,
  currency,
  basePath,
  organizationName,
}: {
  slug: string;
  products: Product[];
  currency: string;
  basePath: string;
  organizationName: string;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    setCart(JSON.parse(localStorage.getItem(cartKey(slug)) ?? '[]'));
    fetch(`/api/public/shop/${encodeURIComponent(slug)}/collection-locations`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setLocations(data.locations);
        setLocationId(data.locations[0]?.id ?? '');
      })
      .catch(() => setError('Could not load collection locations.'));
  }, [slug]);
  const lines = useMemo(
    () =>
      cart.flatMap((line) => {
        const product = products.find((p) => p.id === line.productId);
        return product ? [{ ...line, product }] : [];
      }),
    [cart, products]
  );
  const total = lines.reduce(
    (sum, line) => sum + (line.product.retailPriceCents ?? 0) * line.quantity,
    0
  );
  function update(productId: string, quantity: number) {
    const next =
      quantity > 0
        ? cart.map((line) =>
            line.productId === productId ? { ...line, quantity } : line
          )
        : cart.filter((line) => line.productId !== productId);
    setCart(next);
    localStorage.setItem(cartKey(slug), JSON.stringify(next));
  }
  async function checkout() {
    if (!locationId || !lines.length) return;
    setStarting(true);
    setError('');
    let cartId = localStorage.getItem(cartIdKey(slug));
    if (!cartId) {
      cartId = crypto.randomUUID();
      localStorage.setItem(cartIdKey(slug), cartId);
    }
    try {
      const r = await fetch(
        `/api/public/shop/${encodeURIComponent(slug)}/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cartId,
            locationId,
            email: email || undefined,
            items: lines.map(({ productId, quantity }) => ({
              productId,
              quantity,
            })),
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? 'Checkout could not start.');
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout could not start.');
      setStarting(false);
    }
  }
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href={`${basePath}/shop`}
              className="flex size-8 shrink-0 items-center justify-center rounded-full border"
              aria-label="Continue shopping"
            >
              <ArrowLeftIcon className="size-4" />
            </a>
            <span className="truncate font-semibold">Your basket</span>
          </div>
          <span
            className="flex size-9 items-center justify-center rounded-md border"
            aria-label={`${organizationName} shop`}
          >
            <ShoppingBagIcon className="size-4" />
          </span>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0 space-y-6">
          <h1 className="font-bold text-3xl">Your basket</h1>
          {!lines.length ? (
            <p className="rounded-xl border bg-card p-6 text-muted-foreground">
              Your cart is empty.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border bg-card divide-y">
                {lines.map(({ product, quantity }) => (
                  <div className="flex items-start gap-4 p-5" key={product.id}>
                    <ProductImage product={product} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{product.name}</p>
                      <p className="mt-1 text-muted-foreground text-sm">
                        {product.retailPriceCents === null
                          ? 'Price unavailable'
                          : money(product.retailPriceCents, currency)}
                      </p>
                      <div className="mt-3 inline-flex items-center rounded-lg border">
                        <button
                          type="button"
                          aria-label={`Decrease ${product.name} quantity`}
                          className="px-3 py-1.5 text-muted-foreground"
                          onClick={() => update(product.id, quantity - 1)}
                        >
                          −
                        </button>
                        <span className="border-x px-4 py-1.5 font-medium text-sm">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${product.name} quantity`}
                          className="px-3 py-1.5"
                          onClick={() => update(product.id, quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <span className="font-semibold">
                      {product.retailPriceCents === null
                        ? '—'
                        : money(product.retailPriceCents * quantity, currency)}
                    </span>
                  </div>
                ))}
              </div>
              <section className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold">Collection</h2>
                <label className="mt-4 block text-sm">
                  <span className="font-medium">Collect from</span>
                  <select
                    className="mt-2 w-full rounded-md border bg-background p-2"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name ?? 'Clinic'} — {location.addressLine1},{' '}
                        {location.city}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-3 text-muted-foreground text-sm">
                  Stock is checked and held for 15 minutes only when you
                  continue to secure payment.
                </p>
              </section>
            </>
          )}
        </div>
        {lines.length ? (
          <aside>
            <section className="rounded-2xl border bg-card p-6 shadow-sm md:sticky md:top-6">
              <p className="font-semibold">Order summary</p>
              <div className="my-4 border-t" />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{money(total, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collection</span>
                  <span>Free</span>
                </div>
              </div>
              <div className="my-4 border-t" />
              <div className="flex items-center justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-semibold">{money(total, currency)}</span>
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                Tax is calculated securely at checkout.
              </p>
              <Input
                className="mt-5"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email for your order (optional)"
              />
              <Button
                className="mt-4 w-full"
                size="lg"
                disabled={starting || !locationId}
                onClick={checkout}
              >
                {starting ? 'Checking stock…' : 'Secure checkout'}
              </Button>
              {error ? (
                <p className="mt-3 text-destructive text-xs">{error}</p>
              ) : null}
            </section>
          </aside>
        ) : null}
      </main>
    </div>
  );
}

function ProductImage({ product }: { product: Product }) {
  const image = product.images?.[0];
  return image ? (
    <img
      src={image}
      alt=""
      className="size-16 shrink-0 rounded-lg bg-muted object-cover"
    />
  ) : (
    <div className="size-16 shrink-0 rounded-lg bg-muted" />
  );
}
