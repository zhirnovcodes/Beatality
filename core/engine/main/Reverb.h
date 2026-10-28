#pragma once

#include <memory>

namespace bt {

// Freeverb-sized comb and allpass tank. Wet signal only; the mix with dry is outside.
// The beat length sets the decay. The wet mix scales that feedback. The tank is allocated with the engine.
class Reverb {
public:
    explicit Reverb(double sampleRate);

    void apply(float dryL, float dryR, int pos, float wet, double beats, double sampleRate, double bpm, float& outL, float& outR);
    void clean();

private:
    struct Stage {
        int length = 0;
        int index = 0;
        int offset = 0;
        float store = 0.0f;
    };

    float comb(Stage& stage, float input, float feedback);
    float allpass(Stage& stage, float input);
    float tank(Stage* combs, Stage* allpasses, float input, float feedback);

    Stage combsL_[8]{};
    Stage combsR_[8]{};
    Stage allL_[4]{};
    Stage allR_[4]{};
    // Owned here so moving a bank, which the fade does, keeps the same tank.
    std::unique_ptr<float[]> buffer_;
    int bufferCount_ = 0;
    bool quiet_ = true;
};

} // namespace bt
