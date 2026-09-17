import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const PAUSE_DURATION_MS = 7000;
/** Reading line position within the overlay (matches the marker at top-[100px]). */
const READING_LINE_Y = 100;

function isPauseMarker(line: string): boolean {
  return /^\[.+\]$/.test(line.trim());
}

interface ParsedLine {
  text: string;
  isPause: boolean;
}

function parseScript(script: string): ParsedLine[] {
  return script.split('\n').map((raw) => ({
    text: raw,
    isPause: isPauseMarker(raw),
  }));
}

interface ScrollSegment {
  type: 'scroll';
  targetY: number;
  durationMs: number;
}

interface PauseSegment {
  type: 'pause';
  targetY: number;
  durationMs: number;
}

type PlanSegment = ScrollSegment | PauseSegment;

/**
 * Build the scroll plan from the *measured* DOM offsets of each rendered line
 * rather than a chars-per-line estimate. The estimate undershot on narrow
 * screens (lines wrap more than assumed), which left the final lines below the
 * reading line and never scrolled into view. Measuring guarantees the last
 * line reaches the reading line.
 */
function buildScrollPlan(
  lineEls: HTMLElement[],
  parsed: ParsedLine[],
  speed: number
): PlanSegment[] {
  if (lineEls.length === 0) return [];
  const plan: PlanSegment[] = [];
  let prevY = 0;

  const pushScroll = (targetY: number) => {
    if (targetY <= prevY) return;
    plan.push({
      type: 'scroll',
      targetY,
      durationMs: ((targetY - prevY) / speed) * 1000,
    });
    prevY = targetY;
  };

  lineEls.forEach((el, i) => {
    if (parsed[i]?.isPause) {
      const y = el.offsetTop;
      pushScroll(y);
      plan.push({ type: 'pause', targetY: y, durationMs: PAUSE_DURATION_MS });
    }
  });

  // Scroll until the last line reaches the reading line so it's fully read.
  const lastEl = lineEls[lineEls.length - 1];
  pushScroll(lastEl.offsetTop + lastEl.offsetHeight);

  return plan;
}

export interface TeleprompterOverlayHandle {
  start: () => void;
  stop: () => void;
}

interface TeleprompterOverlayProps {
  script: string;
  speed: number;
  controlRef: React.Ref<TeleprompterOverlayHandle>;
}

export function TeleprompterOverlay({
  script,
  speed,
  controlRef,
}: TeleprompterOverlayProps) {
  const lines = useRef<ParsedLine[]>(parseScript(script));
  const scrollRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    lines.current = parseScript(script);
  }, [script]);

  const stopScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startScroll = useCallback(() => {
    stopScroll();
    scrollRef.current = 0;
    setScrollY(0);

    const lineEls = contentRef.current
      ? (Array.from(contentRef.current.children) as HTMLElement[])
      : [];
    const plan = buildScrollPlan(lineEls, lines.current, speed);
    if (plan.length === 0) return;

    let segmentIndex = 0;
    let segmentStartTime: number | null = null;
    let segmentStartY = 0;

    const animate = (timestamp: number) => {
      if (segmentIndex >= plan.length) return;
      const segment = plan[segmentIndex];

      if (segmentStartTime === null) {
        segmentStartTime = timestamp;
        segmentStartY = scrollRef.current;
      }

      const elapsed = timestamp - segmentStartTime;
      const progress = Math.min(elapsed / segment.durationMs, 1);

      if (segment.type === 'scroll') {
        const newY =
          segmentStartY + (segment.targetY - segmentStartY) * progress;
        scrollRef.current = newY;
        setScrollY(newY);
      }

      if (progress >= 1) {
        segmentIndex++;
        segmentStartTime = null;
        segmentStartY = scrollRef.current;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [speed, stopScroll]);

  useImperativeHandle(
    controlRef,
    () => ({ start: startScroll, stop: stopScroll }),
    [startScroll, stopScroll]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const parsedLines = parseScript(script);

  return (
    <div className="pointer-events-none absolute bottom-[120px] left-0 right-0 z-20 h-[200px] overflow-hidden">
      <div className="absolute inset-x-0 top-0 z-10 h-[60px] bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-8 top-[100px] z-10 h-[2px] bg-primary/60" />
      <div
        ref={contentRef}
        className="absolute inset-x-0 top-0"
        style={{ transform: `translateY(${READING_LINE_Y - scrollY}px)` }}
      >
        {parsedLines.map((line, i) => (
          <p
            key={i}
            className={`px-8 text-center text-2xl leading-8 text-white ${
              line.isPause ? 'italic text-white/50' : ''
            }`}
            style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
          >
            {line.text || ' '}
          </p>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 h-[60px] bg-gradient-to-t from-black/50 to-transparent" />
    </div>
  );
}
