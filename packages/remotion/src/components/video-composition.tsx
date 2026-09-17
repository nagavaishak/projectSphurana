import type React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import type { VideoConfig } from '../types/video-config';
import { AestheticLineLayer } from './aesthetic-line-layer';
import { BRollLayer } from './b-roll-layer';
import { BeforeAfterRevealLayer } from './before-after-reveal-layer';
import { Captions } from './captions';
import { ClientQuestionLayer } from './client-question-layer';
import { ComeWithMeLayer } from './come-with-me-layer';
import { EducationalTextLayer } from './educational-text-layer';
import { FadeBenefitsLayer } from './fade-benefits-layer';
import { FullScreenRevealLayer } from './full-screen-reveal';
import { ImprovesLayer } from './improves-layer';
import { InsOutsLayer } from './ins-outs-layer';
import { MusicLayer } from './music-layer';
import { MythFactLayer } from './myth-fact-layer';
import { NarrationAudioLayer } from './narration-audio-layer';
import { NumberedListLayer } from './numbered-list-layer';
import { OfferCardLayer } from './offer-card-layer';
import { Outro } from './outro';
import { OutroLayoutRenderer } from './outro-layouts/outro-layout-renderer';
import { PipOverlayLayer } from './pip-overlay-layer';
import { PollLayer } from './poll-layer';
import { PriceRevealLayer } from './price-reveal-layer';
import { QuestionCtaLayer } from './question-cta-layer';
import { StepTimerLayer } from './step-timer-layer';
import { TalkingHeadLayer } from './talking-head-layer';
import { TextFrameLayer } from './text-frame-layer';
import { TextInterstitialLayer } from './text-interstitial';
import { TikTokCaptions } from './tiktok-captions';
import { TimeProgressLayer } from './time-progress-layer';
import { TypewriterTextLayer } from './typewriter-text-layer';
import { VersusLayer } from './versus-layer';

/**
 * Get offer card timing based on variation ID.
 * For the legacy overlay-style offer card (not the square side-by-side layout).
 */
function getOfferCardTiming(
  _variationId: string | undefined,
  totalFrames: number,
  _fps: number
): { startFrame: number; durationInFrames: number } {
  return { startFrame: 0, durationInFrames: totalFrames };
}

/**
 * Get the offer card variant based on variation ID.
 */
function getOfferCardVariant(
  _variationId: string | undefined
): 'dark-overlay' | 'clean-info' {
  return 'dark-overlay';
}

export interface VideoCompositionProps extends VideoConfig {}

