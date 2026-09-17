import { cn } from '@/lib/utils';
import { Instagram, Linkedin, Mail, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { Container } from './container';
import { Logo } from './logo';
import { ModeToggle } from './mode-toggle';

export const Footer = () => {
  const links = [
    { title: 'Contact', href: '/contact' },
    { title: 'Privacy Policy', href: '/privacy' },
    { title: 'Terms of Service', href: '/terms' },
  ];

  return (
    <footer className="border-t perspective-distant overflow-hidden border-neutral-200 dark:border-neutral-800 py-10 md:py-20 lg:py-32 relative">
      <Container className="grid grid-cols-1 lg:grid-cols-5 gap-10 relative z-20">
        <div className="lg:col-span-2 flex flex-col gap-4 items-start">
          <Logo />
        </div>
        <div className="flex flex-col gap-4">
          <h4 className="text-base font-medium text-neutral-400">Links</h4>
          <ul className="list-none flex flex-col gap-2">
            {links.map((item) => (
              <li key={item.title}>
                <Link
                  href={item.href}
                  className="text-neutral-600 text-sm hover:text-black dark:text-neutral-400 dark:hover:text-white transition duration-200"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          <h4 className="text-base font-medium text-neutral-400">Contact</h4>
          <ul className="list-none flex flex-col gap-2 text-neutral-600 dark:text-neutral-400 text-sm">
            <li>
              <a
                href="mailto:senan@borradh.io"
                className="flex items-center gap-2 hover:text-black dark:hover:text-white transition duration-200"
              >
                <Mail className="size-4 shrink-0" />
                senan@borradh.io
              </a>
            </li>
            <li>
              <a
                href="tel:+353877871690"
                className="flex items-center gap-2 hover:text-black dark:hover:text-white transition duration-200"
              >
                <Phone className="size-4 shrink-0" />
                +353 87 787 1690
              </a>
            </li>
            <li>
              <span className="flex items-start gap-2">
                <MapPin className="size-4 shrink-0 mt-0.5" />
                Dogpatch Labs, CHQ Building, Dublin City
              </span>
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          <h4 className="text-base font-medium text-neutral-400">Follow</h4>
          <div className="flex items-center gap-3">
            <a
              href="https://www.linkedin.com/in/senan-ryan-188345387"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition duration-200"
              aria-label="LinkedIn"
            >
              <Linkedin className="size-5" />
            </a>
            <a
              href="https://www.instagram.com/borradh.ie/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition duration-200"
              aria-label="Instagram"
            >
              <Instagram className="size-5" />
            </a>
          </div>
        </div>
      </Container>

      <Container className="flex flex-col sm:flex-row justify-between mt-10 relative z-20 gap-4 md:gap-0">
        <p className="text-sm text-neutral-500">
          © 2026 Borradh Technologies Limited. All rights reserved.
        </p>

        <div className="flex md:items-end items-start flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 *:text-sm *:text-neutral-500">
              <Link href="/data-deletion">Data Deletion</Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ModeToggle />
          </div>
        </div>
      </Container>

      <div
        className={cn(
          'flex items-center justify-center gap-20 h-[200%]',
          'absolute -inset-x-[150%] -inset-y-40',
          '[background-size:40px_40px]',
          '[background-image:linear-gradient(to_right,var(--color-neutral-100)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-neutral-100)_1px,transparent_1px)]',
          'dark:[background-image:linear-gradient(to_right,var(--color-neutral-900)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-neutral-900)_1px,transparent_1px)]',
          'mask-radial-from-50%'
        )}
        style={{ transform: ' rotateX(60deg) ' }}
      />
    </footer>
  );
};
