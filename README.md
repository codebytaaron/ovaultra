# Cathra

A free tool that compares an ovarian ultrasound image to normal and abnormal
patterns and shows a similarity score for each. It runs in the browser, so
images are never uploaded.

**Live:** https://www.cathra.dev

Research and education only. Not a medical device or a diagnosis.

## Results (model v2)

Tested on 1,449 held-out images from the PCOSGen dataset:

| | v1 | v2 |
|---|---|---|
| Accuracy | 74.2% | 85.6% |
| Balanced accuracy | 57.6% | 81.1% |
| Normal images correct | 19.2% | 70.8% |
| Abnormal images correct | 96.0% | 91.4% |

## Files

- `index.html`, `app.js`: homepage and tool
- `how-it-works.html`, `research.html`, `privacy.html`: info pages
- `styles.css`: styles
- `model/v2/`: current model (`model/v1/` kept for reference)
- `media/`: images and demo video

No build step. Pushing to `main` deploys to Vercel.

## New model versions

Add it as a new folder (for example `model/v3/`) and update `MODEL_VERSION` in
`app.js`. Don't overwrite an existing version, since browsers cache it. Keep
the class order Normal, then Abnormal.

## Data

PCOSGen dataset, Handa et al., Zenodo 2025
([train](https://doi.org/10.5281/zenodo.14592001),
[test](https://doi.org/10.5281/zenodo.14591782)), CC BY 4.0.

© 2026 Cathra. All rights reserved.
