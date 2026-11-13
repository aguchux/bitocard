import { createAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Platform, Vibration } from 'react-native';

/** The tones (assets/sounds, written by scripts/call-tones.py): udozo.com's ringer's two tones, and a ring back. */
const ring = require('@/assets/sounds/ring.wav');
const ringback = require('@/assets/sounds/ringback.wav');

/**
 * The ring of an incoming call in the app's own panel (with a vibration on Android), or the ring back a caller hears
 * while it rings out, looped until the call is answered or over. An iPhone's call a push reported rings through CallKit
 * instead (`CallProvider`). Sound never stops a call: a player that fails is left silent.
 */
export function useRinger(kind: 'incoming' | 'ringback' | null) {
  useEffect(() => {
    if (!kind) return;
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    try {
      player = createAudioPlayer(kind === 'incoming' ? ring : ringback);
      player.loop = true;
      player.play();
    } catch {
      player = null;
    }
    if (kind === 'incoming' && Platform.OS === 'android') Vibration.vibrate([0, 400, 300, 400, 900], true);
    return () => {
      if (kind === 'incoming') Vibration.cancel();
      try {
        player?.remove();
      } catch {
        // Already gone.
      }
    };
  }, [kind]);
}
