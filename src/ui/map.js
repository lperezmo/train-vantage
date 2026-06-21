// Layer 1: the MapLibre map. Builds the basemap, renders crossings,
// detectors, the rail line, and mileposts, wires the layer toggles and the
// legend, and exposes a showLiveTrain hook for the LIVE agent.
//
// Returns an object: { map, showLiveTrain }. The raw MapLibre instance is on
// .map; main.js calls map.map.resize() when the map tab becomes visible.

import maplibregl from 'maplibre-gl';

const CENTER = [-118.7886, 45.6721];
const ZOOM = 13.2;
const RAIL_COLOR = '#38bdf8';
const RAIL_CASING = '#08151c';

// Small helper: build a DOM element marker and add it to the map.
function makeMarker(className, lng, lat, text) {
  const el = document.createElement('div');
  el.className = className;
  if (text != null) el.textContent = text;
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
}

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function crossingPopupHtml(c) {
  const dt = c.downtown ? 'yes' : 'no';
  const mp = c.milepost ? esc(c.milepost) : 'n/a';
  return (
    '<strong>' + esc(c.street || 'Grade crossing') + '</strong><br/>' +
    'ID ' + esc(c.id) + '<br/>' +
    'Milepost ' + mp + '<br/>' +
    'Position: ' + esc(c.position || 'n/a') + '<br/>' +
    'Type: ' + esc(c.type || 'n/a') + '<br/>' +
    'Downtown: ' + dt
  );
}

function crossingInfoHtml(c) {
  const dt = c.downtown ? 'yes' : 'no';
  const mp = c.milepost ? esc(c.milepost) : 'n/a';
  return (
    '<h3>' + esc(c.street || 'Grade crossing') + '</h3>' +
    '<div><span class="k">Crossing ID:</span> ' + esc(c.id) + '</div>' +
    '<div><span class="k">Milepost:</span> ' + mp + '</div>' +
    '<div><span class="k">Position:</span> ' + esc(c.position || 'n/a') + '</div>' +
    '<div><span class="k">Type:</span> ' + esc(c.type || 'n/a') + '</div>' +
    '<div><span class="k">Railroad:</span> ' + esc(c.railroad || 'n/a') + '</div>' +
    '<div><span class="k">Downtown at-grade:</span> ' + dt + '</div>'
  );
}

function detectorPopupHtml(d) {
  const hu = d.heads_up || {};
  return (
    '<strong>Defect detector ' + esc(d.detector_id) + '</strong><br/>' +
    esc(d.location || '') + '<br/>' +
    'Milepost ' + esc(d.milepost) + '<br/>' +
    'Frequency: ' + esc(d.frequency || 'n/a') + '<br/>' +
    'Functions: ' + esc(d.functions || 'n/a') + '<br/>' +
    'Direction caught: ' + esc(d.direction_caught || 'n/a') +
    (hu.eta_note ? '<br/>' + esc(hu.eta_note) : '')
  );
}

function detectorInfoHtml(d) {
  const hu = d.heads_up || {};
  return (
    '<h3>Defect detector ' + esc(d.detector_id) + '</h3>' +
    '<div><span class="k">Location:</span> ' + esc(d.location || 'n/a') + '</div>' +
    '<div><span class="k">Milepost:</span> ' + esc(d.milepost) + '</div>' +
    '<div><span class="k">Frequency:</span> ' + esc(d.frequency || 'n/a') + '</div>' +
    '<div><span class="k">Functions:</span> ' + esc(d.functions || 'n/a') + '</div>' +
    '<div><span class="k">Direction caught:</span> ' + esc(d.direction_caught || 'n/a') + '</div>' +
    (d.key ? '<div><span class="k">Key detector:</span> yes (used for ETA)</div>' : '') +
    (hu.eta_note ? '<div><span class="k">Heads up:</span> ' + esc(hu.eta_note) + '</div>' : '')
  );
}

function buildLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  const acc = RAIL_COLOR;
  el.innerHTML =
    '<div class="lg-item"><i style="background:#38bdf8"></i> Grade crossing</div>' +
    '<div class="lg-item"><i style="background:#f5a623;width:16px;height:16px"></i> Downtown at-grade crossing</div>' +
    '<div class="lg-item"><i style="border-radius:3px;background:#08151c;border:2px solid #22d3ee"></i> Defect detector</div>' +
    '<div class="lg-item"><i style="border-radius:3px;background:#22d3ee"></i> Key detector (used for ETA)</div>' +
    '<div class="lg-item"><i style="border-radius:0;width:18px;height:4px;background:' + acc + '"></i> UP La Grande Sub rail line</div>';
}

export async function setupMap(data) {
  const map = new maplibregl.Map({
    container: 'map',
    center: CENTER,
    zoom: ZOOM,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['/api/tiles?src=osm&z={z}&x={x}&y={y}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Map data OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // State holders so toggles can show/hide each layer.
  const crossingMarkers = []; // { marker, downtown }
  const detectorMarkers = [];
  const milepostMarkers = [];
  let liveMarker = null;

  const infoBox = document.getElementById('crossing-info');
  function showInfo(html) {
    if (!infoBox) return;
    infoBox.innerHTML = html;
    infoBox.hidden = false;
  }

  await new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.on('load', resolve);
  });

  // ---- Rail line (geojson source + casing + line) ----
  if (data && data.railline && data.railline.type) {
    map.addSource('railline', { type: 'geojson', data: data.railline });
    map.addLayer({
      id: 'railline-casing',
      type: 'line',
      source: 'railline',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': RAIL_CASING, 'line-width': 5.5 },
    });
    map.addLayer({
      id: 'railline-line',
      type: 'line',
      source: 'railline',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': RAIL_COLOR, 'line-width': 3 },
    });
  }

  // ---- Crossings (DOM markers) ----
  if (data && data.crossings && Array.isArray(data.crossings.features)) {
    for (const c of data.crossings.features) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      const cls = 'mk-crossing' + (c.downtown ? ' downtown' : '');
      const marker = makeMarker(cls, c.lng, c.lat);
      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(crossingPopupHtml(c));
      marker.setPopup(popup);
      marker.getElement().addEventListener('click', () => showInfo(crossingInfoHtml(c)));
      marker.addTo(map);
      crossingMarkers.push({ marker, downtown: !!c.downtown });
    }
  }

  // ---- Detectors (square DOM markers) ----
  if (data && data.detectors && Array.isArray(data.detectors.detectors)) {
    for (const d of data.detectors.detectors) {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) continue;
      const cls = 'mk-detector' + (d.key ? ' key' : '');
      const marker = makeMarker(cls, d.lng, d.lat, 'D');
      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(detectorPopupHtml(d));
      marker.setPopup(popup);
      marker.getElement().addEventListener('click', () => showInfo(detectorInfoHtml(d)));
      marker.addTo(map);
      detectorMarkers.push({ marker });
    }
  }

  // ---- Mileposts (text DOM markers, off by default) ----
  if (data && data.mileposts && Array.isArray(data.mileposts.features)) {
    for (const f of data.mileposts.features) {
      const g = f.geometry || {};
      const coords = Array.isArray(g.coordinates) ? g.coordinates : null;
      const lng = coords ? coords[0] : f.properties && f.properties.lng;
      const lat = coords ? coords[1] : f.properties && f.properties.lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const label = 'MP ' + ((f.properties && f.properties.milepost) != null ? f.properties.milepost : '?');
      const marker = makeMarker('mk-milepost', lng, lat, label);
      milepostMarkers.push({ marker });
    }
  }

  buildLegend();

  // ---- Toggle wiring ----
  function setMarkerVisible(entry, on) {
    if (on) {
      if (!entry.marker._onMap) {
        entry.marker.addTo(map);
        entry.marker._onMap = true;
      }
    } else if (entry.marker._onMap !== false) {
      entry.marker.remove();
      entry.marker._onMap = false;
    }
  }
  // Crossings and detectors start on the map already.
  crossingMarkers.forEach((e) => { e.marker._onMap = true; });
  detectorMarkers.forEach((e) => { e.marker._onMap = true; });
  milepostMarkers.forEach((e) => { e.marker._onMap = false; });

  function applyCrossings() {
    const showCrossings = !!(document.getElementById('t-crossings') || {}).checked;
    crossingMarkers.forEach((e) => setMarkerVisible(e, showCrossings));
  }
  function applyDowntownHighlight() {
    const on = !!(document.getElementById('t-downtown') || {}).checked;
    crossingMarkers.forEach((e) => {
      if (!e.downtown) return;
      const el = e.marker.getElement();
      el.classList.toggle('downtown', on);
    });
  }
  function applyRailline() {
    const on = !!(document.getElementById('t-railline') || {}).checked;
    const vis = on ? 'visible' : 'none';
    ['railline-casing', 'railline-line'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }
  function applyDetectors() {
    const on = !!(document.getElementById('t-detectors') || {}).checked;
    detectorMarkers.forEach((e) => setMarkerVisible(e, on));
  }
  function applyMileposts() {
    const on = !!(document.getElementById('t-mileposts') || {}).checked;
    milepostMarkers.forEach((e) => setMarkerVisible(e, on));
  }

  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', fn);
  }
  bind('t-crossings', applyCrossings);
  bind('t-downtown', applyDowntownHighlight);
  bind('t-railline', applyRailline);
  bind('t-detectors', applyDetectors);
  bind('t-mileposts', applyMileposts);

  // Apply initial states (mileposts off, rest on, downtown highlighted).
  applyCrossings();
  applyDowntownHighlight();
  applyRailline();
  applyDetectors();
  applyMileposts();

  // ---- Live train hook for the LIVE agent ----
  // showLiveTrain(detection): best-effort single distinctive marker. Accepts a
  // detection with explicit lat/lng, or a { detector } / detector_id we can map
  // to a known detector position. No-op if no usable coordinates are found.
  function resolveCoords(detection) {
    if (!detection) return null;
    if (Number.isFinite(detection.lat) && Number.isFinite(detection.lng)) {
      return [detection.lng, detection.lat];
    }
    const dets = (data && data.detectors && data.detectors.detectors) || [];
    const id = detection.detector_id || (detection.detector && detection.detector.detector_id);
    if (id != null) {
      const match = dets.find((d) => String(d.detector_id) === String(id));
      if (match && Number.isFinite(match.lat) && Number.isFinite(match.lng)) {
        return [match.lng, match.lat];
      }
    }
    return null;
  }

  function showLiveTrain(detection) {
    const coords = resolveCoords(detection);
    if (!coords) return null; // best-effort no-op
    if (!liveMarker) {
      const el = document.createElement('div');
      el.className = 'mk-live-train';
      el.title = 'Live train (estimated position)';
      el.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#22c55e;' +
        'border:3px solid #08151c;box-shadow:0 0 0 3px rgba(34,197,94,.45),0 1px 4px rgba(0,0,0,.6);' +
        'cursor:pointer;';
      liveMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords).addTo(map);
    } else {
      liveMarker.setLngLat(coords);
      if (!liveMarker._onMap) liveMarker.addTo(map);
    }
    liveMarker._onMap = true;
    if (detection && (detection.label || detection.eta_note)) {
      liveMarker.setPopup(
        new maplibregl.Popup({ offset: 12 }).setHTML(
          '<strong>Live train</strong><br/>' + esc(detection.label || detection.eta_note)
        )
      );
    }
    return liveMarker;
  }

  return { map, showLiveTrain };
}
