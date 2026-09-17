// Shim for `next/image`. The marketing site ships unoptimized images, so a
// plain <img> is a faithful replacement. Next.js-only props are ignored.
import { type CSSProperties, type ImgHTMLAttributes, forwardRef } from 'react';

type ImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'width' | 'height'
> & {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    width,
    height,
    fill,
    priority,
    quality: _quality,
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    unoptimized: _unoptimized,
    loader: _loader,
    style,
    sizes,
    ...rest
  },
  ref
) {
  // `fill` in next/image absolutely positions the image to fill a
  // `position: relative` parent.
  const resolvedStyle: CSSProperties | undefined = fill
    ? {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        ...style,
      }
    : style;

  return (
    // biome-ignore lint/a11y/useAltText: alt is a required prop, always forwarded
    <img
      ref={ref}
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      style={resolvedStyle}
      {...rest}
    />
  );
});

export default Image;
