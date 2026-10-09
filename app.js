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

const MODEL_URL = "/model/model.json";
const METADATA_URL = "/model/metadata.json";

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

function openTool() {
  showScreen(tool);
  resetToUpload();
  if (demoVideo) demoVideo.pause();
}
function goHome() {
  showScreen(landing);
  // Browsers don't resume a hidden autoplay video by themselves.
  if (demoVideo && !reduceMotion) demoVideo.play().catch(() => {});
}

btnOpen.addEventListener("click", openTool);
homeLink.addEventListener("click", (e) => { e.preventDefault(); goHome(); });

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
    fileMeta.textContent = `${file.name} · ${w} × ${h} px · ${formatSize(file.size)}`;
    if (Math.min(w, h) < MIN_GOOD_SIDE) {
      qualityNote.textContent =
        `This image is small (${w} × ${h} px). Low-resolution images can make the scores less reliable.`;
      qualityNote.hidden = false;
    }
  };
  previewImg.src = currentObjectUrl;
  showView("preview");
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

// ---- Model loading (lazy, on first analyze) ----
async function ensureModel() {
  if (model) return model;
  loadingText.textContent = "Loading model…";
  model = await tmImage.load(MODEL_URL, METADATA_URL);
  return model;
}

// ---- Analyze ----
btnAnalyze.addEventListener("click", async () => {
  showView("loading");
  try {
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
    const predictions = await model.predict(previewImg);
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
    verdict.classList.add("is-uncertain");
  } else if (normal >= abnormal) {
    verdictLabel.textContent = "Normal-pattern similarity";
    verdictTag.textContent = "Higher similarity score";
    verdict.classList.add("is-normal");
  } else {
    verdictLabel.textContent = "Abnormal-pattern similarity";
    verdictTag.textContent = "Higher similarity score";
    verdict.classList.add("is-abnormal");
  }
}

// A short record of how this result was produced.
function renderResultMeta(elapsedMs) {
  const parts = [`Analyzed on this device in ${(elapsedMs / 1000).toFixed(1)} s`];
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

// Initial state
showView("upload");
