import { type Driver, driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useClaireWidgetState } from '../lib/widget-state';
import { RadiatingRings } from './radiating-rings';
import { TourChatbox } from './tour-chatbox';
import {
  type TourDefinition,
  type TourPayload,
  type TourStep,
  interpolateTourCopy,
} from './types';

/**
 * Module-level controller: `<ClaireTourRunner />` registers a starter when it
 * mounts; callers (tour handlers in `ClaireWalkthroughProvider`) invoke
 * `startClaireTour(definition, payload)` to kick off a tour.
 *
 * If the runner is not mounted, calls are swallowed with a console warning —
 * the widget dispatcher already logs unknown-kind handlers, so missing the
 * runner itself is the remaining failure mode.
 */
type TourStarter = (definition: TourDefinition, payload?: TourPayload) => void;

let registeredStarter: TourStarter | null = null;
// Legacy `create_*` tours were removed when chat became the only creation
// entry point. Future onboarding / discovery tours should register here.
const KNOWN_TOURS: Record<string, TourDefinition> = {};

export function startClaireTour(
  definition: TourDefinition,
  payload?: TourPayload
): void {
  if (registeredStarter) {
    registeredStarter(definition, payload);
    return;
  }
  console.warn(
    '[ClaireTourRunner] startClaireTour called before runner mounted; ignoring',
    { kind: definition.kind }
  );
}

export function startClaireTourByKind(
  kind: string,
  payload?: TourPayload
): void {
  const definition = KNOWN_TOURS[kind];
  if (!definition) {
    console.warn('[ClaireTourRunner] unknown tour kind; ignoring', { kind });
    return;
  }
  startClaireTour(definition, payload);
}

interface ActiveTour {
  definition: TourDefinition;
  payload?: TourPayload;
  stepIndex: number;
}

const TARGET_FIND_INTERVAL_MS = 200;
const TARGET_FIND_MAX_ATTEMPTS = 25; // ~5 seconds for non-manual steps
const MANUAL_STEP_WARN_AFTER_ATTEMPTS = 25; // first warning after ~5 seconds

