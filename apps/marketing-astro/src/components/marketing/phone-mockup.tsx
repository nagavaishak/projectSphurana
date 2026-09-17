'use client';

import { cn } from '@/lib/utils';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Realistic phone + chat mockups — the core visual of the marketing site.
 * The product is an AI that talks to you on WhatsApp, so we show that: a phone
 * frame containing a real-looking conversation thread. No dashboards, ever.
 *
 * ## How this scales
 *
 * The screen area is a CSS container (`container-type: inline-size`) and every
 * dimension inside it is expressed in `cqw` (1cqw = 1% of the screen's width).
 * The mock is therefore pixel-proportional at any width with no media queries —
 * change `max-w-*` on the wrapper and the whole thread rescales with it.
 *
 * The screen is 402pt wide (iPhone 16 Pro logical width), so real iOS
 * measurements convert as **cqw = pt / 4.02**. That is where the odd-looking
 * numbers come from: 17pt SF body text → 4.23cqw, 18pt bubble radius → 4.48cqw.
 * Use that conversion rather than eyeballing values.
 *
 * Swapping the frame for another device means re-deriving that divisor from its
 * screen width — a Pro Max is 440pt, so every constant here would be ~9% out.
 *
 * ## The frame
 *
 * `frameSrc` is a device bezel PNG whose screen area is transparent. It is
 * overlaid ON TOP of the live DOM (`z-10`, `pointer-events-none`), so the
 * thread underneath stays real text: selectable, translatable, restyleable.
 * The PNG's transparent window sits at inset-x 5.333% / inset-y 2.5% (measured
 * from its alpha channel — that is `SCREEN_INSET`), and it already contains the
 * Dynamic Island, so we do not draw one.
 *
 * If the PNG is missing the component falls back to a CSS-drawn bezel of the
 * same geometry, so a missing asset degrades instead of breaking the page.
 */

/** Device bezel PNG: 900×1840, screen window 804×1748 = 402×874pt at 2x. */
const DEFAULT_FRAME_SRC = '/illustrations/devices/iphone-16-pro.png';

/** Aspect ratio of the frame PNG (900×1840). */
const FRAME_ASPECT = '900 / 1840';

/** Transparent screen window inside the frame PNG, measured from its alpha channel. */
const SCREEN_INSET = {
  left: '5.333%',
  right: '5.333%',
  top: '2.5%',
  bottom: '2.5%',
};

/** iOS renders its UI in SF; `wdth 100` stops the variable font optically narrowing. */
const IOS_FONT = {
  fontFamily:
    'system-ui, -apple-system, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
  fontVariationSettings: "'wdth' 100",
} as const;

/** iOS system colours, sampled from a real iOS 26 Messages thread. */
const IOS = {
  glass: '#f7f7f7f2',
  textPrimary: '#000000',
  textSecondary: '#3c3c4399',
  toolbarIcon: '#404040',
  placeholder: '#d9d9d9',
  overlay: '#0000000d',
  bg: '#ffffff',
  bubbleReceived: '#e9e9ea',
  bubbleSent: '#0088ff',
} as const;

/** The hairline + soft drop shadow iOS puts under every floating glass control. */
const GLASS_SHADOW =
  'shadow-[0_0_0_0.12cqw_rgba(0,0,0,0.04),0_0.5cqw_1.5cqw_-0.25cqw_rgba(0,0,0,0.05)]';

/**
 * Reveal choreography. Each message plays as a beat: the older messages shift
 * up to make room, then the new bubble settles into the gap.
 *
 * `SHIFT_EASE` is easeOutCubic. The shift is the motion the eye actually
 * tracks, so it wants a long tail — most of the distance is covered early and
 * it glides to rest.
 */
const SHIFT_S = 0.35;
const SHIFT_EASE = [0.33, 1, 0.68, 1] as const;
const REVEAL_S = 0.3;

/** Pause before the next message lands. Pace it like speech, not a stagger:
 *  a short beat can deserve a long pause. Override per message via `delayMs`. */
const DEFAULT_BEAT_MS = 1800;

/** How long the finished conversation sits before it clears and replays. */
const REPLAY_HOLD_MS = 4500;

