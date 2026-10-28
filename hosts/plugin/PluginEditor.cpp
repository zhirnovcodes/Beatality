#include "PluginEditor.h"

#include "SkinData.h"

#include <cstring>
#include <utility>
#include <vector>

namespace {

juce::String mimeFor(const juce::String& filename) {
    if (filename.endsWithIgnoreCase(".html")) {
        return "text/html;charset=utf-8";
    }
    if (filename.endsWithIgnoreCase(".css")) {
        return "text/css;charset=utf-8";
    }
    if (filename.endsWithIgnoreCase(".js")) {
        return "text/javascript;charset=utf-8";
    }
    if (filename.endsWithIgnoreCase(".png")) {
        return "image/png";
    }
    if (filename.endsWithIgnoreCase(".woff2")) {
        return "font/woff2";
    }
    if (filename.endsWithIgnoreCase(".ttf")) {
        return "font/ttf";
    }
    if (filename.endsWithIgnoreCase(".txt")) {
        return "text/plain;charset=utf-8";
    }
    return "application/octet-stream";
}

bool sameFile(const juce::String& requestName, const char* storedName) {
    if (storedName == nullptr) {
        return false;
    }
    const juce::String stored(storedName);
    return stored.equalsIgnoreCase(requestName) || stored.endsWithIgnoreCase("/" + requestName) ||
           stored.endsWithIgnoreCase("\\" + requestName);
}

std::optional<juce::WebBrowserComponent::Resource> loadSkin(const juce::String& request) {
    juce::String path = request;
    const int query = path.indexOfChar('?');
    if (query >= 0) {
        path = path.substring(0, query);
    }
    if (path.startsWithChar('/')) {
        path = path.substring(1);
    }
    juce::String filename = path.isEmpty() ? juce::String("index.html") : path.fromLastOccurrenceOf("/", false, false);
    if (filename.isEmpty() || filename == "index.html") {
        filename = "index.html";
    }

    for (int i = 0; i < SkinData::namedResourceListSize; ++i) {
        if (!sameFile(filename, SkinData::originalFilenames[i])) {
            continue;
        }
        int bytes = 0;
        const char* data = SkinData::getNamedResource(SkinData::namedResourceList[i], bytes);
        if (data == nullptr || bytes <= 0) {
            return std::nullopt;
        }
        std::vector<std::byte> copy(static_cast<std::size_t>(bytes));
        std::memcpy(copy.data(), data, static_cast<std::size_t>(bytes));
        return juce::WebBrowserComponent::Resource{std::move(copy), mimeFor(filename)};
    }
    return std::nullopt;
}

} // namespace

Editor::Editor(Processor& processorIn) : juce::AudioProcessorEditor(processorIn), processor(processorIn) {
    auto options = browserOptions();
    if (juce::WebBrowserComponent::areOptionsSupported(options)) {
        browser = std::make_unique<juce::WebBrowserComponent>(options);
        addAndMakeVisible(*browser);
        browser->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
        startTimerHz(30);
    } else {
        missing.setText("Install the Microsoft Edge WebView2 Runtime to open this window.", juce::dontSendNotification);
        missing.setJustificationType(juce::Justification::centred);
        missing.setColour(juce::Label::textColourId, juce::Colours::white);
        addAndMakeVisible(missing);
    }
    setSize(496, 488);
}

Editor::~Editor() {
    stopTimer();
    browser = nullptr;
}

void Editor::paint(juce::Graphics& graphics) {
    graphics.fillAll(juce::Colour(0xff2a2c30));
}

void Editor::resized() {
    if (browser != nullptr) {
        browser->setBounds(getLocalBounds());
    } else {
        missing.setBounds(getLocalBounds().reduced(24));
    }
}

void Editor::timerCallback() {
    if (!pageReady || browser == nullptr) {
        return;
    }
    pushBank();
    pushLive();
}

