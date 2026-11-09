#include "Interpolator.h"

namespace bt {

Interpolator::Interpolator(float value) : value_(value), target_(value) {}

void Interpolator::set(float value) {
    if (value == target_) {
        return;
    }
    target_ = value;
    rate_ = (static_cast<double>(target_) - static_cast<double>(value_)) / kChangeSec;
}

void Interpolator::tick(double seconds) {
    if (value_ == target_) {
        return;
    }
    const double next = static_cast<double>(value_) + rate_ * seconds;
    if ((rate_ > 0.0 && next >= target_) || (rate_ < 0.0 && next <= target_)) {
        value_ = target_;
        return;
    }
    value_ = static_cast<float>(next);
}

} // namespace bt
