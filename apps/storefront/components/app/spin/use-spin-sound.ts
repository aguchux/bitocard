"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/** The wheel's sounds: off until the customer turns them on (never remembered), synthesised, so nothing is fetched. */
export type SpinSound = { on: boolean; toggle: () => void; tick: () => void; win: () => void };

type AudioContextClass = typeof AudioContext;

export function useSpinSound(): SpinSound {
  const [on, setOn] = useState(false);
  const enabled = useRef(false);
  const context = useRef<AudioContext | null>(null);

  /** The audio context, made on the first tap (browsers allow sound only after one). */
  const audio = useCallback(() => {
    if (!context.current) {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
      if (!Audio) return null;
      context.current = new Audio();
    }
    if (context.current.state === "suspended") void context.current.resume();
    return context.current;
  }, []);

  const tone = useCallback((frequency: number, delay: number, length: number, volume: number, type: OscillatorType) => {
    const ctx = context.current;
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + length + 0.02);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabled.current;
    enabled.current = next;
    if (next && audio()) tone(880, 0, 0.14, 0.05, "triangle");
    setOn(next);
  }, [audio, tone]);

  /** A peg passing the pointer. */
  const tick = useCallback(() => {
    if (enabled.current && audio()) tone(2200, 0, 0.03, 0.06, "triangle");
  }, [audio, tone]);

  /** The landing: a rising arpeggio and a shimmer. */
  const win = useCallback(() => {
    if (!enabled.current || !audio()) return;
    [1046.5, 1318.5, 1568, 2093].forEach((frequency, i) => tone(frequency, i * 0.09, 0.34, 0.07, "triangle"));
    tone(2637, 0.4, 0.7, 0.035, "sine");
  }, [audio, tone]);

  return useMemo(() => ({ on, toggle, tick, win }), [on, toggle, tick, win]);
}