juce::WebBrowserComponent::Options Editor::browserOptions() {
    auto folder = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("Beatality").getChildFile("WebView2");
    folder.createDirectory();

    juce::WebBrowserComponent::Options::WinWebView2 webview;
    webview = webview.withUserDataFolder(folder)
                  .withStatusBarDisabled()
                  .withBackgroundColour(juce::Colour(0xff2a2c30));

    juce::WebBrowserComponent::Options options;
    return options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withNativeIntegrationEnabled()
        .withWinWebView2Options(webview)
        .withResourceProvider([](const juce::String& url) { return loadSkin(url); })
        .withNativeFunction("ready", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            pageReady = true;
            lastStamp.clear();
            lastLive.clear();
            pushBank();
            pushLive();
            completion({});
        })
        .withNativeFunction("append", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            chooseFiles();
            completion(true);
        })
        .withNativeFunction("remove", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.removeTrack(static_cast<int>(args[0]));
                noteBank(false);
            }
            completion(true);
        })
        .withNativeFunction("clear", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            const bool ok = processor.clearBank();
            if (ok) {
                noteBank(true);
            } else {
                pushLive();
            }
            completion(ok);
        })
        .withNativeFunction("loadBank", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            const bool ok = processor.loadBank();
            if (ok) {
                noteBank(true);
            } else {
                pushLive();
            }
            completion(ok);
        })
        .withNativeFunction("randomize", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            processor.randomizeTracks();
            completion(true);
        })
        .withNativeFunction("setBpm", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setBpm(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setLoop", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setLoop(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setSlice", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setSlice(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setAttack", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setAttack(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setTrack", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 4) {
                processor.setTrack(static_cast<int>(args[0]), static_cast<double>(args[1]), static_cast<double>(args[2]),
                                   static_cast<bool>(args[3]));
            }
            completion(true);
        });
}

void Editor::chooseFiles() {
    chooser = std::make_unique<juce::FileChooser>("Append samples", juce::File(), "*.wav;*.mp3");
    const auto browserFlags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles |
                              juce::FileBrowserComponent::canSelectMultipleItems;
    juce::Component::SafePointer<Editor> safe(this);
    chooser->launchAsync(browserFlags, [safe](const juce::FileChooser& dialog) {
        if (safe == nullptr) {
            return;
        }
        safe->processor.appendFiles(dialog.getResults());
        safe->noteBank(false);
    });
}

void Editor::deliver(const juce::String& functionName, const juce::var& payload) {
    if (browser == nullptr || !pageReady) {
        return;
    }
    browser->evaluateJavascript("window.beatality." + functionName + "(" + juce::JSON::toString(payload) + ")");
}

void Editor::noteBank(bool replaced) {
    if (replaced) {
        ++epoch;
    }
    lastStamp.clear();
    pushBank();
    pushLive();
}

void Editor::pushLive() {
    if (browser == nullptr || !pageReady) {
        return;
    }
    const double playhead = processor.playhead();
    const int playTrack = processor.playTrack();
    const int playSlot = processor.playSlot();
    const bool canAppend = processor.canAppend();
    const juce::String error = processor.errorText();
    juce::String key;
    key << playhead << '|' << playTrack << '|' << playSlot << '|' << (canAppend ? 1 : 0) << '|' << error;
    if (key == lastLive) {
        return;
    }
    lastLive = key;

    auto* object = new juce::DynamicObject();
    object->setProperty("playhead", playhead);
    object->setProperty("playTrack", playTrack);
    object->setProperty("playSlot", playSlot);
    object->setProperty("canAppend", canAppend);
    object->setProperty("error", error);
    deliver("onLive", juce::var(object));
}

void Editor::pushBank() {
    if (browser == nullptr || !pageReady) {
        return;
    }
    const int count = processor.numTracks();
    juce::String stamp;
    stamp << epoch << '|' << count << '|';
    for (int i = 0; i < count; ++i) {
        stamp << processor.trackName(i) << ':' << processor.trackFrames(i) << ';';
    }
    if (stamp == lastStamp) {
        return;
    }
    lastStamp = stamp;

    juce::Array<juce::var> names;
    juce::Array<juce::var> rates;
    juce::Array<juce::var> frames;
    juce::Array<juce::var> peaks;
    for (int i = 0; i < count; ++i) {
        names.add(processor.trackName(i));
        rates.add(processor.trackRate(i));
        frames.add(processor.trackFrames(i));
        juce::Array<juce::var> columns;
        const auto& row = processor.trackPeaks(i);
        for (float peak : row) {
            columns.add(static_cast<double>(peak));
        }
        peaks.add(juce::var(columns));
    }

    auto* object = new juce::DynamicObject();
    object->setProperty("epoch", epoch);
    object->setProperty("names", names);
    object->setProperty("rates", rates);
    object->setProperty("frames", frames);
    object->setProperty("peaks", peaks);
    deliver("onBank", juce::var(object));
}
