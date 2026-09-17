import { Link } from '@tanstack/react-router';

export function Logo() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 text-xl font-bold tracking-tight"
    >
      <img
        src="/logo-icon.svg"
        alt=""
        aria-hidden
        className="h-6 w-6 rounded-md"
      />
      Borradh
    </Link>
  );
}
