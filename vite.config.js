import { defineConfig } from 'vite';
import { proxyTile } from './api/tiles.js';
import { proxyLive } from './api/live.js';

// Mirror the Vercel serverless functions during `vite dev` so the app behaves
// identically locally and in production:
//   /api/tiles - keyless OSM raster basemap tile proxy (CORS-clean)
//   /api/live  - reads live detector detections from a store IF configured via
//                env vars (Supabase). Not configured by default -> returns
//                { ok: true, configured: false, detections: [] } so the app
//                shows everything else plus a discreet not-wired-in banner.
function devApiPlugin() {
  return {
    name: 'dev-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/tiles')) {
          proxyTile(req.url, res).catch(() => { res.statusCode = 502; res.end('proxy error'); });
          return;
        }
        if (req.url && req.url.startsWith('/api/live')) {
          proxyLive(req, res).catch(() => { res.statusCode = 502; res.end('proxy error'); });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devApiPlugin()],
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
