# Main thread and audio thread

The page and the sound run on two threads. They share no memory. A message port is the only connection.

The main thread is the page: Preact, the presenter, and `EngineClient.ts`. It decodes files, keeps the track names, and sends commands.

The audio thread is an AudioWorklet. `processor.ts` lives there, and so does the WebAssembly module. The browser calls `process` on every block. That call renders the next stereo block and returns before the deadline.

Emscripten builds the slice engine as a standalone `.wasm` file. There is no Emscripten JavaScript glue. The worklet instantiates the module itself and calls a plain C API (`bt_create`, `bt_append`, `bt_command`, `bt_remove`, `bt_set_bpm`, `bt_set_loop`, `bt_set_slice`, `bt_render`, `bt_snapshot`).

## Pipeline

1. A click resumes the `AudioContext`. The browser will not start audio without that gesture.
2. The page fetches `beatality.wasm` and loads the worklet script.
3. It creates an `AudioWorkletNode` with no input and one stereo output, and connects that node to the speakers. A live input would be mixed back in by the browser.
4. It posts `init` with the wasm bytes and a random seed. The bytes are transferred, so the page no longer holds them.
5. The worklet instantiates the module, calls `bt_create(sampleRate, seed)`, and replies `ready`. Messages that arrived early wait in a queue until then.
6. On each block, `bt_render` writes the left channel and then the right channel into wasm memory. The worklet copies those floats into the output the browser plays. Non-finite samples are replaced with silence.
7. About 30 times a second it posts a snapshot: how many tracks, whether it is playing, the effective slice, the loop, the tempo, released buffer ids, and the peak of that block.
8. Play, Stop, and Randomize are a single integer. Remove sends the row index. BPM, loop size, and slice exponent are their own messages. The worklet calls the matching export and posts a snapshot straight away.

Append takes a longer path. The page decodes WAV or MP3 with `decodeAudioData`, packs the file as planar stereo (all left samples, then all right samples), and transfers that array. The worklet copies it into wasm memory and calls `bt_append`. File names never cross the port. The page keeps them in `TrackRegistry` and fills them in when a snapshot arrives. The list on screen updates before the audio thread has answered, so the chosen index stays unknown until that answer.

Command numbers and message shapes are written twice, in `messages.ts` and at the top of `processor.ts`. The worklet is served as one script and cannot import the page module.

## Memory

Three heaps:

| Heap | Where | What lives there |
| --- | --- | --- |
| Page JavaScript | Main thread | File bytes, the decoded buffer, track names, the UI |
| Worklet JavaScript | Audio thread | The processor, a map from track id to wasm pointer, cached views of wasm memory |
| Wasm linear memory | Audio thread | The engine, the sample audio, the render buffers |

Wasm memory is one growable heap (`ALLOW_MEMORY_GROWTH`). `bt_alloc` and `bt_free` are `malloc` and `free` inside it. The page never sees a pointer. It only sees track ids and snapshots.

A sample moves like this:

1. The page builds a `Float32Array` and transfers its buffer. That is a move, not a copy. The page must not touch the array afterwards.
2. The worklet allocates the same number of bytes in wasm memory and copies the floats in. The transferred array can be collected after that copy. The engine reads only the wasm copy.
3. `bt_append` stores the pointer and the id. The core does not own the bytes. If the append is rejected, the worklet frees the allocation immediately.
4. On success the worklet records `id → pointer`. Ids start at 1 and are never reused, so a late free cannot hit a newer buffer.
5. Remove at an index drops that buffer from the bank, but a voice may still be fading it out. The engine keeps the id until the fade has finished, then lists it on the next snapshot as released.
6. The worklet calls `bt_free` for those ids. Freeing earlier would let the fade read freed memory.

Render scratch is also wasm memory: one left buffer and one right buffer, sized to the block (usually 128 frames). They grow if a later block is larger. The `Float32Array` views over them are kept and reused. A new view every block would allocate on the audio thread; the garbage collector would then pause that thread and the browser would repeat a short buffer, which is heard as a steady beep. The views are rebuilt only when wasm memory grows and the underlying buffer moves, or when the pointer or length changes. `emscripten_notify_memory_growth` is imported as an empty function so that growth has somewhere to call.
