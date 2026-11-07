cmake_minimum_required(VERSION 3.25)
project(Beatality VERSION 0.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The core does not throw or use RTTI. JUCE does, so these flags stay on the core only.
function(beatality_core_flags target)
    if(MSVC)
        target_compile_options(${target} PRIVATE /GR- /EHs-c-)
    else()
        target_compile_options(${target} PRIVATE -fno-exceptions -fno-rtti)
    endif()
endfunction()

add_library(beatality_domain
    core/domain/Rng.cpp
    core/domain/Session.cpp
)
target_include_directories(beatality_domain PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/domain)
beatality_core_flags(beatality_domain)

add_library(beatality_slices
    core/domain/Chaos.cpp
    core/domain/RepeatSequence.cpp
    core/domain/Sequence.cpp
    core/domain/SliceGrid.cpp
)
target_include_directories(beatality_slices PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/domain)
target_link_libraries(beatality_slices PUBLIC beatality_domain)
beatality_core_flags(beatality_slices)

add_library(beatality_engine_common INTERFACE)
target_include_directories(beatality_engine_common INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/core/engine/common
)

add_executable(domain_tests tests/domain/session_tests.cpp)
target_link_libraries(domain_tests PRIVATE beatality_domain)
beatality_core_flags(domain_tests)

add_executable(chaos_tests tests/domain/chaos_tests.cpp)
target_link_libraries(chaos_tests PRIVATE beatality_slices)
beatality_core_flags(chaos_tests)

add_executable(slice_tests tests/domain/slice_tests.cpp)
target_link_libraries(slice_tests PRIVATE beatality_slices)
beatality_core_flags(slice_tests)

add_library(beatality_slice_engine
    core/engine/main/BeatRepeat.cpp
    core/engine/main/Clock.cpp
    core/engine/main/Curve.cpp
    core/engine/main/Effect.cpp
    core/engine/main/SlicePlayer.cpp
    core/engine/main/EffectsBank.cpp
    core/engine/main/Delay.cpp
    core/engine/main/Reverb.cpp
    core/engine/main/Filter.cpp
    core/engine/main/Flanger.cpp
    core/engine/main/Shift.cpp
    core/engine/main/Trance.cpp
    core/engine/main/Reverse.cpp
    core/engine/main/SampleBank.cpp
    core/engine/main/SliceReader.cpp
    core/engine/main/SliceEngine.cpp
)
target_include_directories(beatality_slice_engine PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/core/engine/main
)
target_link_libraries(beatality_slice_engine PUBLIC beatality_slices beatality_engine_common)
beatality_core_flags(beatality_slice_engine)

add_executable(pair_tests tests/engine/pair_tests.cpp)
target_link_libraries(pair_tests PRIVATE beatality_slice_engine)
beatality_core_flags(pair_tests)

if(EMSCRIPTEN)
    # Standalone module for the AudioWorklet: instantiated directly, no Emscripten JS glue.
    # The web page and the plugin both play the slice engine.
    add_executable(beatality hosts/web/boundary/engine_api.cpp)
    target_include_directories(beatality PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/hosts/common)
    target_link_libraries(beatality PRIVATE beatality_slice_engine)
    beatality_core_flags(beatality)
    set_target_properties(beatality PROPERTIES SUFFIX ".wasm")
    target_link_options(beatality PRIVATE
        -O2
        --no-entry
        -sSTANDALONE_WASM
        -sALLOW_MEMORY_GROWTH
        -sFILESYSTEM=0
        -sEXPORTED_FUNCTIONS=_bt_alloc,_bt_free,_bt_create,_bt_destroy,_bt_append,_bt_append_empty,_bt_install_sequence,_bt_midi,_bt_randomize,_bt_chaos,_bt_remove,_bt_clear,_bt_set_bpm,_bt_set_loop,_bt_set_slice,_bt_set_attack,_bt_set_global_power,_bt_set_effects_enabled,_bt_set_retrig,_bt_set_global_beat_range,_bt_set_global_chance,_bt_set_reverb_power,_bt_set_reverb_chance,_bt_set_delay_power,_bt_set_delay_chance,_bt_set_reverse_power,_bt_set_reverse_chance,_bt_set_filter_power,_bt_set_filter_chance,_bt_set_flanger_power,_bt_set_flanger_chance,_bt_set_trance_power,_bt_set_trance_chance,_bt_set_shift_power,_bt_set_shift_chance,_bt_set_repeat_enabled,_bt_set_repeat_size_range,_bt_set_repeat_length,_bt_set_repeat_chance,_bt_set_repeat_position,_bt_set_repeat_mix,_bt_set_chaos,_bt_controls_changed,_bt_controls_write,_bt_set_track,_bt_set_output,_bt_render,_bt_snapshot,_bt_snapshot_count,_bt_snapshot_playing,_bt_snapshot_slice_exp,_bt_snapshot_loop,_bt_snapshot_bpm,_bt_snapshot_play_slot,_bt_snapshot_play_track,_bt_snapshot_playhead,_bt_snapshot_released_count,_bt_snapshot_released_id
    )
else()
    set(BEATALITY_JUCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/JUCE)
    if(EXISTS ${BEATALITY_JUCE_DIR}/CMakeLists.txt)
        set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
        set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        add_subdirectory(${BEATALITY_JUCE_DIR} ${CMAKE_BINARY_DIR}/_juce EXCLUDE_FROM_ALL)

        juce_add_plugin(Beatality
            COMPANY_NAME "Beatality"
            PLUGIN_MANUFACTURER_CODE Btly
            PLUGIN_CODE Bt01
            FORMATS VST3 Standalone
            PRODUCT_NAME "Beatality"
            VERSION 0.0.1
            IS_SYNTH TRUE
            NEEDS_MIDI_INPUT TRUE
            NEEDS_MIDI_OUTPUT FALSE
            IS_MIDI_EFFECT FALSE
            EDITOR_WANTS_KEYBOARD_FOCUS TRUE
            COPY_PLUGIN_AFTER_BUILD FALSE
            NEEDS_WEB_BROWSER TRUE
            NEEDS_WEBVIEW2 TRUE
            NEEDS_CURL FALSE
            VST3_CATEGORIES Instrument Synth
        )
        target_sources(Beatality
            PRIVATE
                hosts/plugin/PackFile.cpp
                hosts/plugin/PluginProcessor.cpp
                hosts/plugin/PluginEditor.cpp
        )
        target_include_directories(Beatality PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/hosts/common)
        # The preset library the web page saves into. Resources are found by file name, so samples sit in one flat folder.
        file(GLOB BEATALITY_PACK_FILES CONFIGURE_DEPENDS
            "${CMAKE_CURRENT_SOURCE_DIR}/apps/web-widget/public/packs/banks.json"
            "${CMAKE_CURRENT_SOURCE_DIR}/apps/web-widget/public/packs/*.beatality"
            "${CMAKE_CURRENT_SOURCE_DIR}/apps/web-widget/public/packs/samples/*")
        juce_add_binary_data(BeatalityBank SOURCES ${BEATALITY_PACK_FILES})
        file(GLOB BEATALITY_SHAPE_PNGS CONFIGURE_DEPENDS
            "${CMAKE_CURRENT_SOURCE_DIR}/apps/web-widget/src/ui/shapes/*.png")
        juce_add_binary_data(BeatalitySkin
            HEADER_NAME SkinData.h
            NAMESPACE SkinData
            SOURCES
                hosts/plugin/ui/index.html
                hosts/plugin/ui/plugin.js
                apps/web-widget/src/ui/skin/skin.css
                apps/web-widget/src/ui/skin/DSEG7Classic-Bold.woff2
                apps/web-widget/src/ui/skin/Orbitron-Bold.ttf
                apps/web-widget/src/ui/skin/silkscreen-latin-400-normal.woff2
                apps/web-widget/src/ui/skin/silkscreen-latin-700-normal.woff2
                ${BEATALITY_SHAPE_PNGS}
        )
        target_compile_definitions(Beatality
            PUBLIC
                JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
                JUCE_USE_CURL=0
                JUCE_VST3_CAN_REPLACE_VST2=0
                JUCE_USE_MP3AUDIOFORMAT=1
        )
        target_link_libraries(Beatality
            PRIVATE
                beatality_slice_engine
                BeatalityBank
                BeatalitySkin
                juce::juce_audio_utils
                juce::juce_audio_formats
                juce::juce_gui_extra
            PUBLIC
                juce::juce_recommended_config_flags
                juce::juce_recommended_warning_flags
        )
    else()
        message(STATUS "JUCE not found at third_party/JUCE; the plugin target was skipped")
    endif()
endif()
