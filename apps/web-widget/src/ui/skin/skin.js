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
  document.querySelectorAll(".beatality-skin .slider, .beatality-skin .seek, .beatality-skin .mix-slider").forEach(function (slider) {
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
