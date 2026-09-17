export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-black/70 dark:text-white/70">
        We couldn't find what you were looking for.
      </p>
      <a href="/" className="inline-block underline">
        Back home
      </a>
    </div>
  );
}
