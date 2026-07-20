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

// ---- Access gate ----
//
// The access code is verified server-side by /api/unlock (see api/unlock.js),
// so the code itself is never shipped to the browser. This localStorage flag
// only remembers that this browser already unlocked, to skip the paywall on
// return visits.
const UNLOCK_KEY = "cathra_unlocked";

const landing = document.getElementById("landing");
const paywall = document.getElementById("paywall");
const tool = document.getElementById("tool");
const btnOpen = document.getElementById("btn-open");
const homeLink = document.getElementById("home-link");
const paywallBack = document.getElementById("paywall-back");
const btnPay = document.getElementById("btn-pay");
const payContact = document.getElementById("pay-contact");
const accessInput = document.getElementById("access-code");
const btnUnlock = document.getElementById("btn-unlock");
const unlockError = document.getElementById("unlock-error");

function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; }
}
function rememberUnlocked() {
  try { localStorage.setItem(UNLOCK_KEY, "1"); } catch (e) { /* ignore */ }
}

function showScreen(el) {
  [landing, paywall, tool].forEach((s) => { s.hidden = s !== el; });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openTool() {
  showScreen(tool);
  resetToUpload();
}
function goHome() {
  showScreen(landing);
}

// "Open the tool": paid/unlocked users skip straight in, otherwise show paywall.
btnOpen.addEventListener("click", () => {
  if (isUnlocked()) {
    openTool();
  } else {
    unlockError.hidden = true;
    accessInput.value = "";
    payContact.hidden = true;
    showScreen(paywall);
  }
});

homeLink.addEventListener("click", (e) => { e.preventDefault(); goHome(); });
paywallBack.addEventListener("click", goHome);

// Reveal the contact-to-pay details.
btnPay.addEventListener("click", () => {
  payContact.hidden = false;
  payContact.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

// Unlock with the access code — verified server-side.
function showUnlockError(msg) {
  unlockError.textContent = msg || "That code isn’t valid. Please check and try again.";
  unlockError.hidden = false;
  accessInput.focus();
  accessInput.select();
}

async function tryUnlock() {
  const code = accessInput.value.trim();
  if (!code) { showUnlockError(); return; }

  const original = btnUnlock.textContent;
  btnUnlock.disabled = true;
  btnUnlock.textContent = "Checking…";
  unlockError.hidden = true;

  try {
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      rememberUnlocked();
      unlockError.hidden = true;
      openTool();
    } else {
      showUnlockError();
    }
  } catch (e) {
    showUnlockError("Couldn’t reach the server. Please try again.");
  } finally {
    btnUnlock.disabled = false;
    btnUnlock.textContent = original;
  }
}
btnUnlock.addEventListener("click", tryUnlock);
accessInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });

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

// ---- View switching ----
function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
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
  previewImg.src = currentObjectUrl;
  showView("preview");
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
    loadingText.textContent = "Analyzing image…";

    // Ensure the preview image is fully decoded before predicting.
    if (!previewImg.complete || previewImg.naturalWidth === 0) {
      await new Promise((resolve, reject) => {
        previewImg.onload = resolve;
        previewImg.onerror = () => reject(new Error("Could not read the image."));
      });
    }

    const predictions = await model.predict(previewImg);
    renderResults(predictions);
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

// ---- Reset flows ----
function resetToUpload() {
  clearError();
  fileInput.value = "";
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  previewImg.removeAttribute("src");
  document.getElementById("bar-normal").style.width = "0";
  document.getElementById("bar-abnormal").style.width = "0";
  showView("upload");
}

btnChange.addEventListener("click", resetToUpload);
btnAgain.addEventListener("click", resetToUpload);

// Initial state
showView("upload");
