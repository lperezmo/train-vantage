// Train Vantage - Layer 3 detection ingest (cloud write path).
//
// The watchtower (local RTL-SDR pipeline) or the opt-in volunteer page POSTs a
// parsed detector call here to record it. This is the WRITE side of the live
// layer and is INERT by default: with Supabase unset it returns 503 and writes
// nothing.
//
// Contract:
//   - Method must be POST (else 405).
//   - Header x-ingest-token must equal process.env.INGEST_TOKEN (else 401).
//   - If Supabase is not configured -> 503 { ok:false, reason:'ingest not configured' }.
//   - Body must include at least detector_id and milepost (else 400).
//   - On success -> POST the row to Supabase /rest/v1/detections with
//     Prefer: return=minimal, then return { ok:true }.
//
// Expected body / stored row shape (see api/live.js for the full description):
//   { detector_id, milepost, speed_mph, axles, direction, defect,
//     eta_downtown_min, raw_text, detected_at }
//
// detected_at is optional; if omitted the database default (now()) applies.

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ingest-token');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  // Vercel usually parses JSON into req.body. Fall back to reading the stream
  // for the vite dev path or when the body is delivered raw.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return null;
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, reason: 'method not allowed' });
    return;
  }

  const expected = process.env.INGEST_TOKEN;
  const got = req.headers ? req.headers['x-ingest-token'] : undefined;
  if (!expected || got !== expected) {
    sendJson(res, 401, { ok: false, reason: 'unauthorized' });
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    sendJson(res, 503, { ok: false, reason: 'ingest not configured' });
    return;
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { ok: false, reason: 'invalid json body' });
    return;
  }

  // Minimal validation: a detection must name a detector and a milepost.
  const hasDetector =
    body.detector_id !== undefined &&
    body.detector_id !== null &&
    String(body.detector_id).length > 0;
  const milepost = Number(body.milepost);
  if (!hasDetector || !Number.isFinite(milepost)) {
    sendJson(res, 400, {
      ok: false,
      reason: 'detector_id and numeric milepost are required',
    });
    return;
  }

  try {
    const base = url.replace(/\/+$/, '');
    const resp = await fetch(base + '/rest/v1/detections', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      sendJson(res, 502, {
        ok: false,
        reason: 'detection store rejected the write',
        status: resp.status,
        detail: text.slice(0, 300),
      });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 502, { ok: false, reason: 'detection store unreachable' });
  }
}
