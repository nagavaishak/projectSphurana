import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

function getIsMobileViewport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(getIsMobileViewport);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(getIsMobileViewport());
    };
    mql.addEventListener('change', onChange);
    setIsMobile(getIsMobileViewport());
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
