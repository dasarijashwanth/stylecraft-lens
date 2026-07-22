"use client";

// Shared realtime-animation primitives for the Overview dashboard and
// Projects grid — pairs with the token/keyframe classes in app/globals.css
// (--ease-out/--dur-*, .stat-card, .pulse-dot, .bell-ring, etc.). Centralized
// here so no component reimplements its own rAF loop or reduced-motion check.
import { useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Animates a displayed integer from its previous value to a new one
// whenever `value` changes (compared via a ref, never a render-count
// heuristic — so an unrelated rerender with the same value never
// replays the animation). Also reports `justChanged`, a brief flag for a
// color-flash class, which clears itself after `flashMs`. Respects
// prefers-reduced-motion by jumping straight to the new value.
//
// `animateFromZero` starts the very first render at 0 instead of `value`,
// so the reveal is visible even without a live channel pushing a real
// update later (this app's dashboard fetches its stats once per mount,
// not over a subscription) — the count-up still correctly re-fires on any
// later real value change either way.
export function useCountUp(value: number, durationMs = 400, flashMs = 600, animateFromZero = false) {
  const [display, setDisplay] = useState(animateFromZero ? 0 : value);
  const [justChanged, setJustChanged] = useState(false);
  const prevValue = useRef(animateFromZero ? 0 : value);
  const rafRef = useRef<number>();
  const flashTimeout = useRef<ReturnType<typeof setTimeout>>();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    // `prevValue.current` is deliberately NOT mutated until the animation
    // actually finishes (see the "commit" points below) — React 18 Strict
    // Mode double-invokes this effect once in dev (mount -> cleanup ->
    // mount again). If the ref were mutated eagerly here, the first
    // (cancelled) invocation would already mark the transition as "done"
    // before its rAF ever ran, and the second (real) invocation would then
    // see value === prevValue.current and bail out — leaving `display`
    // stuck at its initial value forever. Deferring the commit to the
    // point where the animation actually completes makes this idempotent
    // regardless of how many times the effect is invoked.
    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    if (reducedMotion) {
      setDisplay(to);
      prevValue.current = to;
      return;
    }

    let cancelled = false;
    const start = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    function tick(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
        prevValue.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    setJustChanged(true);
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    flashTimeout.current = setTimeout(() => setJustChanged(false), flashMs);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, flashMs, reducedMotion]);

  useEffect(() => () => {
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
  }, []);

  return { display, justChanged };
}

// Fires `onIncrease` when `value` goes up from what it was on the previous
// render — never on first mount (nothing "arrived", it was already there).
// Used for the notification bell's one-shot ring animation.
export function useFiresOnIncrease(value: number, onIncrease: () => void) {
  const prevValue = useRef<number | null>(null);

  useEffect(() => {
    if (prevValue.current !== null && value > prevValue.current) {
      onIncrease();
    }
    prevValue.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
