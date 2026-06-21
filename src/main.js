// App orchestration for Train Vantage.
// Owns the import order, data load, map setup, tab switching, attribution,
// and the defensive init of the other agents' modules.

import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { loadData } from './data/load.js';
import { setupMap } from './ui/map.js';

const ATTR_TEXT =
  'Map: OpenStreetMap. Crossings and detectors: FRA NTAD, defectdetector.net. ' +
  'Blocked-crossing history: FRA Blocked Crossing Incident Reporter.';

function setAttribution() {
  const el = document.getElementById('attr');
  if (el) el.textContent = ATTR_TEXT;
}

function setupTabs(map) {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panes = Array.from(document.querySelectorAll('.tabpane'));
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-tab');
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panes.forEach((p) => {
        p.hidden = p.getAttribute('data-pane') !== name;
      });
      if (name === 'map' && map && map.map) {
        // Let the pane become visible, then relayout the map.
        setTimeout(() => map.map.resize(), 0);
      }
    });
  });
}

// The other agents' UI modules are siblings of this file. import.meta.glob lets
// Vite discover and bundle whichever of them actually exist at build time, and
// quietly yields nothing for the ones that do not (so a not-yet-created module
// never breaks the build). Each entry is a lazy loader: () => Promise<module>.
const UI_MODULES = import.meta.glob([
  './ui/now.js',
  './ui/charts.js',
  './ui/eta.js',
  './ui/about.js',
  './ui/live.js',
]);

// Defensive init of an other-agent module: a missing or throwing module must
// never blank the app. The try/catch keeps any failure fully contained.
async function initModule(exportName, file, arg) {
  try {
    const loader = UI_MODULES['./ui/' + file];
    if (!loader) return; // module not present in this build
    const mod = await loader();
    const fn = mod && mod[exportName];
    if (typeof fn === 'function') {
      await fn(arg);
    }
  } catch (e) {
    console.warn(exportName + ' init failed', e);
  }
}

async function main() {
  setAttribution();

  const data = await loadData();

  let map = null;
  try {
    map = await setupMap(data);
  } catch (e) {
    console.warn('map setup failed', e);
  }

  setupTabs(map);

  const detectors = data.detectors;
  const crossings = data.crossings;
  const blocked = data.blocked;

  const meta = {
    blocked,
    detectors,
    crossings,
  };

  // Other agents' modules. Each call is fully isolated and resolved at runtime.
  await initModule('initNow', 'now.js', blocked);
  await initModule('initCharts', 'charts.js', blocked);
  await initModule('initEta', 'eta.js', detectors);
  await initModule('initAbout', 'about.js', meta);
  await initModule('initLive', 'live.js', { map, detectors });
}

main();
