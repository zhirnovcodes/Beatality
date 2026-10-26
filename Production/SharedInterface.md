# Shared interface

One design for the web widget and the VST window. The design program is [GrapesJS](https://grapesjs.com/) (BSD-3-Clause). You design a web page there. The widget loads that page. The plugin loads a copy of the same page with a few host elements changed, inside a JUCE web view.

The layout is drawn once. The VST page is that page with the host elements replaced.

## The two pages

| File | Who loads it | What it contains |
| --- | --- | --- |
| `assets/ui/shared.html` plus `assets/ui/skin.css` | Neither host directly | The skin: sample strip, rows, columns, sliders, text fields, buttons |
| `assets/ui/web.html` | The web widget | The shared page, with the web host elements filled in |
| `assets/ui/vst.html` | The plugin window | The shared page, with the VST host elements filled in |

`web.html` and `vst.html` do not repeat the skin. Each one includes `shared.html` and supplies its own tags for the host elements below.

GrapesJS is the only editor. There is no second design pass in JUCE. `hosts/plugin/PluginEditor.cpp` becomes the window that shows `vst.html`. The native file dialog stays in C++.

## Elements you place

Every control is its own element on the GrapesJS canvas. Register these as component types, then drag them from the block list.

Shared, same markup on both pages:

| Type | What it is | Binding |
| --- | --- | --- |
| `column`, `row` | Vertical and horizontal groups. Children are nested elements. | none |
| `placeholder` | An empty framed slot. Replace it with a real control without moving its parent. | none |
| `sample-buffer` | The strip from `views/web/SampleBufferView.ts`. In the editor it is a labelled box 640×80. | the track view |
| `slider` | Track, fill, and thumb. | one number: `attack` |
| `text` | A text field. | `bpm`, `loop`, or `slice` |
| `button` | A labelled button. | `randomize` |

Host elements. These are the only ones that differ:

| Type | Web page | VST page |
| --- | --- | --- |
| `host-append` | The file input. WAV and MP3, several files. | A button. The click asks C++ to open the file dialog already in `PluginEditor::chooseFiles`. |
| `host-play` | Play / Stop. | Leave it out. In 0.0.1 a MIDI note is the gate, so the plugin window has no transport button. |
| `host-remove` | Leave it out. The widget has no Remove control. | A button. Removes the sample at index 0, which is what `Processor::removeFirstTrack` does. |
| `host-pack` | The Demo pack Load button from `apps/web-widget/index.html`. | Leave it out. |

BPM, loop, slice, and attack live on the shared page because the web widget already edits them through `WebViewModel`. On the VST page, hide that group. The 0.0.1 plugin does not have those actions. Put the group back when the plugin runs the slice engine.

An element writes a binding name. It does not call the engine. The web presenter and the plugin bridge already own that step.

## What you are not copying

Copy the host elements only.

- The sample strip, the groups, the skin, and Randomize stay in `shared.html`.
- A slider moved in GrapesJS is moved for both pages.
- JUCE sliders, labels, and the list box in `PluginEditor` are not redrawn to match the page. The web view replaces that layout. The list of names can stay a `sample-buffer` or a later custom element, fed by `Processor::trackName`.

## Start the design program

The repo is already a pnpm workspace (`pnpm-workspace.yaml` includes `apps/*`). Add the editor as another app.

1. Create `apps/ui-editor` with its own `package.json`:

   ```json
   {
     "name": "@beatality/ui-editor",
     "private": true,
     "version": "0.0.0",
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "vite build"
     },
     "dependencies": {
       "grapesjs": "^0.22.5"
     },
     "devDependencies": {
       "vite": "^8.3.4"
     }
   }
   ```

   Use the open-source `grapesjs` package. The GrapesJS Studio SDK is a separate product.

2. From the repo root:

   ```powershell
   pnpm install
   pnpm --filter @beatality/ui-editor dev
   ```

3. Open the Vite URL. The page is a full-window editor:

   ```ts
   import grapesjs from 'grapesjs'
   import 'grapesjs/dist/css/grapes.min.css'

   const editor = grapesjs.init({
     container: '#gjs',
     height: '100%',
     storageManager: false,
     canvas: {
       styles: ['/skin.css'],
     },
   })
   ```

   Give the stage a plugin frame of 640px wide. That is `SampleBufferView.pluginWidth`. Store positions in those pixels.

4. Register each type from the tables above before loading a saved page. A type sets its tag, its class, and the inspector fields. Example for a slider:

   ```ts
   editor.DomComponents.addType('slider', {
     model: {
       defaults: {
         tagName: 'div',
         attributes: { class: 'slider' },
         traits: [
           { type: 'text', name: 'bind', label: 'Binding' },
           { type: 'number', name: 'min', label: 'Min' },
           { type: 'number', name: 'max', label: 'Max' },
         ],
       },
     },
   })

   editor.BlockManager.add('slider', {
     label: 'Slider',
     content: { type: 'slider' },
   })
   ```

   Do the same for `column`, `row`, `placeholder`, `text`, `button`, `sample-buffer`, and the four `host-*` types. A `column` or `row` is droppable. A `placeholder` is a single empty child that a drop replaces.

5. Design `shared.html` first. Drop a `sample-buffer`, then a `row` of `host-append`, `button` (Randomize), and the number fields. Export with `editor.getHtml()` and `editor.getCss()` into `assets/ui/shared.html` and `assets/ui/skin.css`.

6. Make the two host pages from that export. Keep the shared markup. Fill or remove only the `host-*` tags, using the table above.

## Make the web view

The widget already has the behaviour. `apps/web-widget/src/main.tsx` builds `WebViewModel`, `EngineClient`, and `WebPresenter`. `Widget.tsx` is the hand-written layout this page replaces.

1. Keep `main.tsx` as the composition root. It still creates the model, the client, and the presenter.
2. Render `assets/ui/web.html` inside `#app`, with `skin.css`.
3. After the markup is in the page, connect each binding to the model:
   - `host-play` calls `model.playOrStop()`
   - `host-append` calls `model.append(files)`
   - `host-pack` keeps the Demo pack loader already in `main.tsx`
   - Randomize calls `model.randomize()`
   - `bpm`, `loop`, `slice`, and `attack` call `setBpm`, `setLoop`, `setSlice`, and `setAttack`
4. Mount the existing `SampleBufferView` into the `sample-buffer` element. The presenter already owns that strip. Pass it the same `bank` node `main.tsx` creates today.
5. Run the widget the way you already do, from `apps/web-widget`:

   ```powershell
   pnpm --filter @beatality/web-widget dev
   ```

Check Play, Append, Randomize, the four number fields, and the Demo pack. The strip should still follow the snapshot.

## Make the VST view

The plugin keeps the processor. The window stops laying out JUCE controls and shows `vst.html`.

1. Turn the browser on in `CMakeLists.txt`. The plugin target currently sets `NEEDS_WEB_BROWSER FALSE` and `JUCE_WEB_BROWSER=0`. Both become enabled. Leave `JUCE_USE_CURL` off.
2. On Windows the view is WebView2. Install the WebView2 runtime if it is not already on the machine.
3. Pack `vst.html` and `skin.css` into the plugin and serve them from the editor with JUCE's resource provider, so the window does not need a dev server.
4. Replace the body of `Editor` with a `juce::WebBrowserComponent` that loads `vst.html`. The title, list, and JUCE buttons go away. `chooseFiles()` stays.
5. Bridge the page to `Processor` with these calls, on the message thread:

   | Page action | Processor call |
   | --- | --- |
   | `host-append` clicked | `chooseFiles()`, then `appendFiles` |
   | `host-remove` clicked | `removeFirstTrack()` |
   | Randomize clicked | `randomizeTracks()` |

6. Push `trackName`, `chosenIndex`, `numTracks`, and `errorText` back into the page about 30 times a second, which is what `Editor::timerCallback` already does. The page writes those into the sample strip and the error line.
7. Build the plugin the way you already build the VST3 target (the non-Emscripten configure). Open the standalone or the VST3 and confirm Append still uses the native dialog, Remove clears the first sample, and Randomize still reaches the processor.

The web widget and this window can be open at the same time. They do not share audio. They share the skin files.
