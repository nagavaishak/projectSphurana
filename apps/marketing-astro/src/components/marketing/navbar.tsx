'use client';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { PanelLeft, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { BookDemoButton } from './book-demo-button';
import { Container } from './container';
import { Logo } from './logo';
import { Button } from './ui/button';

const navlinks = [
  { title: 'How It Works', href: '/how-it-works' },
  { title: 'Pricing', href: '/pricing' },
  { title: 'About', href: '/about' },
  { title: 'Contact', href: '/contact' },
];

const NavButtons = () => {
  const { appUrl } = useRuntimeConfig();
  return (
    <>
      <Button variant="ghost" asChild>
        <a href={`${appUrl}/sign-in`}>Sign In</a>
      </Button>
      <BookDemoButton />
    </>
  );
};

export const Navbar = () => {
  return (
    <div className="border-b border-neutral-200 dark:border-neutral-800">
      <DesktopNavbar />
      <MobileNavbar />
    </div>
  );
};

export const DesktopNavbar = () => {
  return (
    <Container className="hidden items-center justify-between py-4 md:flex">
      <Logo />
      <div className="flex items-center gap-8 lg:gap-10">
        {navlinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm font-medium text-neutral-600 transition duration-200 hover:text-black dark:text-neutral-400 dark:hover:text-white"
          >
            {item.title}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <NavButtons />
      </div>
    </Container>
  );
};

export const MobileNavbar = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-between px-4 py-3 md:hidden">
      <Logo />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Open menu"
      >
        <PanelLeft className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, backdropFilter: 'blur(15px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex h-full w-full flex-col justify-between bg-white/90 px-4 py-3 dark:bg-neutral-950/90"
          >
            <div>
              <div className="flex justify-between">
                <Logo />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                >
                  <X />
                </button>
              </div>

              <div className="my-10 flex flex-col gap-6">
                {navlinks.map((item, index) => (
                  <motion.div
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.1 }}
                    key={item.href}
                  >
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="text-2xl font-medium text-neutral-600 dark:text-neutral-400"
                    >
                      {item.title}
                    </Link>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-4">
              <NavButtons />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
