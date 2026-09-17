import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

type ClaireMood = 'calm' | 'excited' | 'thinking' | 'celebrating';
type ClaireSize = 'lg' | 'md' | 'sm' | 'xs';

interface ClaireAvatarProps {
  mood?: ClaireMood;
  size?: ClaireSize;
  className?: string;
  noBg?: boolean;
}

const MOOD_CONFIG: Record<
  ClaireMood,
  {
    duration: number;
    radiusScale: [number, number];
    opacityRange: [number, number];
  }
> = {
  calm: { duration: 4, radiusScale: [0.7, 1.3], opacityRange: [0.4, 0.8] },
  excited: { duration: 1.8, radiusScale: [0.3, 2.0], opacityRange: [0.3, 1] },
  thinking: { duration: 2.5, radiusScale: [0.5, 1.5], opacityRange: [0.2, 1] },
  celebrating: {
    duration: 1.2,
    radiusScale: [0.2, 2.5],
    opacityRange: [0.3, 1],
  },
};

const SIZE_CONFIG: Record<
  ClaireSize,
  { pixels: number; dots: number; dotRadius: number }
> = {
  lg: { pixels: 200, dots: 400, dotRadius: 1.8 },
  md: { pixels: 120, dots: 300, dotRadius: 1.5 },
  sm: { pixels: 80, dots: 200, dotRadius: 1.2 },
  xs: { pixels: 44, dots: 140, dotRadius: 0.9 },
};

function ClaireAvatar({
  mood = 'calm',
  size = 'lg',
  noBg = false,
  className,
}: ClaireAvatarProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { pixels, dots, dotRadius } = SIZE_CONFIG[size];
  const { duration, radiusScale, opacityRange } = MOOD_CONFIG[mood];

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    const CENTER = pixels / 2;
    const MARGIN = 2;
    const MAX_RADIUS = CENTER - MARGIN - dotRadius;
    const svgNS = 'http://www.w3.org/2000/svg';

    svg.innerHTML = '';

    for (let i = 0; i < dots; i++) {
      const idx = i + 0.5;
      const frac = idx / dots;
      const r = Math.sqrt(frac) * MAX_RADIUS;
      const theta = idx * GOLDEN_ANGLE;
      const x = CENTER + r * Math.cos(theta);
      const y = CENTER + r * Math.sin(theta);

      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', x.toString());
      c.setAttribute('cy', y.toString());
      c.setAttribute('r', dotRadius.toString());
      c.setAttribute('fill', 'currentColor');
      c.setAttribute('opacity', opacityRange[0].toString());
      svg.appendChild(c);

      const animR = document.createElementNS(svgNS, 'animate');
      animR.setAttribute('attributeName', 'r');
      animR.setAttribute(
        'values',
        `${dotRadius * radiusScale[0]};${dotRadius * radiusScale[1]};${dotRadius * radiusScale[0]}`
      );
      animR.setAttribute('dur', `${duration}s`);
      animR.setAttribute('begin', `${frac * duration}s`);
      animR.setAttribute('repeatCount', 'indefinite');
      animR.setAttribute('calcMode', 'spline');
      animR.setAttribute('keySplines', '0.4 0 0.6 1;0.4 0 0.6 1');
      c.appendChild(animR);

      const animO = document.createElementNS(svgNS, 'animate');
      animO.setAttribute('attributeName', 'opacity');
      animO.setAttribute(
        'values',
        `${opacityRange[0]};${opacityRange[1]};${opacityRange[0]}`
      );
      animO.setAttribute('dur', `${duration}s`);
      animO.setAttribute('begin', `${frac * duration}s`);
      animO.setAttribute('repeatCount', 'indefinite');
      animO.setAttribute('calcMode', 'spline');
      animO.setAttribute('keySplines', '0.4 0 0.6 1;0.4 0 0.6 1');
      c.appendChild(animO);
    }
  }, [dots, pixels, dotRadius, duration, radiusScale, opacityRange]);

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        !noBg && 'bg-primary text-primary-foreground',
        noBg && 'text-primary',
        size === 'lg' && 'h-[200px] w-[200px]',
        size === 'md' && 'h-[120px] w-[120px]',
        size === 'sm' && 'h-[80px] w-[80px]',
        size === 'xs' && 'h-[44px] w-[44px]',
        className
      )}
    >
      <svg
        ref={svgRef}
        width={pixels}
        height={pixels}
        viewBox={`0 0 ${pixels} ${pixels}`}
        aria-hidden="true"
      />
    </div>
  );
}

export { ClaireAvatar };
export type { ClaireAvatarProps, ClaireMood, ClaireSize };
