// Vercel serverless function (and Vite dev middleware) that proxies map tiles.
//
// Why a proxy: keeping the basemap source server-side adds a stable
// Access-Control-Allow-Origin header, edge-caches the tiles, sends a proper
// User-Agent (OSM tile usage policy), and keeps the upstream source swappable
// without touching the client.
//
//   GET /api/tiles?src=osm&z=<z>&x=<x>&y=<y>
//
// Source (keyless): OpenStreetMap standard raster tiles.

const SOURCES = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};

const Z_MAX = { osm: 19 };

export async function proxyTile(reqUrl, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  let params;
  try {
    params = new URL(reqUrl, 'http://localhost').searchParams;
  } catch {
    res.statusCode = 400;
    res.end('bad url');
    return;
  }

  const src = params.get('src') || 'osm';
  const z = Number(params.get('z'));
  const x = Number(params.get('x'));
  const y = Number(params.get('y'));
  const make = SOURCES[src];

  if (!make || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    res.statusCode = 400;
    res.end('expected ?src=osm&z&x&y');
    return;
  }
  if (z < 0 || z > (Z_MAX[src] ?? 19) || x < 0 || y < 0) {
    res.statusCode = 400;
    res.end('tile out of range');
    return;
  }

  try {
    const upstream = await fetch(make(z, x, y), {
      headers: { 'User-Agent': 'train-vantage (github.com/lperezmo/train-vantage)' },
    });
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.end(`upstream ${upstream.status}`);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.statusCode = 200;
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.end('proxy error: ' + (err?.message || 'unknown'));
  }
}

export default function handler(req, res) {
  return proxyTile(req.url, res);
}
