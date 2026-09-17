import type React from 'react';
import { z } from 'zod';

export const strokedTextStyleSchema = z.object({
  fontFamily: z.string().default('Inter, system-ui, sans-serif'),
  fontWeight: z.number().int().min(100).max(900).default(900),
  fontSize: z.number().min(8).max(400).default(96),
  fillColor: z.string().default('#000000'),
  strokeColor: z.string().default('#FFFFFF'),
  strokeWidth: z.number().min(0).max(40).default(8),
  letterSpacing: z.string().default('0em'),
  lineHeight: z.number().min(0.6).max(2.5).default(1.1),
  textTransform: z
    .enum(['none', 'uppercase', 'lowercase', 'capitalize'])
    .default('none'),
  textAlign: z.enum(['left', 'center', 'right']).default('center'),
  textShadow: z.string().optional(),
});

export type StrokedTextStyle = z.infer<typeof strokedTextStyleSchema>;

export interface StrokedTextProps extends Partial<StrokedTextStyle> {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const StrokedText: React.FC<StrokedTextProps> = ({
  children,
  style,
  fontFamily = 'Inter, system-ui, sans-serif',
  fontWeight = 900,
  fontSize = 96,
  fillColor = '#000000',
  strokeColor = '#FFFFFF',
  strokeWidth = 8,
  letterSpacing = '0em',
  lineHeight = 1.1,
  textTransform = 'none',
  textAlign = 'center',
  textShadow,
}) => {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily,
        fontWeight,
        fontSize,
        color: fillColor,
        letterSpacing,
        lineHeight,
        textTransform,
        textAlign,
        textShadow,
        // paintOrder draws the stroke behind the fill so the fill stays crisp
        WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
        paintOrder: 'stroke fill',
        ...style,
      }}
    >
      {children}
    </span>
  );
};
