/*
 * Cathra AI — client-side ovarian ultrasound pattern research demo.
 *
 * Privacy: the selected image is loaded into an <img> element via an in-memory
 * object URL and passed straight to the model. It is never uploaded, fetched,
 * saved, transmitted, logged, or stored anywhere.
 *
 * The model is a Teachable Machine image model. The @teachablemachine/image
 * library reads /model/metadata.json and handles resizing + preprocessing
 * (input size and channel format) automatically, so this code does not need to
 * hardcode the input dimensions.
 */

// Each model version lives in its own folder because /model/ is cached for a
// year. To ship a new model, add it as /model/v2/ and change this line; never
// overwrite the files inside an existing version folder.
const MODEL_VERSION = "v1";
const MODEL_URL = `/model/${MODEL_VERSION}/model.json`;
const METADATA_URL = `/model/${MODEL_VERSION}/metadata.json`;

// Class index mapping (Teachable Machine returns predictions in training order).
// Index 0 = normal ovarian appearance, Index 1 = abnormal ovarian appearance.
const NORMAL_INDEX = 0;
const ABNORMAL_INDEX = 1;

// Uncertainty thresholds (tunable):
//  - if the top score is below this, or
//  - if the two scores are closer than this margin,
// we decline to assert a category.
const MIN_TOP_SCORE = 0.60;   // 60%
const MIN_MARGIN = 0.15;      // 15 percentage points

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

let model = null;
let currentObjectUrl = null;

// ---- Landing / tool navigation ----
const landing = document.getElementById("landing");
const tool = document.getElementById("tool");
const btnOpen = document.getElementById("btn-open");
const homeLink = document.getElementById("home-link");

function showScreen(el) {
  [landing, tool].forEach((s) => { s.hidden = s !== el; });
  window.scrollTo({ top: 0, behavior: "auto" });
}

const demoVideo = document.getElementById("demo-video");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The tool has its own address (/analyze) so it can be linked, bookmarked, and
// left with the browser's Back button. Vercel serves index.html for /analyze.
const TOOL_PATH = "/analyze";
const HOME_TITLE = document.title;
const TOOL_TITLE = "Analyze an image · Cathra";
const canonical = document.querySelector('link[rel="canonical"]');
const CANONICAL_ORIGIN = canonical ? new URL(canonical.href).origin : location.origin;

function setAddress(path, title) {
  document.title = title;
  if (canonical) canonical.href = CANONICAL_ORIGIN + path;
}

function openTool({ push = true } = {}) {
  showScreen(tool);
  resetToUpload();
  if (demoVideo) demoVideo.pause();
  if (push) history.pushState({ screen: "tool" }, "", TOOL_PATH);
  setAddress(TOOL_PATH, TOOL_TITLE);
}
function goHome({ push = true } = {}) {
  showScreen(landing);
  // Browsers don't resume a hidden autoplay video by themselves.
  if (demoVideo && !reduceMotion) demoVideo.play().catch(() => {});
  if (push) history.pushState({ screen: "home" }, "", "/");
  setAddress("/", HOME_TITLE);
}

// Back/forward buttons move between the homepage and the tool.
window.addEventListener("popstate", () => {
  if (location.pathname === TOOL_PATH) openTool({ push: false });
  else goHome({ push: false });
});

btnOpen.addEventListener("click", () => openTool());
homeLink.addEventListener("click", (e) => { e.preventDefault(); goHome(); });
// "Back to home" behaves like the browser's Back button when the user came from it.
document.getElementById("tool-back").addEventListener("click", () => {
  if (history.state && history.state.screen === "tool" && history.length > 1) history.back();
  else goHome();
});
// Links to /analyze on this page open the tool without a reload.
document.querySelectorAll(`a[href="${TOOL_PATH}"]`).forEach((a) =>
  a.addEventListener("click", (e) => { e.preventDefault(); if (location.pathname !== TOOL_PATH) openTool(); })
);

