#pragma once

namespace bt {

// Bandpass. An LFO moves the frequency from 100 to 10000, one cycle per beat.
// Power sets resonance, dry, wet, and output velocity. Those settings are in Filter.cpp.
class Filter {
public:
    void apply(float dryL, float dryR, int pos, float power, double beats, double sampleRate, double bpm, float& outL, float& outR);
    void clean();

private:
    double phase_ = 0;
    float z1L_ = 0.0f;
    float z2L_ = 0.0f;
    float z1R_ = 0.0f;
    float z2R_ = 0.0f;
    bool quiet_ = true;
};

} // namespace bt
