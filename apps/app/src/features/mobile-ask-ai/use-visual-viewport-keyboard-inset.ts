import { useEffect, useState } from 'react';

/**
 * Approximate bottom inset when the on-screen keyboard shrinks `visualViewport`
 * (mobile browsers / WebViews). Used to pad the Ask AI sheet so the composer
 * stays above the keyboard.
 */
export function useVisualViewportKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const h = vv.height;
      const bottom = Math.max(0, window.innerHeight - h - vv.offsetTop);
      setInset(bottom > 24 ? bottom : 0);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();

    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  return inset;
}
