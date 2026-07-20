# Cathra AI

A **research and educational demonstration** that compares an existing ovarian
ultrasound image against two learned appearance patterns (normal vs. abnormal)
using a Google Teachable Machine image model that runs **entirely in the
browser**.

> ⚠️ **Medical disclaimer**
> Research and educational demonstration only. This tool does not diagnose,
> detect, confirm, or rule out ovarian cancer or any other medical condition.
> Results must not be used for medical decisions. Ultrasound images must be
> reviewed by a qualified medical professional.

## Privacy

The uploaded image never leaves the user's device. It is loaded into an in-memory
object URL and passed directly to the model. It is **not** uploaded, saved,
transmitted, logged, or stored.

## Project structure

```
.
├── index.html        # UI (homepage, upload, preview, results, disclaimer)
├── styles.css        # Styling (white bg, purple/teal accents, rounded cards)
├── app.js            # File handling + TensorFlow.js / Teachable Machine logic
├── vercel.json       # Static hosting config + long cache on /model
└── model/            # <-- The three Teachable Machine files live here
    ├── model.json
    ├── weights.bin
    └── metadata.json
```

## Where the model files go

Place the three exported Teachable Machine files in the **`model/`** folder at
the project root:

- `model/model.json`
- `model/weights.bin`
- `model/metadata.json`

The app loads them from `/model/model.json` and `/model/metadata.json`. On
Vercel, files at the repo root are served from the site root, so these URLs
resolve automatically — no build step required.

> Note: the `@teachablemachine/image` library reads `metadata.json` and handles
> image resizing and preprocessing (input size and channel format)
> automatically. This particular model reports a 224×224 RGB input with labels
> `Healthy` and `Abnormal ovarian appearance`; index 0 is shown as
> "Normal-pattern similarity" and index 1 as "Abnormal-pattern similarity".

## Result wording

- Higher normal score → **Normal-pattern similarity**
- Higher abnormal score → **Abnormal-pattern similarity**
- Scores close together or low → **Unable to assess confidently**

Percentages are the model's **visual similarity scores**, not the probability
that a person has any medical condition.

## Running locally

It's a static site — serve the folder with any static server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL.

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. Import the repo in Vercel.
3. Framework preset: **Other** (no build command, output directory = root).
4. Deploy.

The libraries (`@tensorflow/tfjs` and `@teachablemachine/image`) are loaded from
a CDN, pinned to known-compatible versions in `index.html`.
