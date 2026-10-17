#include "Session.h"

#include <cmath>
#include <cstdio>

namespace {

int g_failed = 0;

void check(bool ok, const char* text, int line) {
    if (!ok) {
        std::printf("FAIL %s:%d  %s\n", "session_tests.cpp", line, text);
        ++g_failed;
    }
}

#define CHECK(cond) check(static_cast<bool>(cond), #cond, __LINE__)

bool near(double a, double b) {
    return std::fabs(a - b) < 1e-9;
}

void testEmptyListDoesNothing() {
    bt::Session session(1);
    session.play();
    session.randomize();
    session.stop();
    session.removeFirst();
    session.advance(1.0);
    CHECK(session.count() == 0);
    CHECK(session.index() == -1);
    CHECK(!session.playing());
    CHECK(session.position() == 0);
}

void testFirstPlayPicksOnce() {
    bt::Session session(99);
    CHECK(session.append(4.0));
    CHECK(session.append(5.0));
    session.play();
    CHECK(!session.playing());
    CHECK(session.index() == -1);

    session.randomize();
    const int picked = session.index();
    session.play();
    CHECK(session.playing());
    CHECK(session.position() == 0);
    CHECK(picked == 0 || picked == 1);
    CHECK(near(session.duration(), picked == 0 ? 4.0 : 5.0));

    session.advance(1.25);
    session.play();
    CHECK(session.index() == picked);
    CHECK(near(session.position(), 1.25));

    session.stop();
    CHECK(!session.playing());
    CHECK(session.position() == 0);
    CHECK(session.index() == picked);

    session.play();
    CHECK(session.playing());
    CHECK(session.index() == picked);
    CHECK(session.position() == 0);
}

void testSameSeedSamePick() {
    bt::Session a(42);
    bt::Session b(42);
    a.append(1.0);
    a.append(1.0);
    a.append(1.0);
    b.append(1.0);
    b.append(1.0);
    b.append(1.0);
    a.randomize();
    b.randomize();
    CHECK(a.index() == b.index());
}

void testRandomizeKeepsPlayingState() {
    bt::Session session(3);
    session.append(2.0);
    session.append(3.0);
    session.randomize();
    CHECK(!session.playing());
    CHECK(session.position() == 0);
    CHECK(session.index() == 0 || session.index() == 1);

    session.play();
    session.advance(0.75);
    session.randomize();
    CHECK(session.playing());
    CHECK(session.position() == 0);

    session.stop();
    session.randomize();
    CHECK(!session.playing());
    CHECK(session.position() == 0);
}

void testAppendThenOneRandomize() {
    bt::Session session(7);
    CHECK(session.append(1.0));
    CHECK(session.append(2.0));
    CHECK(session.count() == 2);
    CHECK(session.index() == -1);
    CHECK(!session.playing());
    CHECK(near(session.trackDuration(0), 1.0));
    CHECK(near(session.trackDuration(1), 2.0));

    session.randomize();
    CHECK(!session.playing());
    CHECK(session.position() == 0);
    CHECK(session.index() == 0 || session.index() == 1);
    CHECK(near(session.duration(), session.index() == 0 ? 1.0 : 2.0));

    CHECK(!session.append(0.0));
    CHECK(!session.append(-1.0));
    CHECK(session.count() == 2);
}

void testTrackCap() {
    bt::Session session(1);
    for (int i = 0; i < bt::Session::kMaxTracks; ++i) {
        CHECK(session.append(1.0));
    }
    CHECK(!session.append(1.0));
    CHECK(session.count() == bt::Session::kMaxTracks);
}

void testRemoveClearsAChosenFirstTrack() {
    bt::Session session(11);
    session.append(1.0);
    session.randomize();
    session.play();
    session.advance(0.25);
    session.append(2.0);
    session.append(3.0);
    session.removeFirst();
    CHECK(session.count() == 2);
    CHECK(near(session.trackDuration(0), 2.0));
    CHECK(near(session.trackDuration(1), 3.0));
    CHECK(session.playing());
    CHECK(session.position() == 0);
    CHECK(session.index() == -1);
}

void testRemoveKeepsALaterChoice() {
    bt::Session session(11);
    session.append(1.0);
    session.append(2.0);
    session.append(3.0);
    session.randomize();
    for (int i = 0; i < 20 && session.index() < 1; ++i) {
        session.randomize();
    }
    CHECK(session.index() >= 1);
    const int chosen = session.index();
    session.play();
    session.advance(0.4);
    session.removeFirst();
    CHECK(session.count() == 2);
    CHECK(session.playing());
    CHECK(session.index() == chosen - 1);
    CHECK(near(session.position(), 0.4));
}

void testRemoveWhileStoppedStaysStopped() {
    bt::Session session(11);
    session.append(1.0);
    session.append(2.0);
    session.removeFirst();
    CHECK(session.count() == 1);
    CHECK(!session.playing());
    CHECK(session.position() == 0);
    CHECK(session.index() == -1);
    CHECK(near(session.trackDuration(0), 2.0));
}

void testRemoveLastStops() {
    bt::Session session(1);
    session.append(1.5);
    session.randomize();
    session.play();
    session.advance(0.25);
    session.removeFirst();
    CHECK(session.count() == 0);
    CHECK(!session.playing());
    CHECK(session.index() == -1);
    CHECK(session.position() == 0);
    session.advance(1.0);
    CHECK(session.position() == 0);
}

void testAdvanceWraps() {
    bt::Session session(5);
    session.append(1.5);
    session.randomize();
    session.play();
    session.advance(1.5);
    CHECK(near(session.position(), 0.0));
    session.advance(1.6);
    CHECK(near(session.position(), 0.1));
    session.advance(3.0);
    CHECK(near(session.position(), 0.1));

    session.stop();
    session.advance(1.0);
    CHECK(session.position() == 0);
    CHECK(session.index() == 0);
}

} // namespace

int main() {
    testEmptyListDoesNothing();
    testFirstPlayPicksOnce();
    testSameSeedSamePick();
    testRandomizeKeepsPlayingState();
    testAppendThenOneRandomize();
    testTrackCap();
    testRemoveClearsAChosenFirstTrack();
    testRemoveKeepsALaterChoice();
    testRemoveWhileStoppedStaysStopped();
    testRemoveLastStops();
    testAdvanceWraps();

    if (g_failed != 0) {
        std::printf("%d check(s) failed\n", g_failed);
        return 1;
    }
    std::printf("domain tests passed\n");
    return 0;
}
