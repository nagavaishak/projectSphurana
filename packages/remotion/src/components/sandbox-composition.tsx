import type React from 'react';
import { AbsoluteFill } from 'remotion';
import { z } from 'zod';
import { TypewriterText, typewriterTextSchema } from './typewriter-text';

export const sandboxCompositionSchema = z.object({
  backgroundColor: z.string().default('#F5F5F0'),
  verticalPosition: z.number().min(0).max(1).default(0.4),
  horizontalPaddingPercent: z.number().min(0).max(40).default(8),
  typewriter: typewriterTextSchema,
});

export type SandboxCompositionProps = z.infer<typeof sandboxCompositionSchema>;

export const SandboxComposition: React.FC<SandboxCompositionProps> = ({
  backgroundColor,
  verticalPosition,
  horizontalPaddingPercent,
  typewriter,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <AbsoluteFill
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          paddingTop: `${verticalPosition * 100}%`,
          paddingLeft: `${horizontalPaddingPercent}%`,
          paddingRight: `${horizontalPaddingPercent}%`,
        }}
      >
        <TypewriterText {...typewriter} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
