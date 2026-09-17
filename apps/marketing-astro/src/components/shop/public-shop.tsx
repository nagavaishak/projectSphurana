'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeftIcon, ShoppingBagIcon, TruckIcon } from 'lucide-react';
import { useState } from 'react';

type Product = {
  id: string;
  name: string;
  images: string[] | null;
  shortDescription: string | null;
  description?: string | null;
  retailPriceCents: number | null;
  brand: string | null;
  inStock: boolean;
  measureAmount?: number | null;
  measureUnit?: string | null;
};
const money = (cents: number | null, currency: string) =>
  cents === null
    ? 'Price unavailable'
    : new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(
        cents / 100
      );

export function ShopGrid({
  products,
  currency,
  basePath,
  organizationName,
}: {
  products: Product[];
  currency: string;
  basePath: string;
  organizationName: string;
}) {
  return (
    <div className="min-h-screen bg-background">
      <ShopHeader organizationName={organizationName} basePath={basePath} />
      <div className="border-b bg-primary/5">
        <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-center text-sm sm:px-6">
          <TruckIcon className="size-4 text-muted-foreground" />
          Collect free from {organizationName}
        </p>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Shop
            </p>
            <h1 className="mt-1 font-bold text-3xl">All products</h1>
          </div>
          <p className="hidden text-muted-foreground text-sm sm:block">
            {products.length} {products.length === 1 ? 'product' : 'products'}
          </p>
        </div>
        {products.length ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <li key={p.id}>
                <a
                  href={`${basePath}/shop/${p.id}`}
                  className="group block overflow-hidden rounded-xl border bg-card transition hover:border-primary hover:shadow-sm"
                >
                  <ProductImage product={p} />
                  <div className="space-y-1 p-4">
                    {p.brand ? (
                      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                        {p.brand}
                      </p>
                    ) : null}
                    <h2 className="font-medium text-sm leading-snug group-hover:underline">
                      {p.name}
                    </h2>
                    <p className="font-semibold">
                      {money(p.retailPriceCents, currency)}
                    </p>
                    <p
                      className={`text-sm ${p.inStock ? 'text-green-700' : 'text-muted-foreground'}`}
                    >
                      {p.inStock ? 'In stock' : 'Out of stock — notify me'}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border p-6 text-muted-foreground">
            No retail products are available yet.
          </p>
        )}
      </main>
    </div>
  );
}

export function ShopDetail({
  product,
  currency,
  slug,
  basePath,
  organizationName,
}: {
  product: Product;
  currency: string;
  slug: string;
  basePath: string;
  organizationName: string;
}) {
  const [email, setEmail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle'
  );
  function addToCart() {
    const key = `borradh-shop-cart:${slug}`;
    const cart = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
      productId: string;
      quantity: number;
    }>;
    const line = cart.find((item) => item.productId === product.id);
    if (line) line.quantity += quantity;
    else cart.push({ productId: product.id, quantity });
    localStorage.setItem(key, JSON.stringify(cart));
    window.location.href = `${basePath}/shop/cart`;
  }
  async function notify() {
    setState('sending');
    try {
      const r = await fetch(
        `/api/public/shop/${encodeURIComponent(slug)}/${product.id}/notify-me`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );
      if (!r.ok) throw new Error();
      setState('done');
    } catch {
      setState('error');
    }
  }
  return (
    <div className="min-h-screen bg-background">
      <ShopHeader
        organizationName={organizationName}
        basePath={basePath}
        backHref={`${basePath}/shop`}
        backLabel="Shop"
      />
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0 space-y-6">
          <ProductImage product={product} large />
          <div>
            {product.brand ? (
              <p className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
                {product.brand}
              </p>
            ) : null}
            <h1 className="mt-1 font-bold text-3xl">{product.name}</h1>
            {product.measureAmount ? (
              <p className="mt-2 text-muted-foreground text-sm">
                {product.measureAmount} {product.measureUnit}
              </p>
            ) : null}
            <p className="mt-4 whitespace-pre-wrap text-muted-foreground">
              {product.description ||
                product.shortDescription ||
                'No product description yet.'}
            </p>
          </div>
        </div>
        <aside>
          <section className="rounded-2xl border bg-card p-6 shadow-sm md:sticky md:top-6">
            <p className="font-semibold">{product.name}</p>
            {product.brand ? (
              <p className="text-muted-foreground text-sm">{product.brand}</p>
            ) : null}
            <div className="my-4 border-t" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Price</span>
              <span className="font-semibold text-lg">
                {money(product.retailPriceCents, currency)}
              </span>
            </div>
            {product.inStock ? (
              <>
                <p className="mt-2 text-green-700 text-sm">In stock</p>
                <div className="my-4 border-t" />
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Quantity</span>
                  <div className="inline-flex items-center rounded-lg border">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      className="px-3 py-1.5 text-muted-foreground disabled:opacity-40"
                      disabled={quantity <= 1}
                      onClick={() =>
                        setQuantity((value) => Math.max(1, value - 1))
                      }
                    >
                      −
                    </button>
                    <span className="border-x px-4 py-1.5 font-medium text-sm">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      className="px-3 py-1.5"
                      onClick={() => setQuantity((value) => value + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
                <Button className="mt-5 w-full" size="lg" onClick={addToCart}>
                  Add to basket
                </Button>
              </>
            ) : (
              <section className="mt-5 rounded-xl border bg-muted/30 p-5">
                <h2 className="font-semibold">Out of stock</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Leave your email and we’ll let you know when it’s back. We
                  send one notification per restock.
                </p>
                {state === 'done' ? (
                  <p className="mt-4 text-green-700">You’re on the list.</p>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="you@example.com"
                      aria-label="Email address"
                    />
                    <Button
                      disabled={state === 'sending' || !email}
                      onClick={notify}
                    >
                      Notify me
                    </Button>
                  </div>
                )}
                {state === 'error' ? (
                  <p className="mt-2 text-sm text-destructive">
                    Please enter a valid email and try again.
                  </p>
                ) : null}
              </section>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

function ShopHeader({
  organizationName,
  basePath,
  backHref,
  backLabel,
}: {
  organizationName: string;
  basePath: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {backHref ? (
            <a
              href={backHref}
              className="flex size-8 shrink-0 items-center justify-center rounded-full border"
              aria-label={backLabel ?? 'Go back'}
            >
              <ArrowLeftIcon className="size-4" />
            </a>
          ) : (
            <span className="flex size-7 items-center justify-center rounded-md bg-primary font-semibold text-[11px] text-primary-foreground">
              {organizationName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="truncate font-semibold">
            {backLabel ?? organizationName}
          </span>
        </div>
        <a
          href={`${basePath}/shop/cart`}
          className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-muted"
          aria-label="Your basket"
        >
          <ShoppingBagIcon className="size-4" />
        </a>
      </div>
    </header>
  );
}
function ProductImage({
  product,
  large = false,
}: { product: Product; large?: boolean }) {
  const image = product.images?.[0];
  return image ? (
    <img
      src={image}
      alt=""
      className={`w-full bg-muted object-cover ${large ? 'aspect-square rounded-xl' : 'aspect-square'} ${!product.inStock ? 'opacity-60 grayscale' : ''}`}
    />
  ) : (
    <div
      className={`flex w-full items-center justify-center bg-muted text-muted-foreground ${large ? 'aspect-square rounded-xl' : 'aspect-square'} ${!product.inStock ? 'opacity-60 grayscale' : ''}`}
    >
      Product image
    </div>
  );
}
