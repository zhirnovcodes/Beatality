cmake_minimum_required(VERSION 3.25)
project(Beatality VERSION 0.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(beatality_domain
    core/domain/Rng.cpp
    core/domain/Session.cpp
)
target_include_directories(beatality_domain PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/domain)
target_compile_options(beatality_domain PRIVATE -fno-exceptions -fno-rtti)

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
target_compile_options(beatality_engine PRIVATE -fno-exceptions -fno-rtti)

add_executable(domain_tests tests/domain/session_tests.cpp)
target_link_libraries(domain_tests PRIVATE beatality_domain)
target_compile_options(domain_tests PRIVATE -fno-exceptions -fno-rtti)

if(EMSCRIPTEN)
    # Standalone module for the AudioWorklet: instantiated directly, no Emscripten JS glue.
    add_executable(beatality hosts/web/boundary/engine_api.cpp)
    target_link_libraries(beatality PRIVATE beatality_engine)
    target_compile_options(beatality PRIVATE -fno-exceptions -fno-rtti)
    set_target_properties(beatality PROPERTIES SUFFIX ".wasm")
    target_link_options(beatality PRIVATE
        -O2
        --no-entry
        -sSTANDALONE_WASM
        -sALLOW_MEMORY_GROWTH
        -sFILESYSTEM=0
        -sEXPORTED_FUNCTIONS=_bt_alloc,_bt_free,_bt_create,_bt_destroy,_bt_append,_bt_command,_bt_render,_bt_snapshot,_bt_snapshot_count,_bt_snapshot_index,_bt_snapshot_playing,_bt_snapshot_position,_bt_snapshot_duration,_bt_snapshot_released_count,_bt_snapshot_released_id
    )
endif()
