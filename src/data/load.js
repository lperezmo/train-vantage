// Layer 1 data loader. Fetches the five baked JSON files in parallel from
// /data/. Each file is fetched independently and resolves to null on failure
// so the app can still render whatever did load.

async function fetchJson(name) {
  try {
    const res = await fetch('/data/' + name + '.json');
    if (!res.ok) {
      console.warn('load: ' + name + '.json returned ' + res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('load: ' + name + '.json fetch failed', e);
    return null;
  }
}

export async function loadData() {
  const [crossings, detectors, railline, mileposts, blocked] = await Promise.all([
    fetchJson('crossings'),
    fetchJson('detectors'),
    fetchJson('railline'),
    fetchJson('mileposts'),
    fetchJson('blocked'),
  ]);
  return { crossings, detectors, railline, mileposts, blocked };
}