export type ChatMessage = {
  /** `them` = the AI/contact (left, incoming). `me` = the phone owner (right, outgoing). */
  from: 'them' | 'me';
  /** Pause before this message lands, in ms. Defaults to `DEFAULT_BEAT_MS`.
   *  Tune per message — pacing is a writing decision, not a formula. */
  delayMs?: number;
  /** Message text. Use string[] for multi-line bullet lists (rendered on their own lines). */
  text?: string | string[];
  /** Small timestamp shown under the bubble, e.g. "07:12". Ignored by `imessage`,
   *  which shows a single thread-level divider instead (see `threadDate`). */
  time?: string;
  /** Show blue double-tick read receipt (WhatsApp outgoing messages only). */
  read?: boolean;
  /** Render N image thumbnails inside the bubble (WhatsApp media style). */
  media?: number;
  /** Render a payment/link chip inside the bubble. */
  link?: string;
  /**
   * Full-bleed photo message: the image *is* the bubble, with no padding or
   * background behind it. Pass several and they fan into a stack — first on
   * top — the way a batch of photos lands as one message rather than a row of
   * separate ones. Pass an empty array and a placeholder stands in, so the
   * layout is honest about being unfinished rather than faking a photo.
   */
  photos?: { src?: string; alt?: string }[];
  /**
   * Display crop for a photo message, independent of the files' own ratios —
   * `object-cover` does the rest, so any photo drops in as-is. Defaults to the
   * 9:16 of social content.
   */
  photoAspect?: string;
};

/** Portrait 9:16 (reels/stories) sized to the same height as a 4:5 at 54cqw. */
const PHOTO_WIDTH = 'w-[38cqw]';
const PHOTO_ASPECT = '9 / 16';
/** Photos sit on the thread rather than in it, so they cast a real shadow. */
const PHOTO_SHADOW = 'shadow-[0_0.5cqw_2cqw_rgba(8,21,46,0.28)]';

/** Per-photo step down the stack: right, down, and turned. */
const FAN_X_CQW = 8.5;
const FAN_Y_CQW = 0.8;
const FAN_DEG = 2;

type ChatVariant = 'whatsapp' | 'instagram' | 'imessage';

const OutgoingTicks = ({ read }: { read?: boolean }) => (
  <svg
    viewBox="0 0 16 11"
    className="ml-[0.5cqw] inline-block h-[2.7cqw] w-[3.9cqw] shrink-0 self-end"
    fill="none"
    aria-hidden="true"
  >
    <title>Delivered</title>
    <path
      d="M11.07.65 4.34 8.42 1.53 5.6l-.71.71 3.52 3.52L11.78 1.36 11.07.65Z"
      fill={read ? '#53BDEB' : '#8C9EA3'}
    />
    <path
      d="M14.07.65 7.34 8.42 6.1 7.17l-.71.71 1.95 1.95L14.78 1.36 14.07.65Z"
      fill={read ? '#53BDEB' : '#8C9EA3'}
    />
  </svg>
);