export function ClaireTourRunner() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setTourRunning = useClaireWidgetState((s) => s.setTourRunning);

  const [active, setActive] = useState<ActiveTour | null>(null);
  const [targetEl, setTargetEl] = useState<Element | null>(null);

  const driverRef = useRef<Driver | null>(null);
  const lastTargetElRef = useRef<Element | null>(null);
  const hasWarnedWaitingRef = useRef(false);
  // Pathname where the current step anchored (target was first located).
  // Used to detect unexpected navigation away mid-step.
  const anchorPathRef = useRef<string | null>(null);

  const currentStep: TourStep | null =
    active?.definition.steps[active.stepIndex] ?? null;

  // -------- driver.js instance --------
  useEffect(() => {
    driverRef.current = driver({
      animate: true,
      allowClose: false,
      allowKeyboardControl: false,
      disableActiveInteraction: false,
      stagePadding: 6,
      stageRadius: 8,
      overlayOpacity: 0.55,
      showButtons: [],
    });
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  // -------- start/end helpers --------
  const endTour = useCallback(() => {
    driverRef.current?.destroy();
    anchorPathRef.current = null;
    setActive(null);
    setTargetEl(null);
    setTourRunning(false);
  }, [setTourRunning]);

  const advanceStep = useCallback(() => {
    setActive((prev) => {
      if (!prev) return prev;
      const nextIdx = prev.stepIndex + 1;
      if (nextIdx >= prev.definition.steps.length) {
        // Final step cleared — end tour on next tick.
        queueMicrotask(() => endTour());
        return prev;
      }
      anchorPathRef.current = null;
      return { ...prev, stepIndex: nextIdx };
    });
    setTargetEl(null);
    hasWarnedWaitingRef.current = false;
  }, [endTour]);

  // -------- register module-level starter --------
  useEffect(() => {
    const starter: TourStarter = (definition, payload) => {
      if (!definition.steps.length) {
        console.warn(
          '[ClaireTourRunner] tour has no steps; ignoring',
          definition.kind
        );
        return;
      }
      anchorPathRef.current = null;
      setTourRunning(true);
      setTargetEl(null);
      hasWarnedWaitingRef.current = false;
      setActive({ definition, payload, stepIndex: 0 });
    };
    registeredStarter = starter;

    // Dev/staging helpers:
    // - window.__startClaireTourByKind('create_video', payload?)
    // - window.__startClaireTour(definition, payload?) [legacy]
    if (import.meta.env.DEV) {
      (
        window as unknown as {
          __startClaireTour?: typeof startClaireTour;
          __startClaireTourByKind?: typeof startClaireTourByKind;
        }
      ).__startClaireTour = startClaireTour;
      (
        window as unknown as {
          __startClaireTourByKind?: typeof startClaireTourByKind;
        }
      ).__startClaireTourByKind = startClaireTourByKind;
    }

    return () => {
      if (registeredStarter === starter) registeredStarter = null;
    };
  }, [setTourRunning]);

  // -------- clean up on unmount (e.g. tab close via layout unmount) --------
  useEffect(() => {
    const onBeforeUnload = () => {
      if (active) {
        driverRef.current?.destroy();
        setTourRunning(false);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active, setTourRunning]);

  // -------- navigate-before + locate target --------
  useEffect(() => {
    if (!active || !currentStep || !driverRef.current) return;
    const step = currentStep;

    // 1. If the step needs a route change, push and wait for pathname to match.
    if (step.navigateBefore && pathname !== step.navigateBefore) {
      void navigate({ to: step.navigateBefore as never });
      return;
    }

    // 2. Locate the target. Retry on a short interval in case the DOM is
    //    still mounting after a route transition.
    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;
    const selector = `[data-claire-target="${step.target}"]`;

    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) {
        setTargetEl(el);
        hasWarnedWaitingRef.current = false;
        lastTargetElRef.current = el;
        try {
          driverRef.current?.highlight({ element: el });
        } catch (err) {
          console.warn('[ClaireTourRunner] driver.highlight threw', err);
        }
        return;
      }
      attempts += 1;
      if (step.advanceOn === 'manual') {
        // Manual steps can take user-dependent time (wizard transitions, async
        // processing). Keep polling instead of hard-cancelling the tour.
        if (
          attempts >= MANUAL_STEP_WARN_AFTER_ATTEMPTS &&
          !hasWarnedWaitingRef.current
        ) {
          console.warn(
            `[ClaireTourRunner] still waiting for manual-step target "${step.target}"`
          );
          hasWarnedWaitingRef.current = true;
        }
        timeoutId = window.setTimeout(find, TARGET_FIND_INTERVAL_MS);
        return;
      }
      if (attempts >= TARGET_FIND_MAX_ATTEMPTS) {
        console.warn(
          `[ClaireTourRunner] target "${step.target}" not found; cancelling tour`
        );
        endTour();
        return;
      }
      timeoutId = window.setTimeout(find, TARGET_FIND_INTERVAL_MS);
    };

    find();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [active, currentStep, pathname, navigate, endTour]);

  // -------- anchor the pathname once the target is located --------
  useEffect(() => {
    if (active && currentStep && targetEl && anchorPathRef.current === null) {
      anchorPathRef.current = pathname;
    }
  }, [active, currentStep, targetEl, pathname]);

  // -------- auto-cancel on unexpected navigation --------
  useEffect(() => {
    if (!active || !currentStep) return;
    const anchor = anchorPathRef.current;
    if (!anchor) return;
    if (pathname === anchor) return;
    // Pathname changed after the step had anchored. If this is the expected
    // advance-on-navigate target, let the advance effect handle it.
    if (
      currentStep.advanceOn === 'navigate' &&
      currentStep.expectedRoute === pathname
    ) {
      return;
    }
    endTour();
  }, [active, currentStep, pathname, endTour]);

  // -------- advance on navigate --------
  useEffect(() => {
    if (!active || !currentStep) return;
    if (currentStep.advanceOn !== 'navigate') return;
    if (!currentStep.expectedRoute) return;
    if (pathname !== currentStep.expectedRoute) return;
    advanceStep();
  }, [active, currentStep, pathname, advanceStep]);

  // -------- advance on click / input / option-selected --------
  useEffect(() => {
    if (!active || !currentStep || !targetEl) return;
    const step = currentStep;

    if (step.advanceOn === 'click') {
      const onClick = () => advanceStep();
      targetEl.addEventListener('click', onClick);
      return () => targetEl.removeEventListener('click', onClick);
    }

    if (step.advanceOn === 'input-change') {
      const onInput = (event: Event) => {
        const t = event.target as HTMLInputElement | HTMLTextAreaElement;
        if (t && typeof t.value === 'string' && t.value.trim().length > 0) {
          advanceStep();
        }
      };
      targetEl.addEventListener('input', onInput, true);
      return () => targetEl.removeEventListener('input', onInput, true);
    }

    if (step.advanceOn === 'option-selected') {
      // Native <select> — use change event with a value guard.
      if (targetEl instanceof HTMLSelectElement) {
        const onChange = () => {
          if (targetEl.value && String(targetEl.value).length > 0) {
            advanceStep();
          }
        };
        targetEl.addEventListener('change', onChange);
        return () => targetEl.removeEventListener('change', onChange);
      }
      // Radix / custom combobox — observe subtree mutations that indicate a
      // selection was applied (value attr, aria-activedescendant, text change).
      const initialText = targetEl.textContent ?? '';
      const initialValue = (targetEl as HTMLElement).dataset?.value ?? '';
      const observer = new MutationObserver(() => {
        const currentText = targetEl.textContent ?? '';
        const currentValue = (targetEl as HTMLElement).dataset?.value ?? '';
        if (currentText !== initialText || currentValue !== initialValue) {
          advanceStep();
        }
      });
      observer.observe(targetEl, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
      return () => observer.disconnect();
    }

    // 'navigate' — handled by its own effect.
    // 'manual'   — handled by the chatbox "Got it" button.
    return;
  }, [active, currentStep, targetEl, advanceStep]);

  // -------- render chatbox + rings --------
  const renderTarget = targetEl ?? lastTargetElRef.current;
  if (!active || !currentStep || !renderTarget) return null;

  const interpolated = interpolateTourCopy(currentStep.copy, active.payload);
  const canExit = currentStep.canExit !== false;

  return (
    <>
      {targetEl ? <RadiatingRings target={targetEl} /> : null}
      <TourChatbox
        target={renderTarget}
        title={currentStep.title}
        copy={interpolated}
        canExit={canExit}
        showAdvanceButton={currentStep.advanceOn === 'manual' && !!targetEl}
        onExit={endTour}
        onAdvance={advanceStep}
      />
    </>
  );
}
