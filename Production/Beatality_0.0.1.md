# Beatality 0.0.1

VST3 plugin and a standalone app. The same playback core as 0.0.0. A MIDI note takes the place of the Play / Stop button.

## Interface

- Sample list. The chosen sample is marked.
- Append. Adds a sample to the end of the list. WAV and MP3 only. Several files chosen together are all added.
- Remove. Removes the sample at index 0.
- Randomize.

There is no Play / Stop button. Remove and Randomize do nothing when the list is empty.

## Playback

There is no sequence of slots in this version. There is one chosen sample index. A new sample, whether playback is starting or a new one was just picked, starts at position 0.

- The first note-on, when nothing is chosen yet, picks one sample at random and plays it from the start.
- A later note-on plays that same sample again, from the start. It does not pick a new one.
- The note is a gate. While at least one note is held, the sample plays from its first sample to its last, then starts over. The loop length is the length of the file.
- The last note-off fades out and stops. Position returns to 0. The chosen sample stays selected.
- Any note on any channel opens the gate. Velocity is ignored. The note number does not change pitch or speed.
- A second note, while one is already held, does not restart the sample.
- Randomize picks a new sample and resets position to 0. If a note is held, the current sound fades out and the new one fades in from the start. If nothing is playing, it stays stopped.
- Append and Remove do the same thing Randomize does. After several files are appended at once, that pick happens once.
- Removing the last sample fades out, clears the choice, and stays stopped. If the note is still held and a sample is appended after that, the new sample starts from the beginning.

## Volume curve

The same curve as 0.0.0. About 10 ms, equal-power. Fade in when the gate opens, fade out when it closes. Randomize, Append, and Remove do both at the same time when something is already playing: the old sound fades out while the new one fades in from the start. While stopped they only change the choice.

The point where a file jumps from its end back to its start is a 10 ms linear crossfade. The start of the file is mixed over the end, then not played again, so the join does not click.

## How it is built

- The playback rules and the volume curve are the C++ core from 0.0.0.
- JUCE hosts that core. The plugin is a VST3 instrument, and the same build is a standalone app, on Windows.
- MIDI in, stereo out. No audio input.
- Loaded samples are not saved with the plugin. Reopening a project starts with an empty list.

## Not in this version

BPM, slice size, loop size, a multi-slot sequence, presets, moving a sample, a start position other than 0, auto-randomize, velocity, and pitch.
