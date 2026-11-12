/*
 * Cathra Dataset Check: finds exact copies, near-copies, label conflicts and
 * train/test leaks in a folder of images. Everything runs in this browser tab;
 * no image or file name is uploaded anywhere.
 *
 * Near-copies are found with a perceptual hash (pHash): each image is shrunk to
 * 32 × 32 grayscale, transformed with a DCT, and its 63 lowest-frequency
 * coefficients are compared to their median. Two images whose 63-bit hashes
 * differ in only a few bits look almost the same.
 */
(() => {
  const SPLIT_RE = /^(train|training|test|testing|val|valid|validation|dev)$/i;
  const IMAGE_RE = /\.(jpe?g|png|bmp|gif|webp|tiff?)$/i;
  const MAX_SHOWN = 120;

  const $ = (id) => document.getElementById(id);
  const zone = $("dc-zone"), folderInput = $("dc-folder"), filesInput = $("dc-files");
  const runView = $("dc-run"), resultView = $("dc-results"), startView = $("dc-start");
  const bar = $("dc-bar"), status = $("dc-status");
  const strictness = $("dc-strict");

  let images = [];   // { file, path, label, split, h1, h0, sha }
  let lastReport = null;

  // ---------- Reading files ----------
  function describe(file, path) {
    const parts = path.split("/").filter(Boolean);
    const dirs = parts.slice(0, -1);
    const split = (dirs.find((d) => SPLIT_RE.test(d)) || "").toLowerCase().replace(/^training$/, "train")
      .replace(/^testing$/, "test").replace(/^(valid|validation|dev)$/, "val");
    // Label = nearest folder that isn't a split name (shared top folder already removed).
    let label = "";
    for (let i = dirs.length - 1; i >= 0; i--) if (!SPLIT_RE.test(dirs[i])) { label = dirs[i]; break; }
    return { file, path, label, split };
  }

  async function walkEntry(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      if (IMAGE_RE.test(file.name)) out.push(describe(file, prefix + file.name));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walkEntry(e, prefix + entry.name + "/", out);
      } while (batch.length);
    }
  }

  function fromFileList(list) {
    return [...list].filter((f) => IMAGE_RE.test(f.name))
      .map((f) => describe(f, f.webkitRelativePath || f.name));
  }

  // ---------- Hashing ----------
  const N = 32;
  const COS = new Float64Array(N * N);
  for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) COS[k * N + n] = Math.cos(Math.PI * (2 * n + 1) * k / (2 * N));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Shrink in steps with high-quality smoothing, so fingerprints are stable
  // across browsers and don't depend on how big the original image is.
  const steps = [document.createElement("canvas"), document.createElement("canvas")];
  function shrink(src) {
    let w = src.width, h = src.height, cur = src, k = 0;
    while (w > N * 2 || h > N * 2) {
      w = Math.max(N, Math.round(w / 2)); h = Math.max(N, Math.round(h / 2));
      const next = steps[k++ % 2];
      next.width = w; next.height = h;
      const c = next.getContext("2d");
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(cur, 0, 0, w, h);
      cur = next;
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, N, N);
  }

  async function phash(file) {
    let src;
    try { src = await createImageBitmap(file); }
    catch (e) {
      const img = new Image(); img.src = URL.createObjectURL(file);
      await img.decode(); src = img;
    }
    shrink(src);
    if (src.close) src.close(); else URL.revokeObjectURL(src.src);
    const px = ctx.getImageData(0, 0, N, N).data;
    const g = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    // 2D DCT, only the 8 × 8 low-frequency block is needed
    const tmp = new Float64Array(8 * N);
    for (let u = 0; u < 8; u++) for (let x = 0; x < N; x++) {
      let s = 0; for (let y = 0; y < N; y++) s += COS[u * N + y] * g[y * N + x]; tmp[u * N + x] = s;
    }
    const d = [];
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      let s = 0; for (let x = 0; x < N; x++) s += COS[v * N + x] * tmp[u * N + x]; d.push(s);
    }
    const med = [...d].sort((a, b) => a - b)[31];
    let h1 = 0, h0 = 0;
    for (let i = 0; i < 63; i++) {
      if (d[i] > med) { if (i < 32) h0 |= 1 << i; else h1 |= 1 << (i - 32); }
    }
    return [h1 >>> 0, h0 >>> 0];
  }

  async function sha(file) {
    const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const popcount = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

  // ---------- Run ----------
  // Drop the folder everyone shares (e.g. "PCOSGen/"), so it isn't treated as a label.
  function stripCommonRoot(list) {
    const firsts = new Set(list.map((im) => im.path.split("/")[0]));
    const allNested = list.every((im) => im.path.includes("/"));
    if (firsts.size === 1 && allNested && !SPLIT_RE.test([...firsts][0])) return list.map((im) => describe(im.file, im.path.split("/").slice(1).join("/")));
    return list;
  }

  async function run(list) {
    images = stripCommonRoot(list);
    if (!images.length) { status.textContent = "No images found. Choose a folder with JPG or PNG files."; return; }
    startView.hidden = true; resultView.hidden = true; runView.hidden = false;
    const t0 = performance.now();
    let failed = 0;
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      try { [im.h1, im.h0] = await phash(im.file); im.sha = await sha(im.file); }
      catch (e) { im.bad = true; failed++; }
      if (i % 8 === 0 || i === images.length - 1) {
        bar.style.width = `${Math.round(((i + 1) / images.length) * 100)}%`;
        status.textContent = `Checking image ${i + 1} of ${images.length}…`;
        await new Promise((r) => setTimeout(r));
      }
    }
    images = images.filter((im) => !im.bad);
    status.textContent = "Comparing images…";
    await new Promise((r) => setTimeout(r, 20));
    lastReport = compare(Number(strictness.value));
    lastReport.failed = failed;
    lastReport.seconds = (performance.now() - t0) / 1000;
    render(lastReport);
  }

  function compare(maxDist) {
    const n = images.length, pairs = [];
    const H1 = new Uint32Array(n), H0 = new Uint32Array(n);
    images.forEach((im, i) => { H1[i] = im.h1; H0[i] = im.h0; });
    for (let i = 0; i < n; i++) {
      const a1 = H1[i], a0 = H0[i];
      for (let j = i + 1; j < n; j++) {
        const dist = popcount(a1 ^ H1[j]) + popcount(a0 ^ H0[j]);
        if (dist <= maxDist) pairs.push([i, j, dist]);
      }
    }
    const kinds = { exact: [], near: [] };
    const conflicts = [], leaks = [];
    for (const [i, j, dist] of pairs) {
      const a = images[i], b = images[j];
      const p = { a, b, dist, exact: a.sha === b.sha };
      (p.exact ? kinds.exact : kinds.near).push(p);
      if (a.label && b.label && a.label !== b.label) conflicts.push(p);
      if (a.split && b.split && a.split !== b.split) leaks.push(p);
    }
    const inPair = new Set(); pairs.forEach(([i, j]) => { inPair.add(i); inPair.add(j); });
    const labels = [...new Set(images.map((im) => im.label).filter(Boolean))];
    const splits = [...new Set(images.map((im) => im.split).filter(Boolean))];
    return { maxDist, total: n, pairs: kinds.exact.concat(kinds.near), exact: kinds.exact, near: kinds.near,
             conflicts, leaks, affected: inPair.size, labels, splits };
  }

  // ---------- Results ----------
  const fmt = (n) => n.toLocaleString();
  function render(r) {
    runView.hidden = true; resultView.hidden = false;
    $("dc-total").textContent = fmt(r.total);
    $("dc-affected").textContent = fmt(r.affected);
    $("dc-affected-pct").textContent = r.total ? `(${Math.round((r.affected / r.total) * 100)}%)` : "";
    $("dc-exact").textContent = fmt(r.exact.length);
    $("dc-near").textContent = fmt(r.near.length);
    $("dc-conflicts").textContent = r.labels.length > 1 ? fmt(r.conflicts.length) : "—";
    $("dc-leaks").textContent = r.splits.length > 1 ? fmt(r.leaks.length) : "—";
    const notes = [];
    notes.push(r.labels.length > 1 ? `Labels found from folder names: ${r.labels.join(", ")}.`
      : r.labels.length === 1 ? `Only one label was found (${r.labels[0]}), so label conflicts weren’t checked.`
      : "No label folders were found, so label conflicts weren’t checked.");
    notes.push(r.splits.length > 1 ? `Splits found: ${r.splits.join(", ")}.`
      : r.splits.length === 1 ? `Only one split was found (${r.splits[0]}), so train/test leaks weren’t checked.`
      : "No train/test folders were found, so leaks weren’t checked.");
    if (r.failed) notes.push(`${r.failed} file(s) couldn’t be read and were skipped.`);
    notes.push(`Finished in ${r.seconds.toFixed(1)} s, entirely on this device.`);
    $("dc-notes").textContent = notes.join(" ");
    showList("conflicts");
  }

  let urls = [];
  function thumb(im) {
    const u = URL.createObjectURL(im.file); urls.push(u);
    return `<figure class="dc-thumb"><img src="${u}" alt="" loading="lazy"><figcaption>${esc(im.path)}${im.label ? ` <b>${esc(im.label)}</b>` : ""}${im.split ? ` <i>${esc(im.split)}</i>` : ""}</figcaption></figure>`;
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function showList(kind) {
    if (!lastReport) return;
    document.querySelectorAll(".dc-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.kind === kind)));
    urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
    const list = { conflicts: lastReport.conflicts, leaks: lastReport.leaks, all: lastReport.pairs }[kind]
      .slice().sort((a, b) => a.dist - b.dist);
    const box = $("dc-list");
    if (!list.length) { box.innerHTML = `<p class="dc-empty">None found.</p>`; return; }
    box.innerHTML = list.slice(0, MAX_SHOWN).map((p) => `
      <div class="dc-pair">
        <div class="dc-pair-head">${p.exact ? "Exact copy" : `Near-copy · ${p.dist} of 63 bits differ`}</div>
        <div class="dc-pair-imgs">${thumb(p.a)}${thumb(p.b)}</div>
      </div>`).join("") +
      (list.length > MAX_SHOWN ? `<p class="dc-empty">Showing the closest ${MAX_SHOWN} of ${fmt(list.length)}. Download the CSV for all of them.</p>` : "");
  }

  function csv() {
    if (!lastReport) return;
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [["image_a", "image_b", "type", "bits_different", "label_a", "label_b", "label_conflict", "split_a", "split_b", "train_test_leak"]];
    for (const p of lastReport.pairs) rows.push([p.a.path, p.b.path, p.exact ? "exact" : "near", p.dist, p.a.label, p.b.label,
      p.a.label && p.b.label && p.a.label !== p.b.label ? "yes" : "no", p.a.split, p.b.split,
      p.a.split && p.b.split && p.a.split !== p.b.split ? "yes" : "no"]);
    const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cathra-dataset-check.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Wiring ----------
  $("dc-pick-folder").addEventListener("click", () => folderInput.click());
  $("dc-pick-files").addEventListener("click", () => filesInput.click());
  folderInput.addEventListener("change", () => run(fromFileList(folderInput.files)));
  filesInput.addEventListener("change", () => run(fromFileList(filesInput.files)));
  ["dragenter", "dragover"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((e) => zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", async (ev) => {
    const items = [...(ev.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    const out = [];
    if (items.length) { for (const e of items) await walkEntry(e, "", out); }
    else out.push(...fromFileList(ev.dataTransfer.files));
    run(out);
  });
  strictness.addEventListener("change", () => {
    $("dc-strict-label").textContent = { 0: "Identical only", 4: "Very close (recommended)", 8: "Close", 12: "Loose" }[strictness.value];
    if (lastReport) { const keep = { failed: lastReport.failed, seconds: lastReport.seconds }; lastReport = Object.assign(compare(Number(strictness.value)), keep); render(lastReport); }
  });
  document.querySelectorAll(".dc-tab").forEach((t) => t.addEventListener("click", () => showList(t.dataset.kind)));
  $("dc-csv").addEventListener("click", csv);
  $("dc-again").addEventListener("click", () => {
    urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; images = []; lastReport = null;
    folderInput.value = ""; filesInput.value = "";
    resultView.hidden = true; startView.hidden = false; status.textContent = "";
  });

})();
