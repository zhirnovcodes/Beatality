#pragma once

namespace bt {

// Equal-power fade of about 10 ms. Frames outside [0, length] are clamped.
int fadeFrames(double sampleRate);   // round(0.010 * sampleRate), at least 1
float fadeInGain(int frame, int length);
float fadeOutGain(int frame, int length);

} // namespace bt
