# Beatality 0.0.0

Web-only demo. One random sample, played on repeat for its own length.

## Interface

- Play / Stop. One button. It shows Play while stopped and Stop while playing.
- Sample list. The chosen sample is marked.
- Append. Adds a sample to the end of the list. WAV and MP3 only. Several files chosen together are all added.
- Remove. Removes the sample at index 0.
- Randomize.

Play, Remove, and Randomize do nothing when the list is empty.

## Playback

There is no sequence of slots in this version. There is one chosen sample index.

- The first Play, when nothing is chosen yet, picks one sample at random and plays it from the start.
- A later Play plays that same sample again. It does not pick a new one.
- The sample plays from its first sample to its last, then starts over. The loop length is the length of the file.
- Stop fades out and stops. Position returns to 0. The chosen sample stays selected.
- Play is the only control that starts playback.
- Randomize picks a new sample and resets position to 0. If something is already playing, the current sound fades out and the new one fades in. If nothing is playing, it stays stopped.
- Append and Remove do the same thing Randomize does. After several files are appended at once, that pick happens once.
- Removing the last sample fades out, clears the choice, and stays stopped.

## Volume curve

About 10 ms, equal-power. Fade in on play, fade out on stop. Randomize, Append, and Remove do both at the same time when something is already playing: the old sound fades out while the new one fades in. While stopped they only change the choice.

The point where a file jumps from its end back to its start is a 10 ms linear crossfade. The start of the file is mixed over the end, then not played again, so the join does not click.

## How it is built

- The playback rules and the volume curve are C++.
- Emscripten compiles that C++ to WebAssembly so the browser can run it.
- An AudioWorklet runs it on the browser's audio thread.
- The page is TypeScript and Preact.
- Vite serves the page while developing and bundles it for the site.

JUCE is the toolkit for the VST plugin. This version does not use it.

## Not in this version

BPM, slice size, loop size, a multi-slot sequence, presets, moving a sample, start position, auto-randomize, and the plugin.
