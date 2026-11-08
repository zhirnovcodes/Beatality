/* Beatality skin: custom scroll bar for the sample list screen.
   The viewport scrolls natively (wheel, touch, keyboard); the thumb follows it,
   and dragging the thumb, clicking the track or the arrows scrolls the viewport. */
(function () {
  const STEP = 16;            // px per arrow click
  const REPEAT_DELAY = 300;   // ms before an arrow held down starts repeating
  const REPEAT_EVERY = 50;

  document.querySelectorAll(".beatality-skin [data-scroll]").forEach(function (bar) {
    const viewport = document.getElementById(bar.dataset.scroll);
    const thumb = bar.querySelector(".thumb");
    const part = bar.closest(".part");
    const up = part.querySelector(".scroll-arrow.up");
    const down = part.querySelector(".scroll-arrow.down");

    const travel = () => bar.clientHeight - thumb.offsetHeight;
    const maxScroll = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);

    function sync() {
      const max = maxScroll();
      thumb.style.top = (max ? viewport.scrollTop / max : 0) * travel() + "px";
    }
    viewport.addEventListener("scroll", sync, { passive: true });
    new ResizeObserver(sync).observe(viewport);
    sync();

    // drag the thumb
    let startY = 0, startTop = 0;
    thumb.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      thumb.classList.add("dragging");
      startY = e.clientY; startTop = viewport.scrollTop;
    });
    thumb.addEventListener("pointermove", function (e) {
      if (!thumb.hasPointerCapture(e.pointerId)) return;
      const t = travel();
      viewport.scrollTop = startTop + (e.clientY - startY) * (t ? maxScroll() / t : 0);
    });
    const endDrag = () => thumb.classList.remove("dragging");
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);

    // click the track: page towards the click
    bar.addEventListener("pointerdown", function (e) {
      if (e.target !== bar) return;
      const above = e.clientY < thumb.getBoundingClientRect().top;
      viewport.scrollBy({ top: (above ? -1 : 1) * viewport.clientHeight, behavior: "smooth" });
    });

    // wheel over the scroll bar scrolls the list too
    bar.addEventListener("wheel", function (e) {
      e.preventDefault(); viewport.scrollTop += e.deltaY;
    }, { passive: false });

    // arrows: one step per click, repeat while held
    [[up, -STEP], [down, STEP]].forEach(function ([btn, dy]) {
      if (!btn) return;
      let delay = 0, timer = 0;
      const stop = () => { clearTimeout(delay); clearInterval(timer); };
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        viewport.scrollTop += dy;
        delay = setTimeout(() => { timer = setInterval(() => { viewport.scrollTop += dy; }, REPEAT_EVERY); }, REPEAT_DELAY);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
    });
  });
})();

/* Sliders: thumb, lit ticks and caption follow the range input. */
(function () {
  const SLICE = { "-4": "1/16", "-3": "1/8", "-2": "1/4", "-1": "1/2", "0": "1", "1": "2", "2": "4", "3": "8", "4": "16" };
  document.querySelectorAll(".beatality-skin .slider, .beatality-skin .seek, .beatality-skin .mix-slider, .beatality-skin .br-slider, .beatality-skin .chaos-slider, .beatality-skin .chaos-small").forEach(function (slider) {
    const input = slider.querySelector('input[type="range"]');
    const value = document.querySelector('.beatality-skin .slider-captions [data-for="' + input.id + '"] .value');
    function sync() {
      const min = +input.min, max = +input.max;
      slider.style.setProperty("--pos", max > min ? (input.value - min) / (max - min) : 0);
      if (value) value.textContent = input.id === "slice" ? SLICE[input.value] : input.value;
    }
    input.addEventListener("input", sync);
    sync();
  });
})();

/* Sample buffer grid: rows x columns; columns = Loop beats / Slice length. Click a row to select it.
   Demo: row 1 selected, slice 2 of row 0 playing. The engine will put a spectrum image into each row's .spectrum. */
(function () {
  const grid = document.getElementById("sample-grid");
  if (!grid) return;
  const loop = document.getElementById("loop"), slice = document.getElementById("slice");
  const rows = +grid.dataset.rows || 0;
  let selected = 1, playing = { row: 0, col: 1 };

  function columns() {
    const beats = +loop.value, sliceBeats = Math.pow(2, +slice.value);
    return Math.max(1, Math.round(beats / sliceBeats));
  }
  function build() {
    const cols = columns();
    grid.textContent = "";
    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.className = "row"; row.setAttribute("role", "option");
      row.setAttribute("aria-selected", r === selected ? "true" : "false");
      const spec = document.createElement("div"); spec.className = "spectrum"; row.appendChild(spec);
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.className = "cell" + (r === playing.row && c === playing.col ? " playing" : "");
        row.appendChild(cell);
      }
      row.addEventListener("click", function () { selected = r; build(); });
      grid.appendChild(row);
    }
  }
  loop.addEventListener("input", build);
  slice.addEventListener("input", build);
  build();
})();

