"""Writes the call tones (assets/sounds): the ring of an incoming call and the ring back a caller hears, as small
16-bit mono WAV files drawn from sine waves (no recording, nobody else's sound). Rerun after changing a tone."""
import math
import struct
import wave
from pathlib import Path

RATE = 16000
OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"


def tone(parts, length):
    """`parts` is (start s, end s, frequency Hz, volume 0-1); silence elsewhere, 20 ms fades so nothing clicks."""
    samples = [0.0] * int(RATE * length)
    for start, end, frequency, volume in parts:
        first, last = int(start * RATE), int(end * RATE)
        fade = int(0.02 * RATE)
        for i in range(first, last):
            edge = min(i - first, last - i, fade) / fade
            samples[i] += volume * edge * math.sin(2 * math.pi * frequency * (i - first) / RATE)
    return samples


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / name), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))


# Two tones, as udozo.com's ringer (880 Hz then 660 Hz), every 2 seconds.
write("ring.wav", tone([(0, 0.35, 880, 0.5), (0.4, 0.75, 660, 0.5)], 2.0))
# A 425 Hz ring back for a second, every 3 seconds.
write("ringback.wav", tone([(0, 1.0, 425, 0.25)], 3.0))
