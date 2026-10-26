#pragma once

namespace bt {

// What a MIDI event does to the transport. Pitch and velocity are not part of this.
enum class Gate { None, Start, Stop };

// The first note-on starts playback. Further note-ons leave it running.
// The last note-off stops. All-notes-off stops when anything is held.
class NoteGate {
public:
    Gate noteOn();
    Gate noteOff();
    Gate allOff();
    int held() const { return held_; }

private:
    int held_ = 0;
};

inline Gate NoteGate::noteOn() {
    if (held_ == 0) {
        ++held_;
        return Gate::Start;
    }
    ++held_;
    return Gate::None;
}

inline Gate NoteGate::noteOff() {
    if (held_ <= 0) {
        return Gate::None;
    }
    --held_;
    return held_ == 0 ? Gate::Stop : Gate::None;
}

inline Gate NoteGate::allOff() {
    if (held_ <= 0) {
        held_ = 0;
        return Gate::None;
    }
    held_ = 0;
    return Gate::Stop;
}

} // namespace bt