// ---- Element refs ----
const views = {
  upload: document.getElementById("view-upload"),
  preview: document.getElementById("view-preview"),
  loading: document.getElementById("view-loading"),
  results: document.getElementById("view-results"),
};
const fileInput = document.getElementById("file-input");
const dropzone = document.getElementById("dropzone");
const fileError = document.getElementById("file-error");
const previewImg = document.getElementById("preview-img");
const loadingText = document.getElementById("loading-text");
const btnAnalyze = document.getElementById("btn-analyze");
const btnChange = document.getElementById("btn-change");
const btnAgain = document.getElementById("btn-again");
const fileMeta = document.getElementById("file-meta");
const qualityNote = document.getElementById("quality-note");
const resultMeta = document.getElementById("result-meta");

// Images smaller than this on their short side get a low-resolution warning.
const MIN_GOOD_SIDE = 300;

// Keyboard access for the dropzone (it is a label, so it isn't focusable by default).
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

// ---- View switching ----
// Which progress step (1 Upload, 2 Confirm, 3 Results) each view belongs to.
const VIEW_STEP = { upload: 1, preview: 2, loading: 3, results: 3 };
const progressSteps = document.querySelectorAll(".progress-step");

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    const active = key === name;
    el.hidden = !active;
    // Restart the fade-in each time a view is shown.
    el.classList.remove("view-enter");
    if (active) {
      void el.offsetWidth;
      el.classList.add("view-enter");
    }
  });

  const current = VIEW_STEP[name];
  progressSteps.forEach((stepEl) => {
    const n = Number(stepEl.dataset.step);
    stepEl.classList.toggle("is-current", n === current);
    stepEl.classList.toggle("is-done", n < current);
    if (n === current) stepEl.setAttribute("aria-current", "step");
    else stepEl.removeAttribute("aria-current");
  });
}

function showError(msg) {
  fileError.textContent = msg;
  fileError.hidden = false;
}
function clearError() {
  fileError.hidden = true;
  fileError.textContent = "";
}

// ---- File handling ----
function handleFile(file) {
  clearError();
  if (!file) return;

  const typeOk =
    ACCEPTED_TYPES.includes(file.type) ||
    /\.(jpe?g|png)$/i.test(file.name || "");
  if (!typeOk) {
    showError("Please choose a JPG, JPEG, or PNG image.");
    return;
  }

  // Release any previous object URL before creating a new one.
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);

  fileMeta.textContent = file.name;
  qualityNote.hidden = true;
  previewImg.onload = () => {
    const w = previewImg.naturalWidth;
    const h = previewImg.naturalHeight;
    positionCropBox();
    fileMeta.textContent = `${file.name} · ${w} × ${h} px · ${formatSize(file.size)}`;
    const notes = [];
    if (looksLikeColorPhoto(previewImg)) {
      notes.push("This looks like a color photo, not an ultrasound. Cathra only compares ovarian ultrasound patterns, so scores for other images are meaningless.");
    }
    if (Math.min(w, h) < MIN_GOOD_SIDE) {
      notes.push(`This image is small (${w} × ${h} px). Low-resolution images can make the scores less reliable.`);
    }
    qualityNote.textContent = notes.join(" ");
    qualityNote.hidden = notes.length === 0;
  };
  previewImg.src = currentObjectUrl;
  showView("preview");
}

// The model only sees the image's center square. Outline that region on the
// preview (accounting for object-fit: contain letterboxing).
const cropBox = document.getElementById("crop-box");
function positionCropBox() {
  const nw = previewImg.naturalWidth, nh = previewImg.naturalHeight;
  const bw = previewImg.clientWidth, bh = previewImg.clientHeight;
  if (!nw || !nh || !bw || !bh) { cropBox.hidden = true; return; }
  const scale = Math.min(bw / nw, bh / nh);
  const side = Math.min(nw, nh) * scale;
  cropBox.style.width = cropBox.style.height = `${side}px`;
  cropBox.style.left = `${(bw - side) / 2}px`;
  cropBox.style.top = `${(bh - side) / 2}px`;
  // Only worth showing when part of the image is actually left out.
  cropBox.hidden = Math.abs(nw - nh) / Math.max(nw, nh) < 0.02;
}
window.addEventListener("resize", () => { if (!views.preview.hidden) positionCropBox(); });

