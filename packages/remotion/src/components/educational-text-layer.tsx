import { loadFont } from '@remotion/google-fonts/PlayfairDisplay';
import type React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from 'remotion';
import type {
  EducationalConfig,
  VideoOrientation,
} from '../types/video-config';

// Constrain to the single variant we render. A bare loadFont() registers the
// full cartesian product (italic × cyrillic/vietnamese/latin-ext × all weights),
// each a separate delayRender fetch — which times out the Lambda render.
const { fontFamily: playfairFamily } = loadFont('normal', {
  weights: ['400', '700'],
  subsets: ['latin'],
});

export interface EducationalTextLayerProps {
  config: EducationalConfig;
  fps: number;
  orientation: VideoOrientation;
}

/**
 * EducationalTextLayer - progressive stacking layout with beat-synced entrances.
 *
 * A question appears at the top, items slide in below it one by one and STAY visible,
 * then a CTA button appears at the bottom as the ending.
 *
 * All animations are synced to music BPM for a rhythmic feel.
 */
export const EducationalTextLayer: React.FC<EducationalTextLayerProps> = ({
  config,
  fps,
  orientation,
}) => {
  const frame = useCurrentFrame();
  const {
    questionText,
    items,
    ctaText,
    primaryColor,
    bpm = 100,
    beatsPerItem = 4,
  } = config;

  const isPortrait = orientation === 'portrait';
  const scale = isPortrait ? 1 : 0.8;

  // Beat timing
  const framesPerBeat = Math.round((60 / bpm) * fps);
  const framesPerItem = framesPerBeat * beatsPerItem;

  // Entrance frames for each element
  // Question: frame 0
  // Item N: framesPerItem * (N + 1)
  // CTA: framesPerItem * (items.length + 1)
  const questionEntranceFrame = 0;
  const itemEntranceFrames = items.map((_, i) => framesPerItem * (i + 1));
  const ctaEntranceFrame = framesPerItem * (items.length + 1);

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: isPortrait ? '15% 48px 10% 48px' : '8% 120px 6% 120px',
        gap: isPortrait ? 28 : 22,
      }}
    >
      {/* Question text */}
      <QuestionElement
        text={questionText}
        primaryColor={primaryColor}
        entranceFrame={questionEntranceFrame}
        frame={frame}
        fps={fps}
        scale={scale}
      />

      {/* Items */}
      {items.map((text, index) => (
        <ItemElement
          key={`item-${index}`}
          text={text}
          entranceFrame={itemEntranceFrames[index]}
          frame={frame}
          fps={fps}
          scale={scale}
        />
      ))}

      {/* CTA button */}
      <CtaElement
        text={ctaText}
        primaryColor={primaryColor}
        entranceFrame={ctaEntranceFrame}
        frame={frame}
        fps={fps}
        scale={scale}
      />
    </AbsoluteFill>
  );
};

/**
 * Question element - serif italic, brand primary color, fade + scale spring
 */
const QuestionElement: React.FC<{
  text: string;
  primaryColor: string;
  entranceFrame: number;
  frame: number;
  fps: number;
  scale: number;
}> = ({ text, primaryColor, entranceFrame, frame, fps, scale }) => {
  const localFrame = frame - entranceFrame;
  if (localFrame < 0) return null;

  const fadeIn = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const scaleSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 20, stiffness: 120, mass: 0.8 },
  });
  const scaleValue = interpolate(scaleSpring, [0, 1], [0.92, 1]);

  return (
    <div
      style={{
        opacity: fadeIn,
        transform: `scale(${scaleValue})`,
        textAlign: 'center',
        maxWidth: '90%',
      }}
    >
      <span
        style={{
          fontFamily: `${playfairFamily}, Georgia, serif`,

          fontSize: 60 * scale,
          fontWeight: 700,
          color: primaryColor,
          lineHeight: 1.25,
          textShadow: '0 2px 16px rgba(0,0,0,0.4), 0 0 40px rgba(0,0,0,0.2)',
        }}
      >
        {text}
      </span>
    </div>
  );
};

/**
 * Item element - white pill card, dark text, uppercase, slide up + fade
 */
const ItemElement: React.FC<{
  text: string;
  entranceFrame: number;
  frame: number;
  fps: number;
  scale: number;
}> = ({ text, entranceFrame, frame, fps, scale }) => {
  const localFrame = frame - entranceFrame;
  if (localFrame < 0) return null;

  const slideSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 100, mass: 0.8 },
  });

  const translateY = interpolate(slideSpring, [0, 1], [60, 0]);
  const fadeIn = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        opacity: fadeIn,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 50,
          padding: `${18 * scale}px ${40 * scale}px`,
          maxWidth: '90%',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 34 * scale,
            fontWeight: 500,
            color: '#1a1a1a',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};

/**
 * CTA button element - brand primary BG, white text, slide up + fade (slightly bouncier)
 */
const CtaElement: React.FC<{
  text: string;
  primaryColor: string;
  entranceFrame: number;
  frame: number;
  fps: number;
  scale: number;
}> = ({ text, primaryColor, entranceFrame, frame, fps, scale }) => {
  const localFrame = frame - entranceFrame;
  if (localFrame < 0) return null;

  const slideSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 15, stiffness: 100, mass: 0.8 },
  });

  const translateY = interpolate(slideSpring, [0, 1], [60, 0]);
  const fadeIn = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        opacity: fadeIn,
        transform: `translateY(${translateY}px)`,
        marginTop: 8 * scale,
      }}
    >
      <div
        style={{
          background: primaryColor,
          borderRadius: 50,
          padding: `${22 * scale}px ${48 * scale}px`,
          maxWidth: '90%',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 32 * scale,
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};
