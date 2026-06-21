// Train Vantage - Layer 3 live-detection reader.
//
// This endpoint backs the discreet live banner and the Live & ETA tab. It is
// READY to plug in but INERT by default: the deployed build leaves the Supabase
// env vars unset, so this returns { configured: false } and the app keeps
// serving the map, the history, and the history-based odds.
//
// Two exports:
//   proxyLive(req, res)  used by vite.config.js dev middleware (signature req, res)
//   default handler      used by Vercel serverless (delegates to proxyLive)
//
// When configured, it reads recent rows from a Supabase `detections` table via
// the PostgREST endpoint. Expected row shape (documented for the watchtower and
// the ingest path):
//   {
//     id,                         // bigint / uuid
//     detected_at,                // ISO 8601 timestamp
//     detector_id,                // string, e.g. "10701"
//     milepost,                   // number, e.g. 221.9
//     speed_mph,                  // number
//     axles,                      // integer
//     direction,                  // "eastbound" | "westbound"
//     defect,                     // boolean
//     eta_downtown_min,           // number, model output at detection time
//     raw_text                    // string, the transcribed detector call
//   }
//
// Failure policy: NEVER 500 the client. Any error degrades to a 200 response
// with { configured: false } so the front end falls back to the subtle banner.

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function proxyLive(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  // Not configured (the default deployed state): the app shows the subtle
  // "no live detector wired in yet" banner.
  if (!url || !key) {
    sendJson(res, 200, { ok: true, configured: false, detections: [] });
    return;
  }

  try {
    const base = url.replace(/\/+$/, '');
    const endpoint =
      base +
      '/rest/v1/detections?select=*&order=detected_at.desc&limit=10';

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      sendJson(res, 200, {
        ok: true,
        configured: false,
        detections: [],
        reason: 'detection store returned ' + resp.status,
      });
      return;
    }

    const rows = await resp.json();
    const detections = Array.isArray(rows) ? rows : [];
    sendJson(res, 200, { ok: true, configured: true, detections });
  } catch (e) {
    // Degrade gracefully: keep the app working with the subtle banner.
    sendJson(res, 200, {
      ok: true,
      configured: false,
      detections: [],
      reason: 'detection store unreachable',
    });
  }
}

export default function handler(req, res) {
  return proxyLive(req, res);
}