// Ultrasound images are almost entirely grayscale; Doppler overlays add only small
// patches of color, and some machines tint the whole image one hue (sepia, blue).
// Flag only images where many pixels are clearly colored across several hues.
function looksLikeColorPhoto(img) {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const total = size * size;
  const hueBuckets = new Array(6).fill(0);
  let colored = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max <= 40 || (max - min) / max <= 0.25) continue;
    colored++;
    const d = max - min;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    if (h < 0) h += 6;
    hueBuckets[Math.floor(h) % 6]++;
  }
  const distinctHues = hueBuckets.filter((n) => n / total > 0.05).length;
  return colored / total > 0.25 && distinctHues >= 2;
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

fileInput.addEventListener("change", (e) => {
  handleFile(e.target.files && e.target.files[0]);
});

// Drag & drop
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
});

// The Teachable Machine library sizes its input from the element's .width/.height,
// which for an <img> is its on-screen box, not its pixels. Passing a canvas at the
// image's natural size keeps the aspect ratio true no matter how the preview is styled.
function naturalSizeCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

// ---- Model loading (lazy, on first analyze) ----
// One shared load. It starts in the background once the page is idle, so the
// first analysis usually doesn't wait; if it fails, the next call retries.
let modelPromise = null;
function ensureModel() {
  if (!modelPromise) {
    modelPromise = tmImage.load(MODEL_URL, METADATA_URL)
      .then(async (m) => {
        // The first prediction compiles the GPU shaders (several seconds); do it
        // once on a blank image now so the user's first real analysis is fast.
        const warm = document.createElement("canvas");
        warm.width = warm.height = 224;
        await m.predict(warm);
        return (model = m);
      })
      .catch((err) => { modelPromise = null; throw err; });
  }
  return modelPromise;
}

function preloadModel() {
  const saveData = navigator.connection && navigator.connection.saveData;
  if (saveData) return; // respect data-saver; load on first analysis instead
  const start = () => ensureModel().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1500);
}
if (document.readyState === "complete") preloadModel();
else window.addEventListener("load", preloadModel);

// ---- Analyze ----
btnAnalyze.addEventListener("click", async () => {
  showView("loading");
  try {
    if (!model) loadingText.textContent = "Loading model…";
    await ensureModel();
    loadingText.textContent = "Preparing image…";

    // Ensure the preview image is fully decoded before predicting.
    if (!previewImg.complete || previewImg.naturalWidth === 0) {
      await new Promise((resolve, reject) => {
        previewImg.addEventListener("load", resolve, { once: true });
        previewImg.addEventListener("error", () => reject(new Error("Could not read the image.")), { once: true });
      });
    }

    loadingText.textContent = "Comparing patterns…";
    const started = performance.now();
    const predictions = await model.predict(naturalSizeCanvas(previewImg));
    const elapsed = performance.now() - started;
    renderResults(predictions);
    renderResultMeta(elapsed);
    showView("results");
  } catch (err) {
    console.error(err);
    showView("preview");
    showError(
      "Something went wrong while analyzing the image. Please try again or use a different image."
    );
  }
});

