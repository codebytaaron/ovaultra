// Vercel serverless function: verifies the access code server-side so the code
// is never shipped to the browser.
//
// The code is read from the ACCESS_CODE environment variable. Set it in Vercel
// (Project → Settings → Environment Variables). If it is not set, it falls back
// to a default so the site still works right after deploy — but for real
// security you should set ACCESS_CODE in Vercel and rely on that.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const expected = process.env.ACCESS_CODE || "soothenote123";

  let code = "";
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    code = body.code != null ? String(body.code).trim() : "";
  } catch (e) {
    code = "";
  }

  if (code && code === expected) {
    res.status(200).json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
}
