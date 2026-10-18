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

# The grid and the sequence throw on a broken call, so this library keeps exceptions.
add_library(beatality_slices
    core/domain/Sequence.cpp
    core/domain/SliceGrid.cpp
)
target_include_directories(beatality_slices PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/domain)
target_link_libraries(beatality_slices PUBLIC beatality_domain)
if(MSVC)
    target_compile_options(beatality_slices PRIVATE /EHsc)
else()
    target_compile_options(beatality_slices PRIVATE -fexceptions)
endif()

add_library(beatality_engine
    core/engine/Ramp.cpp
    core/engine/SampleBank.cpp
    core/engine/Voice.cpp
    core/engine/Engine.cpp
)
target_include_directories(beatality_engine PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/core/engine
    ${CMAKE_CURRENT_SOURCE_DIR}/core/contract
)
target_link_libraries(beatality_engine PUBLIC beatality_domain)
beatality_core_flags(beatality_engine)

add_executable(domain_tests tests/domain/session_tests.cpp)
target_link_libraries(domain_tests PRIVATE beatality_domain)
beatality_core_flags(domain_tests)

add_executable(slice_tests tests/domain/slice_tests.cpp)
target_link_libraries(slice_tests PRIVATE beatality_slices)
if(MSVC)
    target_compile_options(slice_tests PRIVATE /EHsc)
else()
    target_compile_options(slice_tests PRIVATE -fexceptions)
endif()

if(EMSCRIPTEN)
    # Standalone module for the AudioWorklet: instantiated directly, no Emscripten JS glue.
    add_executable(beatality hosts/web/boundary/engine_api.cpp)
    target_link_libraries(beatality PRIVATE beatality_engine)
    beatality_core_flags(beatality)
    set_target_properties(beatality PROPERTIES SUFFIX ".wasm")
    target_link_options(beatality PRIVATE
        -O2
        --no-entry
        -sSTANDALONE_WASM
        -sALLOW_MEMORY_GROWTH
        -sFILESYSTEM=0
        -sEXPORTED_FUNCTIONS=_bt_alloc,_bt_free,_bt_create,_bt_destroy,_bt_append,_bt_command,_bt_render,_bt_snapshot,_bt_snapshot_count,_bt_snapshot_index,_bt_snapshot_playing,_bt_snapshot_position,_bt_snapshot_duration,_bt_snapshot_released_count,_bt_snapshot_released_id
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
            EDITOR_WANTS_KEYBOARD_FOCUS FALSE
            COPY_PLUGIN_AFTER_BUILD FALSE
            NEEDS_WEB_BROWSER FALSE
            NEEDS_CURL FALSE
            VST3_CATEGORIES Instrument Synth
        )
        target_sources(Beatality
            PRIVATE
                hosts/plugin/PluginProcessor.cpp
                hosts/plugin/PluginEditor.cpp
        )
        target_compile_definitions(Beatality
            PUBLIC
                JUCE_WEB_BROWSER=0
                JUCE_USE_CURL=0
                JUCE_VST3_CAN_REPLACE_VST2=0
                JUCE_USE_MP3AUDIOFORMAT=1
        )
        target_link_libraries(Beatality
            PRIVATE
                beatality_engine
                juce::juce_audio_utils
                juce::juce_audio_formats
            PUBLIC
                juce::juce_recommended_config_flags
                juce::juce_recommended_warning_flags
        )
    else()
        message(STATUS "JUCE not found at third_party/JUCE; the plugin target was skipped")
    endif()
endif()
