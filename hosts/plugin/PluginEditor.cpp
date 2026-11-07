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
    // The skin is 496 x 638; the error line floats over its bottom. The open drawers reach x 746, right of the skin.
    setSize(746, 638);
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
        .withNativeFunction("banks", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            completion(processor.factoryBanks());
        })
        .withNativeFunction("loadFactory", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            const bool ok = !args.isEmpty() && processor.loadFactory(args[0].toString());
            if (ok) {
                noteBank(true);
            } else {
                pushLive();
            }
            completion(ok);
        })
        .withNativeFunction("loadPackFile", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            chooser = std::make_unique<juce::FileChooser>("Load pack", juce::File(), "*.beatality");
            const auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles;
            juce::Component::SafePointer<Editor> safe(this);
            chooser->launchAsync(flags, [safe, completion](const juce::FileChooser& dialog) {
                if (safe == nullptr) {
                    completion(false);
                    return;
                }
                const juce::File file = dialog.getResult();
                if (file == juce::File()) {
                    completion(false);
                    return;
                }
                const bool ok = safe->processor.loadPackText(file.loadFileAsString());
                if (ok) {
                    safe->noteBank(true);
                } else {
                    safe->pushLive();
                }
                completion(ok);
            });
        })
        .withNativeFunction("savePack", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            const juce::String text = processor.packText();
            chooser = std::make_unique<juce::FileChooser>("Save pack", juce::File(), "*.beatality");
            const auto flags = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles |
                               juce::FileBrowserComponent::warnAboutOverwriting;
            juce::Component::SafePointer<Editor> safe(this);
            chooser->launchAsync(flags, [safe, completion, text](const juce::FileChooser& dialog) {
                if (safe == nullptr) {
                    completion(false);
                    return;
                }
                juce::File file = dialog.getResult();
                if (file == juce::File()) {
                    completion(false);
                    return;
                }
                if (!file.hasFileExtension(".beatality")) {
                    file = file.withFileExtension(".beatality");
                }
                completion(file.replaceWithText(text));
            });
        })
        .withNativeFunction("randomize", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            processor.randomizeTracks();
            completion(true);
        })
        .withNativeFunction("shuffle", [this](const juce::Array<juce::var>&, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            processor.shuffleEffects();
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
        .withNativeFunction("setEffectsEnabled", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setEffectsEnabled(static_cast<bool>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setGlobalPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setGlobalPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setGlobalBeatRange", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 2) {
                processor.setGlobalBeatRange(static_cast<int>(args[0]), static_cast<int>(args[1]));
            }
            completion(true);
        })
        .withNativeFunction("setGlobalChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setGlobalChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setReverbPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setReverbPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setReverbChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setReverbChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setDelayPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setDelayPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setDelayChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setDelayChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setReversePower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setReversePower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setReverseChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setReverseChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setFilterPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setFilterPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setFilterChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setFilterChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setFlangerPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setFlangerPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setFlangerChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setFlangerChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setTrancePower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setTrancePower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setTranceChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setTranceChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setShiftPower", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setShiftPower(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setShiftChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setShiftChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setBpmSync", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setBpmSync(static_cast<bool>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setRetrig", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setRetrig(static_cast<bool>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatEnabled", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setRepeatEnabled(static_cast<bool>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatSizeRange", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 2) {
                processor.setRepeatSizeRange(static_cast<int>(args[0]), static_cast<int>(args[1]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatLength", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setRepeatLength(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatChance", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setRepeatChance(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatPosition", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 2) {
                processor.setRepeatPosition(static_cast<int>(args[0]), static_cast<bool>(args[1]));
            }
            completion(true);
        })
        .withNativeFunction("setRepeatMix", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setRepeatMix(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosTrigger", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setChaosTrigger(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosValue", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setChaosValue(static_cast<double>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosGroup", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 2) {
                processor.setChaosGroup(static_cast<int>(args[0]), static_cast<bool>(args[1]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosBeatSize", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setChaosBeatSize(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosLoopSize", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setChaosLoopSize(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setChaosSliceSize", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (!args.isEmpty()) {
                processor.setChaosSliceSize(static_cast<int>(args[0]));
            }
            completion(true);
        })
        .withNativeFunction("setOutput", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 3) {
                processor.setOutput(static_cast<double>(args[0]), static_cast<double>(args[1]), static_cast<double>(args[2]));
            }
            completion(true);
        })
        .withNativeFunction("setTrack", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 6) {
                processor.setTrack(static_cast<int>(args[0]), static_cast<double>(args[1]), static_cast<double>(args[2]),
                                   static_cast<bool>(args[3]), static_cast<double>(args[4]), static_cast<double>(args[5]));
            }
            completion(true);
        })
        .withNativeFunction("setWarp", [this](const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion) {
            if (args.size() >= 4) {
                processor.setWarp(static_cast<int>(args[0]), static_cast<int>(args[1]), static_cast<double>(args[2]),
                                  static_cast<double>(args[3]));
            }
            completion(true);
        });
}

void Editor::chooseFiles() {
    chooser = std::make_unique<juce::FileChooser>("Append samples", juce::File(), "*.wav;*.mp3;*.alc");
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
    // Host parameters. The host's automation moves them, so the page follows them here.
    const int loop = processor.loopBeats();
    const int slices = processor.sliceExponent();
    const double volume = processor.outputVolume();
    const double panMin = processor.outputPanMin();
    const double panMax = processor.outputPanMax();
    const bt::BeatRepeatSettings repeat = processor.beatRepeat();
    const double fx[] = {processor.globalPower(),  processor.globalChance(),  processor.delayPower(),    processor.delayChance(),
                         processor.reverbPower(),  processor.reverbChance(),  processor.reversePower(),  processor.reverseChance(),
                         processor.filterPower(),  processor.filterChance(),  processor.flangerPower(),  processor.flangerChance(),
                         processor.trancePower(),  processor.tranceChance(),  processor.shiftPower(),    processor.shiftChance()};
    juce::String key;
    key << playhead << '|' << playTrack << '|' << playSlot << '|' << (canAppend ? 1 : 0) << '|' << error << '|' << loop << '|'
        << slices << '|' << volume << '|' << panMin << '|' << panMax << '|' << (processor.effectsEnabled() ? 1 : 0) << '|'
        << processor.globalBeatMin() << '|' << processor.globalBeatMax() << '|' << (repeat.enabled ? 1 : 0) << '|' << repeat.sizeMin << '|'
        << repeat.sizeMax << '|' << repeat.length << '|' << repeat.chance << '|' << repeat.mix << '|' << processor.attackMs() << '|'
        << (processor.retrig() ? 1 : 0);
    for (const bool on : repeat.positions) {
        key << (on ? '1' : '0');
    }
    const bt::ChaosSettings chaos = processor.chaos();
    key << '|' << static_cast<int>(chaos.trigger) << '|' << chaos.value << '|' << chaos.beatSize << '|' << chaos.loopSize << '|'
        << chaos.sliceSize << '|';
    for (const bool on : chaos.groups) {
        key << (on ? '1' : '0');
    }
    for (const double value : fx) {
        key << '|' << value;
    }
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
    object->setProperty("loop", loop);
    object->setProperty("slices", slices);
    object->setProperty("volume", volume);
    object->setProperty("panMin", panMin);
    object->setProperty("panMax", panMax);
    object->setProperty("effectsEnabled", processor.effectsEnabled());
    object->setProperty("retrig", processor.retrig());
    object->setProperty("globalPower", processor.globalPower());
    object->setProperty("globalBeatMin", processor.globalBeatMin());
    object->setProperty("globalBeatMax", processor.globalBeatMax());
    object->setProperty("globalChance", processor.globalChance());
    object->setProperty("reverbPower", processor.reverbPower());
    object->setProperty("reverbChance", processor.reverbChance());
    object->setProperty("delayPower", processor.delayPower());
    object->setProperty("delayChance", processor.delayChance());
    object->setProperty("reversePower", processor.reversePower());
    object->setProperty("reverseChance", processor.reverseChance());
    object->setProperty("filterPower", processor.filterPower());
    object->setProperty("filterChance", processor.filterChance());
    object->setProperty("flangerPower", processor.flangerPower());
    object->setProperty("flangerChance", processor.flangerChance());
    object->setProperty("trancePower", processor.trancePower());
    object->setProperty("tranceChance", processor.tranceChance());
    object->setProperty("shiftPower", processor.shiftPower());
    object->setProperty("shiftChance", processor.shiftChance());
    object->setProperty("repeatEnabled", repeat.enabled);
    object->setProperty("repeatSizeMin", repeat.sizeMin);
    object->setProperty("repeatSizeMax", repeat.sizeMax);
    object->setProperty("repeatLength", repeat.length);
    object->setProperty("repeatChance", repeat.chance);
    object->setProperty("repeatMix", repeat.mix);
    object->setProperty("attack", processor.attackMs());
    juce::Array<juce::var> positions;
    for (const bool on : repeat.positions) {
        positions.add(on);
    }
    object->setProperty("repeatPositions", positions);
    object->setProperty("chaosTrigger", static_cast<int>(chaos.trigger));
    object->setProperty("chaosValue", chaos.value);
    object->setProperty("chaosBeatSize", chaos.beatSize);
    object->setProperty("chaosLoopSize", chaos.loopSize);
    object->setProperty("chaosSliceSize", chaos.sliceSize);
    juce::Array<juce::var> groups;
    for (const bool on : chaos.groups) {
        groups.add(on);
    }
    object->setProperty("chaosGroups", groups);
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
    juce::Array<juce::var> starts;
    juce::Array<juce::var> lengths;
    juce::Array<juce::var> loops;
    juce::Array<juce::var> volumes;
    juce::Array<juce::var> pans;
    juce::Array<juce::var> warps;
    juce::Array<juce::var> bpms;
    juce::Array<juce::var> warpParams;
    juce::Array<juce::var> missingTracks;
    for (int i = 0; i < count; ++i) {
        names.add(processor.trackName(i));
        rates.add(processor.trackRate(i));
        frames.add(processor.trackFrames(i));
        starts.add(processor.trackStart(i));
        lengths.add(processor.trackLength(i));
        loops.add(processor.trackLoop(i));
        volumes.add(processor.trackVolume(i));
        pans.add(processor.trackPan(i));
        warps.add(processor.trackWarp(i));
        bpms.add(processor.trackBpm(i));
        warpParams.add(processor.trackWarpParam(i));
        missingTracks.add(processor.trackMissing(i));
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
    object->setProperty("starts", starts);
    object->setProperty("lengths", lengths);
    object->setProperty("loops", loops);
    object->setProperty("volumes", volumes);
    object->setProperty("pans", pans);
    object->setProperty("warps", warps);
    object->setProperty("bpms", bpms);
    object->setProperty("warpParams", warpParams);
    object->setProperty("missing", missingTracks);
    object->setProperty("bpm", processor.bpm());
    object->setProperty("bpmSync", processor.bpmSync());
    object->setProperty("loop", processor.loopBeats());
    object->setProperty("slices", processor.sliceExponent());
    object->setProperty("attack", processor.attackMs());
    object->setProperty("effectsEnabled", processor.effectsEnabled());
    object->setProperty("retrig", processor.retrig());
    object->setProperty("globalPower", processor.globalPower());
    object->setProperty("globalBeatMin", processor.globalBeatMin());
    object->setProperty("globalBeatMax", processor.globalBeatMax());
    object->setProperty("globalChance", processor.globalChance());
    object->setProperty("reverbPower", processor.reverbPower());
    object->setProperty("reverbChance", processor.reverbChance());
    object->setProperty("delayPower", processor.delayPower());
    object->setProperty("delayChance", processor.delayChance());
    object->setProperty("reversePower", processor.reversePower());
    object->setProperty("reverseChance", processor.reverseChance());
    object->setProperty("filterPower", processor.filterPower());
    object->setProperty("filterChance", processor.filterChance());
    object->setProperty("flangerPower", processor.flangerPower());
    object->setProperty("flangerChance", processor.flangerChance());
    object->setProperty("trancePower", processor.trancePower());
    object->setProperty("tranceChance", processor.tranceChance());
    object->setProperty("shiftPower", processor.shiftPower());
    object->setProperty("shiftChance", processor.shiftChance());
    const bt::BeatRepeatSettings repeat = processor.beatRepeat();
    juce::Array<juce::var> positions;
    for (const bool on : repeat.positions) {
        positions.add(on);
    }
    object->setProperty("repeatEnabled", repeat.enabled);
    object->setProperty("repeatSizeMin", repeat.sizeMin);
    object->setProperty("repeatSizeMax", repeat.sizeMax);
    object->setProperty("repeatLength", repeat.length);
    object->setProperty("repeatChance", repeat.chance);
    object->setProperty("repeatPositions", positions);
    object->setProperty("repeatMix", repeat.mix);
    object->setProperty("volume", processor.outputVolume());
    object->setProperty("panMin", processor.outputPanMin());
    object->setProperty("panMax", processor.outputPanMax());
    deliver("onBank", juce::var(object));
}
