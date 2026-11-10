# Cathra

Cathra is a free research and education tool that compares an existing ovarian
ultrasound image to two learned patterns, normal and abnormal, and shows a
similarity score for each. The model runs entirely in the visitor's browser, so
images are never uploaded or stored.

Live site: https://www.cathra.dev

> **Not a medical device.** Cathra does not diagnose, detect, confirm, or rule out
> ovarian cancer or any other condition. See the disclaimer on the site.

© 2026 Cathra. All rights reserved. This repository is private and proprietary.
Do not copy, share, or redistribute any part of it without written permission.

## How it works

- A Google Teachable Machine image model (TensorFlow.js) classifies the image's
  center square into two classes: index 0 = normal, index 1 = abnormal.
- The image is read from an in-memory object URL and passed to the model as a
  canvas at its natural size. Nothing is sent to a server.
- If the top score is under 60%, or the two scores are within 15 points, the
  result reads "Unable to assess confidently".
- The upload step warns about low-resolution images and images that look like
  color photos rather than ultrasounds.

## Project structure

```
index.html          Homepage and the tool (upload → confirm → results)
how-it-works.html   Model card: training data, reading results, limitations, disclaimer
research.html       Lesson outline, how to cite, contact for schools and labs
privacy.html        Privacy policy
app.js              Tool logic: file handling, preview, model, results
styles.css          All styles (white and black, minimal)
media/              Demo video, poster image, founder photo
model/v1/, model/v2/ Model versions (v2 is live): model.json, weights.bin, metadata.json
robots.txt          Allows indexing, keeps /model/ out of search
sitemap.xml         Pages for search engines
vercel.json         Clean URLs; long-term caching for /model/
```

No build step. Vercel deploys the repo root as a static site on every push to
`main`.

## Updating the model

`/model/` is cached by browsers for a year, so **never overwrite files inside an
existing version folder**. Returning visitors would keep the old model.

1. Export from Teachable Machine: **Export Model → TensorFlow.js → Download**.
2. Put the three files in a new folder, for example `model/v3/`.
3. In `app.js`, change `MODEL_VERSION` to `"v3"`.
4. Keep the class order **Normal first, Abnormal second**. The app relies on it.
5. Update the training wording and dataset credit on `how-it-works.html` and the
   homepage facts if the training data changed.
6. Push to `main`.

## Training data

**v2 (live, `model/v2`, Nov 2026):** trained on 1,734 PCOSGen training images
(867 normal, 867 abnormal, balanced), tested on the 1,449 held-out PCOSGen test
images: 85.6% accuracy, 81.1% balanced accuracy, 70.8% of normal and 91.4% of
abnormal scans classified correctly. `model/v1` (July 2026, different smaller
data) scored 74.2% / 57.6% on the same test set. Full table on How it works.

PCOSGen dataset (train and test), Handa et al., Zenodo 2025,
[10.5281/zenodo.14592001](https://doi.org/10.5281/zenodo.14592001) and
[10.5281/zenodo.14591782](https://doi.org/10.5281/zenodo.14591782), CC BY 4.0.
Credit is shown on the How it works page and in the site footer.

## Running locally

Serve the folder with any static server (clean URLs need `.html` fallback), for
example:

```bash
npx serve .
```