const MediaThumbs = ({ count }: { count: number }) => (
  <div className="mb-[1cqw] flex gap-[1cqw]">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="relative size-[20cqw] overflow-hidden rounded-[2cqw]"
        style={{
          background:
            i % 3 === 0
              ? 'linear-gradient(135deg,#c7d2fe,#818cf8)'
              : i % 3 === 1
                ? 'linear-gradient(135deg,#fbcfe8,#f472b6)'
                : 'linear-gradient(135deg,#bbf7d0,#4ade80)',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center text-white/90">
          <svg
            viewBox="0 0 24 24"
            className="size-[8cqw]"
            fill="none"
            aria-hidden="true"
          >
            <title>Photo</title>
            <path
              d="M4 5h16v14H4V5Zm2 2v7l4-3 3 3 3-4 2 2V7H6Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    ))}
  </div>
);

/**
 * `onAccent` = the chip is sitting on a coloured (blue) outgoing bubble rather
 * than a light one. Without it the chip renders brand-blue on brand-blue and
 * disappears, since `bg-black/5` is near-transparent over the bubble.
 */
const LinkChip = ({
  label,
  onAccent,
}: { label: string; onAccent?: boolean }) => (
  <div
    className={cn(
      'mb-[1cqw] flex items-center gap-[2cqw] rounded-[2.5cqw] px-[2.5cqw] py-[2cqw]',
      onAccent ? 'bg-white/20' : 'bg-black/5'
    )}
  >
    <span
      className={cn(
        'flex size-[6cqw] shrink-0 items-center justify-center rounded-full',
        onAccent ? 'bg-white text-brand' : 'bg-brand text-brand-foreground'
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[3.5cqw]"
        fill="none"
        aria-hidden
      >
        <title>Link</title>
        <path
          d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M14 11a5 5 0 0 0-7.07 0L5.5 12.4a5 5 0 0 0 7.07 7.07L14 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
    <span
      className={cn(
        'truncate text-[3.2cqw] font-medium',
        onAccent ? 'text-white' : 'text-brand'
      )}
    >
      {label}
    </span>
  </div>
);

/**
 * The images are the bubble: full-bleed, cropped, same radius as a text bubble.
 *
 * Every photo fills the same box and is fanned out from it by index, so the
 * stack takes the space of one photo no matter how many there are. The first
 * sits on top — z-index counts down — and each one behind steps right, down and
 * around, leaving the edge of the next visible.
 */
const PhotoBody = ({
  photos,
}: { photos: NonNullable<ChatMessage['photos']> }) => (
  <>
    {photos.map((photo, i) => {
      const style = {
        zIndex: photos.length - i,
        transformOrigin: 'center center',
        transform: `translate(${i * FAN_X_CQW}cqw, ${i * FAN_Y_CQW}cqw) rotate(${i * FAN_DEG}deg)`,
      };
      const className = cn(
        'absolute inset-0 h-full w-full select-none rounded-[4.98cqw] object-cover',
        PHOTO_SHADOW
      );
      return photo.src ? (
        <img
          key={photo.src}
          src={photo.src}
          alt={photo.alt ?? ''}
          aria-hidden={photo.alt ? undefined : true}
          draggable={false}
          className={className}
          style={style}
        />
      ) : (
        <div
          key={i}
          className={className}
          style={{
            ...style,
            background: 'linear-gradient(135deg,#c7d2fe,#818cf8)',
          }}
        />
      );
    })}
  </>
);

const Bubble = ({
  msg,
  variant,
}: {
  msg: ChatMessage;
  variant: ChatVariant;
}) => {
  const isMe = msg.from === 'me';
  const isIMessage = variant === 'imessage';
  const isPhoto = !!msg.photos?.length;
  const lines = Array.isArray(msg.text) ? msg.text : msg.text ? [msg.text] : [];

  // WhatsApp: white incoming / light-green outgoing. Instagram: grey incoming /
  // blue outgoing. iMessage: iOS grey incoming / iOS blue outgoing. The page
  // around the phone stays white regardless.
  const bubbleStyle = isMe
    ? variant === 'whatsapp'
      ? { background: '#D9FDD3', color: '#171717' }
      : variant === 'instagram'
        ? undefined // brand token, applied via class below
        : { background: IOS.bubbleSent, color: '#ffffff' }
    : variant === 'whatsapp'
      ? { background: '#ffffff', color: '#171717' }
      : variant === 'instagram'
        ? { background: '#EFEFEF', color: '#171717' }
        : { background: IOS.bubbleReceived, color: IOS.textPrimary };

  return (
    // Bubbles never move once placed — the thread is top-anchored, so a new
    // message lands below the last one without disturbing it. All scrolling is
    // done by translating the whole column (see Thread).
    <div className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.985, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: REVEAL_S, ease: 'easeOut' }}
        className={cn(
          isPhoto
            ? cn('relative', PHOTO_WIDTH)
            : cn(
                // 280pt max width, 17pt text — see the pt→cqw note at the top.
                'relative max-w-[69.65cqw] text-[4.23cqw] leading-[1.3]',
                // iOS 26 Messages draws a uniform 20pt radius with no tail, and
                // sits flat. The IM/WA skins keep a tail and a slight lift.
                isIMessage
                  ? 'rounded-[4.98cqw] px-[2.99cqw] py-[2.24cqw]'
                  : cn(
                      'rounded-[4.48cqw] px-[2.5cqw] py-[1.5cqw] shadow-[0_0.25cqw_0.5cqw_rgba(0,0,0,0.06)]',
                      isMe ? 'rounded-br-[1.5cqw]' : 'rounded-bl-[1.5cqw]'
                    ),
                isMe && variant === 'instagram' ? 'bg-brand text-white' : ''
              )
        )}
        style={{
          ...IOS_FONT,
          // A photo has no bubble chrome behind it — the image is the bubble.
          ...(isPhoto
            ? { aspectRatio: msg.photoAspect ?? PHOTO_ASPECT }
            : bubbleStyle),
          // Grow out of the corner the message came from.
          transformOrigin: isMe ? '100% 100%' : '0% 100%',
        }}
      >
        {msg.photos?.length ? <PhotoBody photos={msg.photos} /> : null}
        {msg.media ? <MediaThumbs count={msg.media} /> : null}
        {msg.link ? (
          // Outgoing Instagram/iMessage bubbles are blue; WhatsApp's are light.
          <LinkChip
            label={msg.link}
            onAccent={isMe && variant !== 'whatsapp'}
          />
        ) : null}
        {lines.map((line, i) => (
          <p
            key={i}
            className={cn(
              line.startsWith('•') ? 'pl-[1cqw]' : '',
              i > 0 ? 'mt-[0.5cqw]' : ''
            )}
          >
            {line}
          </p>
        ))}
        {/* iMessage stamps the thread once at the top, not per bubble. */}
        {!isIMessage && (msg.time || (isMe && variant === 'whatsapp')) ? (
          <span
            className={cn(
              'flex items-center justify-end gap-[0.4cqw] text-[2.74cqw] leading-none',
              isMe && variant === 'instagram'
                ? 'text-white/70'
                : 'text-neutral-500'
            )}
          >
            {msg.time ?? ''}
            {isMe && variant === 'whatsapp' ? (
              <OutgoingTicks read={msg.read} />
            ) : null}
          </span>
        ) : null}
      </motion.div>
    </div>
  );
};

const WhatsAppHeader = ({
  name,
  subtitle,
}: {
  name: string;
  subtitle?: string;
}) => (
  <div
    className="flex items-center gap-[2.5cqw] bg-[#008069] px-[3cqw] py-[2cqw] text-white"
    style={IOS_FONT}
  >
    <svg viewBox="0 0 24 24" className="size-[5cqw] shrink-0" aria-hidden>
      <title>Back</title>
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    <div className="flex size-[8.96cqw] shrink-0 items-center justify-center rounded-full bg-white/20 text-[4.23cqw] font-semibold">
      C
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[4.23cqw] font-semibold leading-tight">
        {name}
      </p>
      {subtitle ? (
        <p className="truncate text-[3.23cqw] leading-tight text-white/80">
          {subtitle}
        </p>
      ) : null}
    </div>
    <svg viewBox="0 0 24 24" className="size-[5cqw] shrink-0" aria-hidden>
      <title>Video call</title>
      <path
        d="M4 7h11v10H4V7Zm11 3 5-3v10l-5-3"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
    <svg viewBox="0 0 24 24" className="size-[5cqw] shrink-0" aria-hidden>
      <title>Call</title>
      <path
        d="M6.5 4.5 9 5l1 3-2 1.5a11 11 0 0 0 5 5L14 17l3 1 .5 2.5A2 2 0 0 1 15.4 22 15 15 0 0 1 2 8.6 2 2 0 0 1 4.5 6.5Z"
        fill="currentColor"
      />
    </svg>
  </div>
);

const InstagramHeader = ({
  name,
  subtitle,
}: {
  name: string;
  subtitle?: string;
}) => (
  <div
    className="flex items-center gap-[2.5cqw] border-b border-neutral-200 bg-white px-[3cqw] py-[2cqw] text-neutral-900"
    style={IOS_FONT}
  >
    <svg viewBox="0 0 24 24" className="size-[5cqw] shrink-0" aria-hidden>
      <title>Back</title>
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    <div
      className="flex size-[8.96cqw] shrink-0 items-center justify-center rounded-full text-[4.23cqw] font-semibold text-white"
      style={{
        background:
          'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
      }}
    >
      C
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[4.23cqw] font-semibold leading-tight">
        {name}
      </p>
      {subtitle ? (
        <p className="truncate text-[3.23cqw] leading-tight text-neutral-500">
          {subtitle}
        </p>
      ) : null}
    </div>
  </div>
);

/**
 * iOS 26 Messages header: a floating glass back-pill with the unread count, the
 * contact avatar centred over the thread with a name chip hanging beneath it,
 * and a FaceTime pill on the right. It overlays the thread rather than sitting
 * above it in flow — messages scroll underneath and blur through the glass.
 */
const IMessageHeader = ({
  name,
  avatarSrc,
  unread = 2,
}: {
  name: string;
  avatarSrc?: string;
  unread?: number;
}) => (
  <div
    className="absolute inset-x-0 top-[9%] z-10 h-[9.95%] px-[3.98cqw]"
    style={IOS_FONT}
  >
    <div className="relative flex h-full items-start justify-between">
      {/* Back + unread count */}
      <div
        className={cn(
          'relative inline-flex h-[10.95cqw] items-center justify-center gap-[1cqw] rounded-full px-[2cqw] backdrop-blur-[5cqw]',
          GLASS_SHADOW
        )}
        style={{ background: IOS.glass, color: IOS.toolbarIcon }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[4.23cqw]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <title>Back</title>
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span
          className="grid size-[5.22cqw] place-items-center rounded-full text-[2.99cqw] font-[590]"
          style={{ background: IOS.textPrimary, color: IOS.bg }}
        >
          {unread}
        </span>
      </div>

      {/* Avatar + name chip */}
      <div className="absolute left-1/2 top-0 size-[14.93cqw] -translate-x-1/2">
        <span className="absolute inset-0 overflow-hidden rounded-full shadow-[0_0.6cqw_0.5cqw_rgba(0,0,0,0.1)]">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              aria-hidden
              className="h-full w-full select-none object-cover"
            />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-[6cqw] font-semibold text-white"
              style={{
                background: 'linear-gradient(160deg,#a1a1aa,#52525b)',
              }}
            >
              {name.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <div
          className={cn(
            'absolute left-1/2 top-[91.67%] flex h-[7.96cqw] -translate-x-1/2 items-center gap-[1cqw] rounded-full pl-[3.48cqw] pr-[1.74cqw] backdrop-blur-[5cqw]',
            GLASS_SHADOW
          )}
          style={{ background: IOS.glass }}
        >
          <span
            className="whitespace-nowrap text-[4.23cqw] font-bold leading-none"
            style={{ color: IOS.textPrimary, ...IOS_FONT }}
          >
            {name}
          </span>
          <span
            className="text-[4.23cqw] leading-none"
            style={{ color: IOS.textSecondary }}
          >
            ›
          </span>
        </div>
      </div>

      {/* FaceTime */}
      <div
        className={cn(
          'relative inline-flex size-[10.95cqw] items-center justify-center rounded-full backdrop-blur-[5cqw]',
          GLASS_SHADOW
        )}
        style={{ background: IOS.glass, color: IOS.toolbarIcon }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[4.98cqw]"
          fill="currentColor"
          aria-hidden
        >
          <title>FaceTime</title>
          <path d="M3.4 6.6c-1 0-1.7.7-1.7 1.7v7.4c0 1 .7 1.7 1.7 1.7h9.4c1 0 1.7-.7 1.7-1.7v-1.4l4.3 2.7c.7.4 1.5-.1 1.5-.9V7.9c0-.8-.8-1.3-1.5-.9l-4.3 2.7V8.3c0-1-.7-1.7-1.7-1.7H3.4z" />
        </svg>
      </div>
    </div>
  </div>
);

/** "Today 8:05 AM" — iMessage stamps the thread once rather than per bubble. */
const DateDivider = ({ label }: { label: string }) => {
  const [day, ...rest] = label.split(' ');
  return (
    <div
      className="flex items-center justify-center gap-[1cqw] py-[1cqw] text-[2.74cqw] leading-none"
      style={{ color: IOS.textSecondary, ...IOS_FONT }}
    >
      <span className="font-[510]">{day}</span>
      {rest.length ? <span>{rest.join(' ')}</span> : null}
    </div>
  );
};

/**
 * iOS 26 Messages composer: a 40pt glass "+" button and a 40pt glass field
 * holding the placeholder and the send arrow.
 */
const IMessageComposer = () => (
  <div
    className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-[2.99cqw] px-[6.97cqw] pt-[1cqw] pb-[6.97cqw]"
    style={IOS_FONT}
  >
    <div
      className={cn(
        'relative inline-flex size-[9.95cqw] items-center justify-center rounded-full backdrop-blur-[5cqw]',
        GLASS_SHADOW
      )}
      style={{ background: IOS.glass, color: IOS.toolbarIcon }}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[4.98cqw]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Attach</title>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>

    <div
      className={cn(
        'relative inline-flex h-[9.95cqw] flex-1 items-center justify-between gap-[1.99cqw] rounded-full pl-[4.48cqw] pr-[2.49cqw] backdrop-blur-[5cqw]',
        GLASS_SHADOW
      )}
      style={{ background: IOS.glass }}
    >
      <span
        className="text-[4.23cqw] font-[510] leading-none"
        style={{ color: IOS.placeholder }}
      >
        iMessage
      </span>
      <span
        className="grid size-[5.47cqw] place-items-center rounded-full"
        style={{ background: IOS.overlay, color: IOS.toolbarIcon }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[3cqw]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <title>Send</title>
          <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
      </span>
    </div>
  </div>
);

/**
 * How far the thread stops short of the bottom. The composer itself is ~17.9cqw
 * (1 + 9.95 + 6.97), so the remainder is deliberate breathing room — a bubble
 * sitting right on top of the input reads as cramped.
 */
const COMPOSER_CLEARANCE = 'bottom-[26cqw]';

/** Where the top fade finishes. Threads must start at or below this. */
const THREAD_FADE_STOP = '12%';

/** The home indicator is not painted into the frame PNG, so we draw it. */
const HomeIndicator = ({ dark }: { dark?: boolean }) => (
  <div
    className={cn(
      'absolute bottom-[2cqw] left-1/2 z-20 h-[1.24cqw] w-[34.8cqw] -translate-x-1/2 rounded-full',
      dark ? 'bg-white/80' : 'bg-black/85'
    )}
  />
);

/**
 * iOS status bar. It renders under the frame's Dynamic Island, so the clock and
 * indicators are pushed out to the margins with generous side padding.
 */
const StatusBar = ({ dark, wide }: { dark?: boolean; wide?: boolean }) => (
  <div
    className={cn(
      // 59pt tall — the top safe area on a Dynamic Island phone. The bar has to
      // reserve the full inset or whatever follows it (a chat header, say) rides
      // up under the island and against the bezel curve.
      'flex items-center justify-between px-[6cqw] pt-[6.2cqw] pb-[4.7cqw] text-[4.23cqw] font-[590] leading-none',
      // `wide` pushes the clock and indicators further out, to sit in the ears
      // either side of the island rather than near it.
      wide && 'px-[12cqw]',
      dark ? 'text-white' : 'text-neutral-900'
    )}
    style={IOS_FONT}
  >
    <span>9:41</span>
    <div className="flex items-center gap-[1.2cqw]">
      <svg
        viewBox="0 0 18 12"
        className="h-[3.07cqw] w-auto"
        aria-hidden
        fill="currentColor"
      >
        <title>Signal</title>
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5" width="3" height="7" rx="1" />
        <rect x="10" y="2" width="3" height="10" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" opacity="0.4" />
      </svg>
      <svg
        viewBox="0 0 25 12"
        className="h-[3.23cqw] w-auto"
        aria-hidden
        fill="currentColor"
      >
        <title>Battery</title>
        <rect
          x="0.5"
          y="0.5"
          width="21"
          height="11"
          rx="3"
          fill="none"
          stroke="currentColor"
          opacity="0.5"
        />
        <rect x="2" y="2" width="16" height="8" rx="1.5" />
        <rect x="23" y="4" width="2" height="4" rx="1" />
      </svg>
    </div>
  </div>
);

/**
 * Thread column, top-anchored: the first message sits at the top and each new
 * one lands beneath it, leaving the ones above untouched.
 *
 * The column only scrolls once the thread outgrows its viewport, and then only
 * by the overflow — exactly what a real thread does, and what keeps the newest
 * message on screen without yanking a half-full thread around.
 */
const Thread = ({
  messages,
  variant,
  threadDate,
}: {
  messages: ChatMessage[];
  variant: ChatVariant;
  threadDate?: string;
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // Gate on a fraction of the thread being on screen, not a pixel offset. A
  // margin fires the moment the first sliver intersects, so on a phone this
  // tall the conversation would be several beats in before you could read it.
  const inView = useInView(viewportRef, { once: true, amount: 0.55 });
  const prefersReducedMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(0);
  // The scroll is driven imperatively rather than through `animate`, so the
  // replay can *set* it back to the top instead of animating there. A declarative
  // reset never lands: React advances `revealed` 0→1 before motion renders a
  // frame, so the "snap" transition is gone by the time it would apply and the
  // first message drags down from wherever the finished thread had scrolled to.
  const y = useMotionValue(0);

  // Each pass schedules only the next step, then re-runs off the new `revealed`.
  // Once the last message has landed it holds, clears, and plays again — a
  // section you scroll back to shouldn't be a dead mock.
  useEffect(() => {
    if (!inView) return;

    // Reduced motion: the thread is content, not decoration, so still show it —
    // just skip the choreography and present it settled.
    if (prefersReducedMotion) {
      setRevealed(messages.length);
      return;
    }

    const finished = revealed >= messages.length;
    const delay = finished
      ? REPLAY_HOLD_MS
      : // The first message is already there when you open a thread.
        revealed === 0
        ? 0
        : (messages[revealed].delayMs ?? DEFAULT_BEAT_MS);

    const id = setTimeout(() => {
      setRevealed((r) => (r >= messages.length ? 0 : r + 1));
    }, delay);
    return () => clearTimeout(id);
  }, [inView, prefersReducedMotion, messages, revealed]);

  // Re-measure after each message lands. `offsetHeight` is the untransformed
  // layout height, so it stays correct while the column is mid-translate.
  useEffect(() => {
    const viewport = viewportRef.current;
    const column = columnRef.current;
    if (!viewport || !column) return;

    // An empty thread has nothing to scroll past. Snap rather than animate —
    // this is a cut back to the start, not a scroll.
    if (revealed === 0) {
      y.set(0);
      return;
    }

    const overflow = column.offsetHeight - viewport.clientHeight;
    const controls = animate(y, overflow > 0 ? -overflow : 0, {
      duration: SHIFT_S,
      ease: SHIFT_EASE,
    });
    return () => controls.stop();
  }, [revealed, y]);

  return (
    <div ref={viewportRef} className="absolute inset-0 overflow-hidden">
      <motion.div
        ref={columnRef}
        style={{ y }}
        className="absolute inset-x-0 top-0 flex flex-col gap-[1cqw] px-[3.98cqw]"
      >
        {threadDate && revealed > 0 ? <DateDivider label={threadDate} /> : null}
        {messages.slice(0, revealed).map((msg, i) => (
          <Bubble key={i} msg={msg} variant={variant} />
        ))}
      </motion.div>
    </div>
  );
};

export const PhoneMockup = ({
  variant = 'whatsapp',
  contactName,
  contactSubtitle,
  contactAvatarSrc,
  messages,
  threadDate = 'Today 8:05 AM',
  frameSrc = DEFAULT_FRAME_SRC,
  className,
}: {
  variant?: ChatVariant;
  contactName: string;
  /** WhatsApp/Instagram only — iMessage shows a name chip with no subtitle. */
  contactSubtitle?: string;
  /** iMessage only. Falls back to an initial avatar when omitted. */
  contactAvatarSrc?: string;
  messages: ChatMessage[];
  /** iMessage only — the one thread-level stamp, e.g. "Today 8:05 AM". */
  threadDate?: string;
  /** Device bezel PNG with a transparent screen window. */
  frameSrc?: string;
  className?: string;
}) => {
  // The frame PNG is a gitignored local placeholder, so it is absent in CI and
  // on fresh checkouts. Fall back to a CSS bezel rather than showing a gap.
  const [hasFrame, setHasFrame] = useState(Boolean(frameSrc));
  const frameRef = useRef<HTMLImageElement>(null);
  const isIMessage = variant === 'imessage';

  // `onError` alone is not enough. This island is server-rendered, so the img
  // is in the initial HTML and the browser has usually already tried — and
  // failed — to load it before React hydrates and attaches the handler. That
  // error fires into nothing, the frame stays "present", and a broken image
  // sits where the bezel should be. A finished image with no intrinsic width
  // is a failed one, so re-check on mount.
  useEffect(() => {
    const img = frameRef.current;
    if (img?.complete && img.naturalWidth === 0) setHasFrame(false);
  }, []);

  // Fades messages out as they scroll up under the header. The thread must
  // start below `THREAD_FADE_STOP`, or the first message renders inside the
  // fade and reads as clipped even when nothing has scrolled yet.
  const threadMask = `linear-gradient(to bottom, transparent 0%, black ${THREAD_FADE_STOP}, black 100%)`;

  return (
    <div
      // Width must be definite, not `w-full`: every child is absolutely
      // positioned, so the mock has no max-content width of its own. In a
      // shrink-to-fit parent (`justify-self-end`, floats, inline-block) a
      // percentage width would resolve against zero and collapse the mock.
      // `max-w-full` still lets it shrink inside narrow containers.
      className={cn('relative mx-auto w-[300px] max-w-full', className)}
      style={{ aspectRatio: FRAME_ASPECT }}
    >
      {/* CSS bezel fallback — sits behind the screen, so the inset gap reads as
          the bezel ring. Radius approximates the PNG's body corners. */}
      {!hasFrame ? (
        <div className="absolute inset-0 rounded-[18.4%/8.8%] bg-neutral-900 shadow-brand" />
      ) : null}

      {/* Screen: the container every cqw inside resolves against. */}
      <div
        className="absolute [container-type:inline-size]"
        style={{
          left: SCREEN_INSET.left,
          right: SCREEN_INSET.right,
          top: SCREEN_INSET.top,
          bottom: SCREEN_INSET.bottom,
        }}
      >
        {isIMessage ? (
          // iOS 26 Messages: floating glass chrome over a full-bleed thread, so
          // everything is absolutely placed and the thread runs edge to edge
          // underneath it.
          <div
            className="absolute inset-0 overflow-hidden rounded-[16cqw]"
            style={{ background: IOS.bg }}
          >
            <div className="absolute inset-x-0 top-0 z-10">
              <StatusBar wide />
            </div>
            <IMessageHeader name={contactName} avatarSrc={contactAvatarSrc} />

            <div
              className="absolute inset-x-0 bottom-0 top-[7%] z-0 overflow-hidden"
              style={{ maskImage: threadMask, WebkitMaskImage: threadMask }}
            >
              {/* Inset from the composer so the newest bubble clears it. */}
              <div
                className={cn(
                  'absolute inset-x-0 top-[19%]',
                  COMPOSER_CLEARANCE
                )}
              >
                <Thread
                  messages={messages}
                  variant={variant}
                  threadDate={threadDate}
                />
              </div>
            </div>

            <IMessageComposer />
            <HomeIndicator />
          </div>
        ) : (
          // WhatsApp / Instagram: solid header in normal flow above the thread.
          <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[16cqw] bg-white">
            <div
              className={variant === 'whatsapp' ? 'bg-[#008069]' : 'bg-white'}
            >
              <StatusBar dark={variant === 'whatsapp'} />
            </div>
            {variant === 'whatsapp' ? (
              <WhatsAppHeader name={contactName} subtitle={contactSubtitle} />
            ) : (
              <InstagramHeader name={contactName} subtitle={contactSubtitle} />
            )}

            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{
                backgroundColor: variant === 'whatsapp' ? '#EFEAE2' : '#ffffff',
                backgroundImage:
                  variant === 'whatsapp'
                    ? 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)'
                    : undefined,
                backgroundSize:
                  variant === 'whatsapp' ? '4.5cqw 4.5cqw' : undefined,
                maskImage: threadMask,
                WebkitMaskImage: threadMask,
              }}
            >
              {/* Starts below the fade (see THREAD_FADE_STOP) so the first
                  message is not eaten by it, and it clears the header. */}
              <div className="absolute inset-x-0 bottom-[3cqw] top-[15%]">
                <Thread messages={messages} variant={variant} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bezel PNG on top of the live DOM. Includes the Dynamic Island. */}
      {frameSrc && hasFrame ? (
        <img
          ref={frameRef}
          src={frameSrc}
          alt=""
          aria-hidden
          onError={() => setHasFrame(false)}
          className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none"
        />
      ) : null}
    </div>
  );
};
