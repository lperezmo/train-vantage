// Train Vantage - About page.
//
// Honest, plain-English description of what the app is, the three layers, the
// data sources, why there is no live freight feed by default, and how the live
// layer works when a local radio receiver is connected.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function counts(meta) {
  const m = meta || {};
  const detectorsObj = m.detectors || {};
  const detList = Array.isArray(detectorsObj)
    ? detectorsObj
    : Array.isArray(detectorsObj.detectors)
      ? detectorsObj.detectors
      : [];
  const crossingsObj = m.crossings || {};
  const crossList = Array.isArray(crossingsObj)
    ? crossingsObj
    : Array.isArray(crossingsObj.crossings)
      ? crossingsObj.crossings
      : Array.isArray(crossingsObj.features)
        ? crossingsObj.features
        : [];
  const blockedObj = m.blocked || {};
  const blockedCount =
    typeof blockedObj.count === 'number'
      ? blockedObj.count
      : Array.isArray(blockedObj.reports)
        ? blockedObj.reports.length
        : Array.isArray(blockedObj)
          ? blockedObj.length
          : null;
  return {
    detectors: detList.length || null,
    crossings: crossList.length || null,
    blocked: blockedCount,
  };
}

export function initAbout(meta) {
  const host = document.getElementById('about');
  if (!host) return;

  const c = counts(meta);
  const detTxt = c.detectors ? c.detectors + ' wayside defect detectors' : 'the wayside defect detectors';
  const crossTxt = c.crossings ? c.crossings + ' grade crossings' : 'the grade crossings';
  const blockedTxt =
    c.blocked != null
      ? c.blocked + ' self-reported blocked-crossing reports'
      : 'self-reported blocked-crossing reports';

  host.innerHTML =
    '<h3>What Train Vantage is</h3>' +
    '<p>Train Vantage is a freight-train information map for Pendleton, Oregon. The Union Pacific ' +
    'La Grande Subdivision runs right through the middle of town, so a single long train can block ' +
    'several downtown street crossings at once and split the town in two. This app maps ' + escapeHtml(crossTxt) +
    ', shows where the trouble spots are, and estimates the odds that a train is blocking downtown ' +
    'based on history.</p>' +

    '<h3>The three layers</h3>' +
    '<p><strong>Layer 1, the map.</strong> The rail line, the grade crossings, the downtown at-grade ' +
    'cluster, and ' + escapeHtml(detTxt) + ' along the subdivision.</p>' +
    '<p><strong>Layer 2, the history and the odds.</strong> Patterns from ' + escapeHtml(blockedTxt) +
    ', summarized by day and hour, plus a history-based estimate of the chance a train is blocking ' +
    'downtown right now. This is an estimate from past reports, not a live observation.</p>' +
    '<p><strong>Layer 3, live detection (ready, off by default).</strong> When a local radio receiver ' +
    'is connected, the wayside detectors that the railroad already broadcasts can drive a real-time ' +
    'heads-up with an ETA to downtown. The architecture is built and the ETA model is wired, but no ' +
    'live feed runs by default.</p>' +

    '<h3>Data sources</h3>' +
    '<p>Grade crossings come from the FRA NTAD crossing inventory. Defect-detector positions and ' +
    'frequencies come from the public defectdetector.net directory. The historical blocked-crossing ' +
    'patterns come from the FRA Blocked Crossing Incident Reporter. The basemap and the rail line ' +
    'geometry come from OpenStreetMap.</p>' +
    '<p>The blocked-crossing reports are self-reported by the public and are unverified. They are used ' +
    'here only to describe historical patterns, never as live train status.</p>' +

    '<h3>Why there is no live train dot by default</h3>' +
    '<p>There is no public, real-time feed of freight-train positions. Railroads do not publish where ' +
    'their trains are. The one signal anyone can pick up locally is the automated voice that each ' +
    'wayside defect detector broadcasts on the radio as a train passes. Reading that requires a radio ' +
    'receiver on the ground, so live status is opt-in and local, not something this hosted site can do ' +
    'on its own.</p>' +

    '<h3>How live works when connected</h3>' +
    '<p>A small local pipeline called the watchtower does the work. An RTL-SDR radio dongle tunes the ' +
    'detector frequency (<code>160.410 MHz</code>), captures each transmission, and runs it through ' +
    'speech-to-text (Whisper). A parser reads the spoken detector call (milepost, track, axle count, ' +
    'speed, and any defect), the ETA model converts that into minutes to downtown, and the detection is ' +
    'posted to a small detection store (Supabase). The app then reads recent detections and shows the ' +
    'live banner. Setup notes live in the <code>watchtower/</code> scripts.</p>' +

    '<h3>Volunteer mode</h3>' +
    '<p>There is also an experimental, opt-in volunteer page at <code>/volunteer.html</code> that runs ' +
    'speech-to-text in your own browser on a scanner audio feed and submits detections, so no software ' +
    'install is needed. It is clearly experimental: it downloads a speech model on first use, accuracy ' +
    'on noisy scanner audio varies, and it only contributes when a detection store is configured. The ' +
    'supported path remains the local watchtower scripts.</p>';
}