/* Selected-sample panel:
   - Volume 0..1.2 snaps to 1, Pan -1..1 snaps to 0 (within 4 % of the range); the --snap mark shows where.
   - Start time field (seconds) follows the Start slider: seconds = start x max; max comes from the engine
     (data-max on the field; 10 s for now). Typing a value moves the slider. */
(function () {
  document.querySelectorAll('.beatality-skin input[type="range"][data-snap]').forEach(function (input) {
    const snapValue = +input.dataset.snap, min = +input.min, max = +input.max;   // data-snap = the value to snap to
    const slider = input.parentElement;
    slider.style.setProperty("--snap", (snapValue - min) / (max - min));
    input.addEventListener("input", function () {
      if (Math.abs(+input.value - snapValue) <= (max - min) * 0.04) {
        input.value = snapValue;
        slider.style.setProperty("--pos", (snapValue - min) / (max - min));
      }
    });
  });

  const start = document.getElementById("start"), field = document.getElementById("start-time");
  if (!start || !field) return;
  const maxSec = () => +field.dataset.max || 10;
  const show = () => { field.value = (+start.value * maxSec()).toFixed(2); };
  start.addEventListener("input", show);
  field.addEventListener("change", function () {
    const sec = Math.min(Math.max(parseFloat(field.value.replace(",", ".")) || 0, 0), maxSec());
    start.value = sec / maxSec();
    start.dispatchEvent(new Event("input"));
  });
  field.addEventListener("keydown", function (e) { if (e.key === "Enter") field.blur(); });
  show();
})();

/* Bank picker: LOAD opens it on top of the normal view, X closes it.
   While open the round buttons are greyed. SELECT closes it too (the host will load the selected bank).
   LOAD FILE can be greyed: set #bank-load-file.disabled = true. */
(function () {
  const skin = document.querySelector(".beatality-skin");
  const list = document.getElementById("bank-list");
  const viewport = document.getElementById("sample-viewport");
  if (!skin || !list) return;
  const BANKS = ["Demo. 115 BPM", "Voice chops 130 bpm", "DNB drums 180 bpm", "Lo-fi keys 85 bpm", "House loops 124 bpm",
                 "Breakbeats 170 bpm", "Trap hats 140 bpm", "Dub stabs 75 bpm", "Techno perc 132 bpm", "Funk guitar 105 bpm"];
  let selected = 1;
  function render() {
    list.textContent = "";
    BANKS.forEach(function (name, i) {
      const li = document.createElement("li");
      li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === selected ? "true" : "false");
      li.textContent = (i + 1) + ". " + name;
      li.addEventListener("click", function () { selected = i; render(); });
      list.appendChild(li);
    });
  }
  const roundButtons = () => skin.querySelectorAll(".round-btn");
  function open() {
    skin.classList.add("picking-bank");
    roundButtons().forEach(function (b) { b.disabled = true; });
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event("scroll"));
  }
  function close() {
    skin.classList.remove("picking-bank");
    roundButtons().forEach(function (b) { b.disabled = false; });
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event("scroll"));
  }
  render();
  document.getElementById("load-bank").addEventListener("click", open);
  document.getElementById("bank-close").addEventListener("click", close);
  document.getElementById("bank-select").addEventListener("click", close);
})();

/* Effects part: GLOBAL power / %, TIME (min / max), then power / % for each of 7 effects.
   - Each slider's handle and green fill follow its input (--pos 0..1).
   - TIME (#fx-time-min, #fx-time-max): each an index 0..5 into 1/16, 1/8, 1/4, 1/2, 1, 2 (beats), so they always snap to one of
     them. MIN cannot pass MAX: dragging one past the other pushes the other along. Values in beats on each input as
     data-beats; fxTimeBeats() returns [min, max].
   - EFFECTS (#fx-enable): on / off, state in aria-pressed, text EFFECTS ON / EFFECTS OFF, fires "change".
   - SHUFFLE (#fx-shuffle, was RANDOMIZE) sets every slider to a random value (TIME: random MIN and MAX, MIN <= MAX). */