// ---- Results ----
function renderResults(predictions) {
  // predictions: [{ className, probability }, ...] in training order.
  const normal = predictions[NORMAL_INDEX] ? predictions[NORMAL_INDEX].probability : 0;
  const abnormal = predictions[ABNORMAL_INDEX] ? predictions[ABNORMAL_INDEX].probability : 0;

  const normalPct = Math.round(normal * 100);
  const abnormalPct = Math.round(abnormal * 100);

  // Keep the analyzed image visible beside its scores (same in-memory URL).
  document.getElementById("result-img").src = currentObjectUrl;

  document.getElementById("score-normal-val").textContent = normalPct + "%";
  document.getElementById("score-abnormal-val").textContent = abnormalPct + "%";

  // Animate bars on next frame so the transition plays.
  requestAnimationFrame(() => {
    document.getElementById("bar-normal").style.width = normalPct + "%";
    document.getElementById("bar-abnormal").style.width = abnormalPct + "%";
  });

  const top = Math.max(normal, abnormal);
  const margin = Math.abs(normal - abnormal);
  const uncertain = top < MIN_TOP_SCORE || margin < MIN_MARGIN;

  const verdict = document.getElementById("verdict");
  const verdictLabel = document.getElementById("verdict-label");
  const verdictTag = verdict.querySelector(".verdict-tag");
  verdict.classList.remove("is-normal", "is-abnormal", "is-uncertain");

  if (uncertain) {
    verdictLabel.textContent = "Unable to assess confidently";
    verdictTag.textContent = "Scores are close or low";
    verdictTag.hidden = false;
    verdict.classList.add("is-uncertain");
  } else if (normal >= abnormal) {
    verdictLabel.textContent = "Normal-pattern similarity";
    verdictTag.hidden = true;
    verdict.classList.add("is-normal");
  } else {
    verdictLabel.textContent = "Abnormal-pattern similarity";
    verdictTag.hidden = true;
    verdict.classList.add("is-abnormal");
  }
}

// A short record of how this result was produced.
function renderResultMeta(elapsedMs) {
  const took = elapsedMs < 1000
    ? `${Math.max(1, Math.round(elapsedMs))} ms`
    : `${(elapsedMs / 1000).toFixed(1)} s`;
  const parts = [`Analyzed on this device in ${took}`];
  const trained = model && model.getMetadata && model.getMetadata().timeStamp;
  if (trained) {
    const d = new Date(trained);
    if (!isNaN(d)) {
      parts.push(`Model trained ${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`);
    }
  }
  parts.push(new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  resultMeta.textContent = parts.join(" · ");
}

// ---- Reset flows ----
function resetToUpload() {
  clearError();
  fileInput.value = "";
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  previewImg.removeAttribute("src");
  document.getElementById("result-img").removeAttribute("src");
  fileMeta.textContent = "";
  qualityNote.hidden = true;
  cropBox.hidden = true;
  resultMeta.textContent = "";
  document.getElementById("bar-normal").style.width = "0";
  document.getElementById("bar-abnormal").style.width = "0";
  showView("upload");
}

btnChange.addEventListener("click", resetToUpload);
btnAgain.addEventListener("click", resetToUpload);

// Respect reduced-motion: don't autoplay the homepage demo, show controls instead.
if (demoVideo && reduceMotion) {
  demoVideo.removeAttribute("autoplay");
  demoVideo.pause();
  demoVideo.controls = true;
}

// ---- Save as PDF ----
// Printing uses the print stylesheet (results only, full disclaimer, no buttons).
const disclaimer = document.querySelector("details.disclaimer");
let disclaimerWasOpen = false;
window.addEventListener("beforeprint", () => {
  disclaimerWasOpen = disclaimer.open;
  disclaimer.open = true;
  document.getElementById("print-url").textContent = location.origin + TOOL_PATH;
});
window.addEventListener("afterprint", () => { disclaimer.open = disclaimerWasOpen; });
document.getElementById("btn-print").addEventListener("click", () => window.print());

// Initial state
showView("upload");
if (location.pathname === TOOL_PATH) {
  history.replaceState({ screen: "tool" }, "", TOOL_PATH);
  openTool({ push: false });
} else {
  history.replaceState({ screen: "home" }, "", location.pathname + location.search);
}
