"use client";

import { useEffect } from "react";

/**
 * The ring of an incoming call (two tones, twice a second, and a vibration where the phone allows) or the ring back a
 * caller hears while it rings out, drawn with Web Audio (no sound file). Browsers may keep a page silent until the
 * person has touched it; then only the panel shows.
 */
export function useRinger(kind: "incoming" | "ringback" | null) {
  useEffect(() => {
    if (!kind || typeof window === "undefined" || !("AudioContext" in window)) return;
    const context = new AudioContext();
    void context.resume().catch(() => undefined);
    const beep = (frequency: number, at: number, length: number, volume: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.02);
      gain.gain.linearRampToValueAtTime(0, at + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + length + 0.05);
    };
    const play = () => {
      const now = context.currentTime;
      if (kind === "incoming") {
        beep(880, now, 0.35, 0.18);
        beep(660, now + 0.4, 0.35, 0.18);
        navigator.vibrate?.([300, 200, 300]);
      } else {
        beep(425, now, 1, 0.06);
      }
    };
    play();
    const timer = window.setInterval(play, kind === "incoming" ? 2000 : 3000);
    return () => {
      window.clearInterval(timer);
      navigator.vibrate?.(0);
      void context.close().catch(() => undefined);
    };
  }, [kind]);
}