(function () {
  const TIME = ["1/16", "1/8", "1/4", "1/2", "1", "2"];
  const BEATS = [0.0625, 0.125, 0.25, 0.5, 1, 2];
  const sliders = document.querySelectorAll(".beatality-skin .fx-slider:not(.time)");
  if (!sliders.length) return;
  function sync(slider) {
    const input = slider.querySelector('input[type="range"]');
    const min = +input.min, max = +input.max;
    slider.style.setProperty("--pos", max > min ? (input.value - min) / (max - min) : 0);
  }
  sliders.forEach(function (slider) {
    slider.querySelector('input[type="range"]').addEventListener("input", function () { sync(slider); });
    sync(slider);
  });

  const time = document.querySelector(".beatality-skin .fx-slider.time");
  const lo = document.getElementById("fx-time-min"), hi = document.getElementById("fx-time-max");
  function syncTime(moved) {
    if (+lo.value > +hi.value) { if (moved === lo) hi.value = lo.value; else lo.value = hi.value; }
    time.style.setProperty("--lo", lo.value / 5);
    time.style.setProperty("--hi", hi.value / 5);
    [lo, hi].forEach(function (i) { i.dataset.beats = BEATS[+i.value]; i.setAttribute("aria-valuetext", TIME[+i.value] + " beat"); });
  }
  if (time) {
    lo.addEventListener("input", function () { syncTime(lo); });
    hi.addEventListener("input", function () { syncTime(hi); });
    syncTime(null);
  }
  window.fxTimeBeats = () => [BEATS[+lo.value], BEATS[+hi.value]];

  const enable = document.getElementById("fx-enable");
  if (enable) enable.addEventListener("click", function () {
    const on = enable.getAttribute("aria-pressed") !== "true";
    enable.setAttribute("aria-pressed", on ? "true" : "false");
    enable.textContent = on ? "EFFECTS ON" : "EFFECTS OFF";
    enable.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const btn = document.getElementById("fx-shuffle");
  const rnd = (input) => { const min = +input.min, max = +input.max, step = +input.step || 1;
                           return min + Math.round(Math.random() * (max - min) / step) * step; };
  if (btn) btn.addEventListener("click", function () {
    sliders.forEach(function (slider) {
      const input = slider.querySelector('input[type="range"]');
      input.value = rnd(input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (time) {
      const a = rnd(lo), b = rnd(hi);
      lo.value = Math.min(a, b); hi.value = Math.max(a, b); syncTime(null);
      [lo, hi].forEach(function (i) { i.dispatchEvent(new Event("change", { bubbles: true })); });
    }
  });
})();

/* Selected sample: BPM field, WARP and BEAT.
   - BPM (#track-bpm): the sample's own tempo, one decimal, 20 .. 999 (data-min / data-max); Enter or leaving the field applies it.
   - WARP (#track-warp): none / beat / pitch / grain; the arrows step through them (wrapping). Value in data-value, "change" fired on it.
   - BEAT (#track-beat): index 0..6 into 1/32, 1/16, 1/8, 1/4, 1/2, 1, 2 (beats), so it always snaps to one of them;
     the caption shows the value; the value in beats is on the input as data-beats. */
(function () {
  const bpm = document.getElementById("track-bpm");
  if (bpm) {
    const fix = function () {
      const v = parseFloat(bpm.value.replace(",", "."));
      const min = +bpm.dataset.min || 20, max = +bpm.dataset.max || 999;
      bpm.value = (isNaN(v) ? 100 : Math.min(Math.max(v, min), max)).toFixed(1);
    };
    bpm.addEventListener("change", fix);
    bpm.addEventListener("keydown", function (e) { if (e.key === "Enter") bpm.blur(); });
    fix();
  }

  const WARP = ["none", "beat", "pitch", "grain"];
  const warp = document.getElementById("track-warp");
  if (warp) {
    const set = function (i) {
      const v = WARP[(i + WARP.length) % WARP.length];
      warp.dataset.value = v; warp.textContent = v.toUpperCase();
      warp.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const at = () => WARP.indexOf(warp.dataset.value);
    document.getElementById("warp-prev").addEventListener("click", () => set(at() - 1));
    document.getElementById("warp-next").addEventListener("click", () => set(at() + 1));
  }

  const BEAT = ["1/32", "1/16", "1/8", "1/4", "1/2", "1", "2"];
  const BEATS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
  const beat = document.getElementById("track-beat");
  if (beat) {
    const caption = document.querySelector(".beatality-skin .sample-panel .name.beat .value");
    const show = function () {
      caption.textContent = BEAT[+beat.value];
      beat.dataset.beats = BEATS[+beat.value];
      beat.setAttribute("aria-valuetext", BEAT[+beat.value] + " beat");
    };
    beat.addEventListener("input", show);
    show();
  }
})();

/* Beat Repeat:
   - ON (#br-power): 3D button, toggles aria-pressed (pushed in = on); fires "change".
   - SIZE (#br-size-min, #br-size-max): index 0..6 into 1/32, 1/16, 1/8, 1/4, 1/2, 1, 2 (beats). MIN cannot pass MAX:
     dragging one past the other pushes the other along. Values in beats on each input as data-beats.
   - LENGTH (#br-length): index 0..5 into 1/16 .. 2 (beats), data-beats; the value shows above it (#br-length-value). MIX (#br-mix) and CHANCE (#br-chance): 0..1.
   - LOOP PARTS (#br-pos-1 .. #br-pos-8): numbered 3D buttons, checkboxes (checked = pushed in). */
(function () {
  const power = document.getElementById("br-power");
  if (!power) return;
  power.addEventListener("click", function () {
    const on = power.getAttribute("aria-pressed") !== "true";
    power.setAttribute("aria-pressed", on ? "true" : "false");
    power.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const SIZE = ["1/32", "1/16", "1/8", "1/4", "1/2", "1", "2"], SIZE_BEATS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
  const range = document.getElementById("br-size");
  const lo = document.getElementById("br-size-min"), hi = document.getElementById("br-size-max");
  function syncRange(moved) {
    if (+lo.value > +hi.value) { if (moved === lo) hi.value = lo.value; else lo.value = hi.value; }
    range.style.setProperty("--lo", lo.value / 6);
    range.style.setProperty("--hi", hi.value / 6);
    [lo, hi].forEach(function (i) { i.dataset.beats = SIZE_BEATS[+i.value]; i.setAttribute("aria-valuetext", SIZE[+i.value] + " beat"); });
    const sv = document.getElementById("br-size-value");                     // drawer caption: SIZE [min,max] (entries 98, 100)
    if (sv) sv.textContent = "[" + SIZE[+lo.value] + "," + SIZE[+hi.value] + "]";
  }
  lo.addEventListener("input", function () { syncRange(lo); });
  hi.addEventListener("input", function () { syncRange(hi); });
  syncRange(null);

  // PAN (#master-pan-min, #master-pan-max): each end -1..1, snaps to 0 within 4 % of the range. MIN cannot pass MAX.
  const pan = document.getElementById("master-pan");
  const panLo = document.getElementById("master-pan-min"), panHi = document.getElementById("master-pan-max");
  function syncPan(moved) {
    if (moved && Math.abs(+moved.value) <= 0.08) moved.value = 0;
    if (+panLo.value > +panHi.value) { if (moved === panLo) panHi.value = panLo.value; else panLo.value = panHi.value; }
    pan.style.setProperty("--lo", (+panLo.value + 1) / 2);
    pan.style.setProperty("--hi", (+panHi.value + 1) / 2);
  }
  if (pan) {
    panLo.addEventListener("input", function () { syncPan(panLo); });
    panHi.addEventListener("input", function () { syncPan(panHi); });
    syncPan(null);
  }

  const LENGTH = ["1/16", "1/8", "1/4", "1/2", "1", "2"], LENGTH_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
  const len = document.getElementById("br-length");
  const lenValue = document.getElementById("br-length-value");
  const showLen = function () {
    len.dataset.beats = LENGTH_BEATS[+len.value]; len.setAttribute("aria-valuetext", LENGTH[+len.value] + " beat");
    if (lenValue) { lenValue.textContent = LENGTH[+len.value]; lenValue.dataset.i = len.value; }
  };
  len.addEventListener("input", showLen); showLen();
})();

/* SYNC (#bpm-sync) and RETRIG (#retrig): on / off toggles; state in aria-pressed (pushed in when on), fire "change". */
(function () {
  ["bpm-sync", "retrig"].forEach(function (id) {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", function () {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
})();

/* Top toggles EFFECTS (#effects-toggle) and BEAT REPEAT (#beatrepeat-toggle): the same state as the part's own on / off
   button (data-for: #fx-enable, #br-power). Clicking one clicks that button (which fires "change"); either way both show the same state. */
(function () {
  document.querySelectorAll(".top-toggle[data-for]").forEach(function (t) {
    const target = document.getElementById(t.dataset.for);
    if (!target) return;
    const mirror = function () { t.setAttribute("aria-pressed", target.getAttribute("aria-pressed") === "true" ? "true" : "false"); };
    t.addEventListener("click", function () { target.click(); });
    new MutationObserver(mirror).observe(target, { attributes: true, attributeFilter: ["aria-pressed"] });
    mirror();
  });
})();

/* CHAOS:
   - #chaos-toggle (aria-pressed, off by default): chaos mode on / off. Fires "change".
   - Side panels: #chaos-amount 0..1 (star slider, no caption).
   - TRIGGER (#chaos-trigger, data-value): note, loop, slices, beat, none; the arrows step through them (wrapping).
     Its size slider shows only for loop / slices / beat, and the caption under TRIGGER shows its name and value:
     BEATS (1/4 .. 2) #chaos-beats, LOOPS (1 .. 8) #chaos-loops, SLICES (1/2 .. 4) #chaos-slices.
   - 11 toggles (checkboxes): #chaos-play-* (pan, slices, randomize), #chaos-br-* (power, positions, params),
     #chaos-fx-* (power, global, each), #chaos-value, #chaos-time. */
(function () {
  const toggle = document.getElementById("chaos-toggle"), left = document.getElementById("chaos-drawer");
  if (!toggle || !left) return;
  toggle.addEventListener("click", function () {
    toggle.setAttribute("aria-pressed", toggle.getAttribute("aria-pressed") === "true" ? "false" : "true");
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const TRIG = [["note", "NOTE"], ["loop", "LOOP"], ["slices", "SLICES"], ["beat", "BEAT"], ["none", "NONE"]];
  const VAL = {
    beat: { el: "chaos-beats", name: "BEATS", fmt: (v) => ["1/4", "1/2", "1", "2"][v] },
    loop: { el: "chaos-loops", name: "LOOPS", fmt: (v) => String(v) },
    slices: { el: "chaos-slices", name: "SLICES", fmt: (v) => ["1/2", "1", "2", "3", "4"][v] },
  };
  const trig = document.getElementById("chaos-trigger"), cap = document.getElementById("chaos-amount-cap");
  function show() {
    const t = trig.dataset.value, v = VAL[t];
    left.querySelectorAll(".chaos-small").forEach(function (s) { s.classList.toggle("on", s.dataset.trigger === t); });
    cap.style.visibility = v ? "visible" : "hidden";
    if (v) { const i = document.getElementById(v.el); cap.textContent = v.name + " (" + v.fmt(+i.value) + ")"; }
  }
  function step(d) {
    const k = TRIG.findIndex((x) => x[0] === trig.dataset.value);
    const n = TRIG[(k + d + TRIG.length) % TRIG.length];
    trig.dataset.value = n[0]; trig.textContent = n[1];
    show(); trig.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.getElementById("chaos-trigger-prev").addEventListener("click", function () { step(-1); });
  document.getElementById("chaos-trigger-next").addEventListener("click", function () { step(1); });
  Object.values(VAL).forEach(function (v) { document.getElementById(v.el).addEventListener("input", show); });
  show();
})();


/* CHAOS drawer (entries 94, 95): open while chaos mode is on. The drawer's CHAOS button and the CHAOS toggle on the top glass
   (#chaos-toggle) both switch it: the button clicks the toggle, and the drawer follows the toggle's aria-pressed.
   Closed by default. #chaos-drawer gets class "open"; the button's aria-expanded follows. Fires "toggle" on the drawer. */
(function () {
  const drawer = document.getElementById("chaos-drawer"), btn = document.getElementById("side-chaos"),
        toggle = document.getElementById("chaos-toggle");
  if (!drawer || !btn || !toggle) return;
  function sync() {
    const open = toggle.getAttribute("aria-pressed") === "true";
    if (open === drawer.classList.contains("open")) return;
    drawer.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    drawer.dispatchEvent(new Event("toggle"));
  }
  btn.addEventListener("click", function () { toggle.click(); });
  toggle.addEventListener("change", sync);
  sync();
})();

/* BEAT REPEAT drawer (entry 97, beside the effects part) and SAMPLE SETTINGS drawer (entry 102, beside the samples part):
   each drawer's own button slides it out and back. Closed by default. The drawer gets class "open"; the button's aria-expanded
   follows. Fires "toggle" on the drawer. */
(function () {
  [["br-drawer", "side-beatrepeat"], ["ss-drawer", "side-samples"]].forEach(function (ids) {
    const drawer = document.getElementById(ids[0]), btn = document.getElementById(ids[1]);
    if (!drawer || !btn) return;
    btn.addEventListener("click", function () {
      const open = !drawer.classList.contains("open");
      drawer.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      drawer.dispatchEvent(new Event("toggle"));
    });
  });
})();