/**
 * Main Video Composition
 *
 * This is the root component that renders the complete video.
 * It orchestrates all layers:
 *
 * Layer Stack (bottom to top):
 * 1. Talking Head Layer - base video with continuous audio
 * 2. B-Roll Layer - visual overlays (muted, talking head audio continues)
 * 3. Music Layer - background music
 * 4. Captions Layer - TikTok-style word-by-word captions (or legacy captions)
 * 5. PiP Overlay Layer - before/after photo thumbnails in corners
 * 6. Outro Layout - cinematic branded outro (final frames)
 * 7. Outro Layer - full-screen end screen (legacy, after main content)
 *
 * Audio Sync:
 * - Talking head audio plays continuously throughout main content
 * - B-roll clips are visual-only overlays
 * - Music plays underneath at lower volume
 *
 * Caption Modes:
 * - TikTok-style: Word-by-word highlighting with captionPages + tikTokCaptionStyle
 * - Legacy: Simple text blocks with captions + captionStyle
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({
  scenes,
  captionPages,
  tikTokCaptionStyle,
  captions,
  captionStyle,
  music,
  outroLayout,
  outro,
  fps,
  durationInFrames,
  variationId,
  narrationAudio,
  textInterstitials,
  fullScreenReveals,
  pipOverlays,
  textFrames,
  offerCard,
  educationalConfig,
  captionTease,
  fadeBenefits,
  aestheticLine,
  numberedList,
  insOuts,
  questionCta,
  improves,
  stepTimer,
  timeProgress,
  poll,
  mythFact,
  versus,
  priceReveal,
  clientQuestion,
  comeWithMe,
  orientation,
}) => {
  // Find the talking head scene (there should be exactly one for recorded narration)
  const talkingHeadScene = scenes.find((s) => s.type === 'talking-head');

  // Get all b-roll scenes
  const bRollScenes = scenes.filter((s) => s.type === 'b-roll');

  // Calculate main content duration (before full-screen outro, if present)
  const mainContentDuration = outro
    ? durationInFrames - outro.durationInFrames
    : durationInFrames;

  // Calculate when outro layout should appear (last X frames of main content)
  const outroLayoutStart = outroLayout
    ? mainContentDuration - outroLayout.durationInFrames
    : mainContentDuration;

  // Determine caption mode: TikTok-style if captionPages provided, else legacy
  const useTikTokCaptions =
    captionPages && captionPages.length > 0 && tikTokCaptionStyle;

  // Educational template detection
  const isEducational = variationId?.startsWith('educational-');

  // ================================================================
  // Branch: Educational text-only (all educational variations)
  // ================================================================
  if (isEducational && educationalConfig && !talkingHeadScene) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Sequence durationInFrames={durationInFrames}>
          <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />
          {music && <MusicLayer config={music} fps={fps} />}
          <EducationalTextLayer
            config={educationalConfig}
            fps={fps}
            orientation={orientation}
          />
          {/* No outro — CTA is the ending */}
        </Sequence>
      </AbsoluteFill>
    );
  }

  // ================================================================
  // Branch: Organic templates (text-on-b-roll, no narration, no captions)
  //
  // All four variations share the same stack: b-roll + music + one text layer.
  // Each variation reads its config block from VideoConfig.
  // ================================================================
  const isCaptionTease = variationId === 'caption-tease-1' && captionTease;
  // highlight-caption reuses the fade-benefits render path (sequential lines,
  // one per clip); its config carries `highlight: true` to switch on blocks.
  const isFadeBenefits =
    (variationId === 'fade-benefits-1' ||
      variationId === 'highlight-caption-1') &&
    fadeBenefits;
  const isAestheticLine = variationId === 'aesthetic-line-1' && aestheticLine;
  const isNumberedList = variationId === 'numbered-list-1' && numberedList;
  const isInsOuts = variationId === 'ins-outs-1' && insOuts;
  // curiosity-hook reuses the question-cta render path (bold claim pinned top,
  // a short "watch till the end" line pinned bottom).
  const isQuestionCta =
    (variationId === 'question-cta-1' || variationId === 'curiosity-hook-1') &&
    questionCta;
  const isImproves = variationId === 'improves-1' && improves;
  const isStepTimer = variationId === 'step-timer-1' && stepTimer;
  const isTimeProgress = variationId === 'time-progress-1' && timeProgress;
  const isPoll = variationId === 'poll-1' && poll;
  const isMythFact = variationId === 'myth-fact-1' && mythFact;
  const isVersus = variationId === 'versus-1' && versus;
  const isPriceReveal = variationId === 'price-reveal-1' && priceReveal;
  const isClientQuestion =
    variationId === 'client-question-1' && clientQuestion;
  const isComeWithMe = variationId === 'come-with-me-1' && comeWithMe;
  if (
    isCaptionTease ||
    isFadeBenefits ||
    isAestheticLine ||
    isNumberedList ||
    isInsOuts ||
    isQuestionCta ||
    isImproves ||
    isStepTimer ||
    isTimeProgress ||
    isPoll ||
    isMythFact ||
    isVersus ||
    isPriceReveal ||
    isClientQuestion ||
    isComeWithMe
  ) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Sequence durationInFrames={durationInFrames}>
          <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />
          {music && <MusicLayer config={music} fps={fps} />}
          {isCaptionTease && captionTease && (
            <TypewriterTextLayer config={captionTease} fps={fps} />
          )}
          {isFadeBenefits && fadeBenefits && (
            <FadeBenefitsLayer
              config={fadeBenefits}
              bRollScenes={bRollScenes}
              fps={fps}
              durationInFrames={durationInFrames}
            />
          )}
          {isAestheticLine && aestheticLine && (
            <AestheticLineLayer config={aestheticLine} />
          )}
          {isNumberedList && numberedList && (
            <NumberedListLayer config={numberedList} />
          )}
          {isInsOuts && insOuts && <InsOutsLayer config={insOuts} />}
          {isQuestionCta && questionCta && (
            <QuestionCtaLayer config={questionCta} />
          )}
          {isImproves && improves && (
            <ImprovesLayer
              config={improves}
              bRollScenes={bRollScenes}
              fps={fps}
              durationInFrames={durationInFrames}
            />
          )}
          {isStepTimer && stepTimer && (
            <StepTimerLayer
              config={stepTimer}
              bRollScenes={bRollScenes}
              fps={fps}
              durationInFrames={durationInFrames}
            />
          )}
          {isTimeProgress && timeProgress && (
            <TimeProgressLayer
              config={timeProgress}
              durationInFrames={durationInFrames}
            />
          )}
          {isPoll && poll && <PollLayer config={poll} />}
          {isMythFact && mythFact && (
            <MythFactLayer
              config={mythFact}
              durationInFrames={durationInFrames}
            />
          )}
          {isVersus && versus && (
            <VersusLayer config={versus} durationInFrames={durationInFrames} />
          )}
          {isPriceReveal && priceReveal && (
            <PriceRevealLayer
              config={priceReveal}
              durationInFrames={durationInFrames}
            />
          )}
          {isClientQuestion && clientQuestion && (
            <ClientQuestionLayer
              config={clientQuestion}
              durationInFrames={durationInFrames}
            />
          )}
          {isComeWithMe && comeWithMe && (
            <ComeWithMeLayer
              config={comeWithMe}
              durationInFrames={durationInFrames}
            />
          )}
          {/* Optional branded outro (toggled on at creation). Overlays the
              final frames; the worker extends the timeline so it follows the
              text rather than covering it. */}
          {outroLayout && (
            <Sequence
              from={outroLayoutStart}
              durationInFrames={outroLayout.durationInFrames}
            >
              <OutroLayoutRenderer config={outroLayout} />
            </Sequence>
          )}
        </Sequence>
      </AbsoluteFill>
    );
  }

  // AI voiceover mode: no talking head, narration audio drives the video
  if (!talkingHeadScene && narrationAudio) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {/* Content runs for full duration so it stays visible underneath the outro.
            The video/audio sources naturally end at their own duration and freeze
            on the last frame, preventing a black gap during the outro fade-in. */}
        <Sequence durationInFrames={durationInFrames}>
          {/* Layer 1: B-roll as primary visual (full screen, sequential) */}
          <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />

          {/* Layer 1b: Cinematic before-after reveal (legacy — prefer modular layers below) */}
          <BeforeAfterRevealLayer scenes={scenes} fps={fps} />

          {/* Layer 1c: Full-screen reveals (e.g., cinematic after photo with Ken Burns) */}
          {fullScreenReveals && fullScreenReveals.length > 0 && (
            <FullScreenRevealLayer reveals={fullScreenReveals} />
          )}

          {/* Layer 2: AI narration audio */}
          <NarrationAudioLayer
            audioUrl={narrationAudio.url}
            volume={narrationAudio.volume}
          />

          {/* Layer 3: Background music */}
          {music && <MusicLayer config={music} fps={fps} />}

          {/* Layer 4: Text interstitials (e.g., "CLIENT RESULTS COMING NOW") */}
          {textInterstitials && textInterstitials.length > 0 && (
            <TextInterstitialLayer interstitials={textInterstitials} />
          )}

          {/* Layer 4b: Captions - TikTok style or legacy */}
          {useTikTokCaptions ? (
            <TikTokCaptions
              captionPages={captionPages}
              style={tikTokCaptionStyle}
            />
          ) : (
            captions &&
            captionStyle && (
              <Captions captions={captions} style={captionStyle} />
            )
          )}

          {/* Layer 5: PiP overlays (before/after photo thumbnails) */}
          {pipOverlays && pipOverlays.length > 0 && (
            <PipOverlayLayer overlays={pipOverlays} />
          )}

          {/* Layer 6: Cinematic outro layout (appears over final frames) */}
          {outroLayout && (
            <Sequence
              from={outroLayoutStart}
              durationInFrames={outroLayout.durationInFrames}
            >
              <OutroLayoutRenderer config={outroLayout} />
            </Sequence>
          )}
        </Sequence>

        {/* Full-screen outro overlays on top of still-visible content */}
        {outro && (
          <Sequence
            from={mainContentDuration}
            durationInFrames={outro.durationInFrames}
          >
            <Outro config={outro} />
          </Sequence>
        )}
      </AbsoluteFill>
    );
  }

  // Text-only mode: no talking head, no narration audio, but textFrames or offerCard drive the video
  const hasTextContent = (textFrames && textFrames.length > 0) || offerCard;
  if (!talkingHeadScene && !narrationAudio && hasTextContent) {
    // Offer card timing (variation-aware)
    const offerTiming = offerCard
      ? getOfferCardTiming(variationId, durationInFrames, fps)
      : null;
    const offerVariant = getOfferCardVariant(variationId);

    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Sequence durationInFrames={durationInFrames}>
          {/* Layer 1: B-roll as primary visual (full screen, sequential) */}
          <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />

          {/* Layer 1b: Cinematic before-after reveal (legacy — prefer modular layers below) */}
          <BeforeAfterRevealLayer scenes={scenes} fps={fps} />

          {/* Layer 1c: Full-screen reveals (e.g., cinematic after photo with Ken Burns) */}
          {fullScreenReveals && fullScreenReveals.length > 0 && (
            <FullScreenRevealLayer reveals={fullScreenReveals} />
          )}

          {/* Layer 2: Background music (primary audio for text-only) */}
          {music && <MusicLayer config={music} fps={fps} />}

          {/* Layer 2b: Text interstitials (e.g., "CLIENT RESULTS COMING NOW") */}
          {textInterstitials && textInterstitials.length > 0 && (
            <TextInterstitialLayer interstitials={textInterstitials} />
          )}

          {/* Layer 3: Timed text frames (if present) */}
          {textFrames && textFrames.length > 0 && (
            <TextFrameLayer textFrames={textFrames} />
          )}

          {/* Layer 4: Offer card overlay (if present) */}
          {offerCard && offerTiming && (
            <OfferCardLayer
              card={offerCard}
              fps={fps}
              startFrame={offerTiming.startFrame}
              durationInFrames={offerTiming.durationInFrames}
              variant={offerVariant}
            />
          )}

          {/* Layer 5: PiP overlays (if any) */}
          {pipOverlays && pipOverlays.length > 0 && (
            <PipOverlayLayer overlays={pipOverlays} />
          )}

          {/* Layer 6: Cinematic outro layout (appears over final frames) */}
          {outroLayout && (
            <Sequence
              from={outroLayoutStart}
              durationInFrames={outroLayout.durationInFrames}
            >
              <OutroLayoutRenderer config={outroLayout} />
            </Sequence>
          )}
        </Sequence>

        {/* Full-screen outro overlays on top of still-visible content */}
        {outro && (
          <Sequence
            from={mainContentDuration}
            durationInFrames={outro.durationInFrames}
          >
            <Outro config={outro} />
          </Sequence>
        )}
      </AbsoluteFill>
    );
  }

  if (!talkingHeadScene) {
    throw new Error(
      'VideoComposition: No talking-head scene, no narrationAudio, and no textFrames. ' +
        'This indicates a broken pipeline — the video config is missing required content. ' +
        'Either provide a talking-head scene (recorded narration), narrationAudio (AI voiceover), or textFrames (text-only).'
    );
  }

  // Recorded talking head path — talkingHeadScene is guaranteed defined after the guard above
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Content runs for full duration so it stays visible underneath the outro.
          The talking head video freezes on its last frame, preventing a black gap
          during the outro fade-in. Audio naturally ends with the source file. */}
      <Sequence durationInFrames={durationInFrames}>
        {/* Layer 1: Talking head (base layer with audio) */}
        <TalkingHeadLayer
          scene={talkingHeadScene}
          bRollScenes={bRollScenes}
          fps={fps}
          variationId={variationId}
        />

        {/* Layer 2: B-roll overlays (visual only, muted) */}
        <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />

        {/* Layer 2b: Cinematic before-after reveal (legacy — prefer modular layers below) */}
        <BeforeAfterRevealLayer scenes={scenes} fps={fps} />

        {/* Layer 2c: Full-screen reveals (e.g., cinematic after photo with Ken Burns) */}
        {fullScreenReveals && fullScreenReveals.length > 0 && (
          <FullScreenRevealLayer reveals={fullScreenReveals} />
        )}

        {/* Layer 3: Background music */}
        {music && <MusicLayer config={music} fps={fps} />}

        {/* Layer 3b: Text interstitials (e.g., "CLIENT RESULTS COMING NOW") */}
        {textInterstitials && textInterstitials.length > 0 && (
          <TextInterstitialLayer interstitials={textInterstitials} />
        )}

        {/* Layer 4: Captions - TikTok style or legacy */}
        {useTikTokCaptions ? (
          <TikTokCaptions
            captionPages={captionPages}
            style={tikTokCaptionStyle}
          />
        ) : (
          captions &&
          captionStyle && <Captions captions={captions} style={captionStyle} />
        )}

        {/* Layer 5: PiP overlays (before/after photo thumbnails) */}
        {pipOverlays && pipOverlays.length > 0 && (
          <PipOverlayLayer overlays={pipOverlays} />
        )}

        {/* Layer 6: Cinematic outro layout (appears over final frames) */}
        {outroLayout && (
          <Sequence
            from={outroLayoutStart}
            durationInFrames={outroLayout.durationInFrames}
          >
            <OutroLayoutRenderer config={outroLayout} />
          </Sequence>
        )}
      </Sequence>

      {/* Full-screen outro overlays on top of still-visible content */}
      {outro && (
        <Sequence
          from={mainContentDuration}
          durationInFrames={outro.durationInFrames}
        >
          <Outro config={outro} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
