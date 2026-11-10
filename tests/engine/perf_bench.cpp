// CPU cost of the slice engine, one effect at a time. Build and run in Release.
// Each case renders kSeconds of a noise track at 48 kHz in 512-frame blocks, 1/16-beat slices,
// with every slice playing that effect. It prints the average cost as a share of real time, the best of kRuns runs,
// since the OS adds noise and never removes it. Then it times each piece of the dry path on its own, in ns per call.

#include "SliceEngine.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace {

float g_sink = 0.0f;

constexpr int kRate = 48000;
constexpr int kBlock = 512;
constexpr int kSeconds = 30;
constexpr int kRuns = 3;
constexpr int kCalls = 10000000;

struct Case {
    const char* name;
    double bt::Effects::*chance;
    bt::WarpMode warp;
};

double run(const Case& c, const std::vector<float>& noise) {
    bt::SliceEngine engine(kRate, 7);
    bt::Controls controls = engine.controls();
    controls.play.sliceExp = -4;
    controls.effects.globalChance = c.chance != nullptr ? 1.0 : 0.0;
    if (c.chance != nullptr) {
        controls.effects.*(c.chance) = 1.0;
    }
    engine.apply(controls);
    engine.append({1, noise.data(), noise.data(), static_cast<int>(noise.size())});
    engine.setWarp(0, bt::WarpSettings{c.warp, 100.0, 0.5});
    engine.play();

    std::vector<float> left(kBlock);
    std::vector<float> right(kBlock);
    const int blocks = kSeconds * kRate / kBlock;
    double total = 0.0;
    float sink = 0.0f;
    for (int b = 0; b < blocks; ++b) {
        const auto start = std::chrono::steady_clock::now();
        engine.render(left.data(), right.data(), kBlock);
        total += std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        sink += left[0];
    }
    g_sink += sink;
    return 100.0 * total / kSeconds;
}

void report(const Case& c, const std::vector<float>& noise) {
    double best = run(c, noise);
    for (int r = 1; r < kRuns; ++r) {
        const double next = run(c, noise);
        if (next < best) {
            best = next;
        }
    }
    std::printf("%-14s %6.2f %% of real time\n", c.name, best);
}

template <typename F>
void part(const char* name, F&& call) {
    double best = 1e30;
    for (int r = 0; r < kRuns; ++r) {
        const auto start = std::chrono::steady_clock::now();
        for (int i = 0; i < kCalls; ++i) {
            call(i);
        }
        const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / kCalls;
        if (ns < best) {
            best = ns;
        }
    }
    std::printf("  %-34s %6.2f ns\n", name, best);
}

// One sample at 48 kHz is 20833 ns of real time. Two voices run every piece once per sample, some of them several times.
void parts(const std::vector<float>& noise) {
    const bt::ClockSettings settings{static_cast<double>(kRate), 120.0};
    bt::SliceGrid grid;
    grid.setBpm(120.0);
    grid.setSlice(-4);
    const bt::SampleBuffer buffer{1, noise.data(), noise.data(), static_cast<int>(noise.size())};
    const bt::SampleSettings play{};
    const bt::WarpSettings none{bt::WarpMode::None, 100.0, 0.5};
    const bt::WarpSettings grain{bt::WarpMode::Grain, 100.0, 0.5};
    bt::Clock clock;
    const int slice = clock.sliceFrames(settings, grid);
    double sink = 0.0;

    std::printf("dry path, per call:\n");
    part("Clock::sliceFrames", [&](int i) { clock.seek(i); sink += clock.sliceFrames(settings, grid); });
    part("Clock::fadeFrames", [&](int i) { clock.seek(i); sink += clock.fadeFrames(settings, grid, 4); });
    part("Clock::localIn", [&](int i) { clock.seek(i); sink += clock.localIn(i / slice, settings, grid); });
    part("Clock::arrivingSlot", [&](int i) { clock.seek(i); sink += clock.arrivingSlot(settings, grid, 4); });
    part("SliceReader ctor, none", [&](int i) {
        const bt::SliceReader reader(buffer, play, none, settings, grid, i & 7, slice);
        sink += reinterpret_cast<const char*>(&reader)[0];
    });
    part("SliceReader ctor, grain", [&](int i) {
        const bt::SliceReader reader(buffer, play, grain, settings, grid, i & 7, slice);
        sink += reinterpret_cast<const char*>(&reader)[0];
    });
    const bt::SliceReader noneReader(buffer, play, none, settings, grid, 3, slice);
    part("SliceReader::read, none", [&](int i) { sink += noneReader.read(i % slice).l; });
    const bt::SliceReader grainReader(buffer, play, grain, settings, grid, 3, slice);
    part("SliceReader::read, grain", [&](int i) { sink += grainReader.read(i % slice).l; });
    bt::Interpolator lerp;
    part("Interpolator set + tick", [&](int i) { lerp.set(static_cast<float>(i & 1)); lerp.tick(1.0 / kRate); sink += lerp.get(); });
    bt::SliceEngine engine(kRate, 7);
    bt::Controls controls = engine.controls();
    controls.play.sliceExp = -4;
    engine.apply(controls);
    engine.append(buffer);
    engine.play();
    float l = 0.0f;
    float r = 0.0f;
    part("SliceEngine::render, 1 frame", [&](int) { engine.render(&l, &r, 1); sink += l; });
    g_sink += static_cast<float>(sink);
}

} // namespace

int main() {
    std::vector<float> noise(static_cast<std::size_t>(kRate) * 30);
    std::uint32_t state = 12345u;
    for (float& s : noise) {
        state = state * 1664525u + 1013904223u;
        s = static_cast<float>(state >> 8) / 16777216.0f * 2.0f - 1.0f;
    }

    const Case cases[] = {
        {"dry", nullptr, bt::WarpMode::None},
        {"dry pitch", nullptr, bt::WarpMode::Pitch},
        {"dry beat", nullptr, bt::WarpMode::Beat},
        {"dry grain", nullptr, bt::WarpMode::Grain},
        {"reverb", &bt::Effects::reverbChance, bt::WarpMode::None},
        {"delay", &bt::Effects::delayChance, bt::WarpMode::None},
        {"reverse", &bt::Effects::reverseChance, bt::WarpMode::None},
        {"filter", &bt::Effects::filterChance, bt::WarpMode::None},
        {"flanger", &bt::Effects::flangerChance, bt::WarpMode::None},
        {"trance", &bt::Effects::tranceChance, bt::WarpMode::None},
        {"shift", &bt::Effects::shiftChance, bt::WarpMode::None},
    };
    for (const Case& c : cases) {
        report(c, noise);
    }
    parts(noise);
    std::printf("(%g)\n", static_cast<double>(g_sink) * 0.0);
    return 0;
}
