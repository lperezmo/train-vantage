// Train Vantage - ETA model and heads-up table (Layer 2/3 bridge).
//
// The ETA model turns a wayside-detector hit into an estimate of how long until
// the train reaches downtown Pendleton (the at-grade crossing cluster around
// milepost 215.5). It is the same arithmetic the live layer would use to drive
// an alert the moment a real detector feed is connected.
//
// Model:
//   eta_min(speed_mph) = dist_to_downtown_mi / speed_mph * 60
//
// Direction is geometry, not a fixed label. The downtown reference is MP 215.5.
//   - Detectors WEST of downtown (milepost < 215.5) catch EASTBOUND trains
//     climbing toward town from the Columbia plateau (Echo, the two Rieth
//     detectors).
//   - Detectors EAST of downtown (milepost > 215.5) catch WESTBOUND trains
//     coming down the Blue Mountain grade (Mission, Bonifer).
//
// We bracket the heads-up with two speeds (25 and 40 mph) because the only
// speed we ever get is the instantaneous reading at the detector, and trains
// accelerate or brake heavily on the grade.

const DOWNTOWN_MP = 215.5;
const SPEED_LOW = 25;
const SPEED_HIGH = 40;

// Pure helper, also handy for live.js. Returns minutes (number) or null.
export function computeEta(detector, speedMph) {
  if (!detector) return null;
  const dist = Number(detector.dist_to_downtown_mi);
  const speed = Number(speedMph);
  if (!Number.isFinite(dist) || !Number.isFinite(speed) || speed <= 0) {
    return null;
  }
  return (dist / speed) * 60;
}

// Direction from geometry vs the downtown milepost.
export function directionFor(milepost, refMp) {
  const mp = Number(milepost);
  const ref = Number.isFinite(Number(refMp)) ? Number(refMp) : DOWNTOWN_MP;
  if (!Number.isFinite(mp)) return 'unknown';
  if (mp < ref) return 'eastbound';
  if (mp > ref) return 'westbound';
  return 'at downtown';
}

// Accepts either the parsed detectors.json object or a bare array of detectors.
function extract(detectors) {
  if (!detectors) return { list: [], refMp: DOWNTOWN_MP };
  if (Array.isArray(detectors)) return { list: detectors, refMp: DOWNTOWN_MP };
  const list = Array.isArray(detectors.detectors) ? detectors.detectors : [];
  const refMp = Number.isFinite(Number(detectors.downtown_reference_mp))
    ? Number(detectors.downtown_reference_mp)
    : DOWNTOWN_MP;
  return { list, refMp };
}

function fmtMinutes(n) {
  if (!Number.isFinite(n)) return '--';
  return Math.round(n);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function initEta(detectors) {
  const host = document.getElementById('eta-table');
  if (!host) return;

  const { list, refMp } = extract(detectors);
  const keyDetectors = list.filter((d) => d && d.key === true);

  if (!keyDetectors.length) {
    host.innerHTML =
      '<p class="hint">Detector data is not available, so the heads-up table cannot be built right now.</p>';
    return;
  }

  // Farthest heads-up first: the early-warning detectors at the top.
  keyDetectors.sort(
    (a, b) => Number(b.dist_to_downtown_mi) - Number(a.dist_to_downtown_mi)
  );

  const rows = keyDetectors
    .map((d) => {
      const dir = directionFor(d.milepost, refMp);
      const dist = Number(d.dist_to_downtown_mi);
      // Wider (slower) speed gives the longer heads-up; faster gives the floor.
      const slow = computeEta(d, SPEED_LOW);
      const fast = computeEta(d, SPEED_HIGH);
      const headsUp =
        Number.isFinite(slow) && Number.isFinite(fast)
          ? '~' + fmtMinutes(fast) + '-' + fmtMinutes(slow) + ' min'
          : '--';
      const note =
        dir === 'eastbound'
          ? 'Approaching downtown from the west'
          : dir === 'westbound'
            ? 'Coming down the Blue Mountain grade from the east'
            : 'At the downtown reference point';
      const label = escapeHtml(d.location) + ' (MP ' + escapeHtml(d.milepost) + ')';
      return (
        '<tr>' +
        '<td>' + label + '</td>' +
        '<td>' + dir + '</td>' +
        '<td>' + (Number.isFinite(dist) ? dist.toFixed(1) : '--') + '</td>' +
        '<td>' + headsUp + '</td>' +
        '<td>' + note + '</td>' +
        '</tr>'
      );
    })
    .join('');

  host.innerHTML =
    '<h3 style="font-size:13px;color:var(--accent);margin:14px 0 4px;">Heads-up by detector</h3>' +
    '<p class="hint">If a train trips one of these key detectors, this is roughly how long until it reaches the downtown crossings at MP ' +
    refMp +
    '. The range brackets a slow ' +
    SPEED_LOW +
    ' mph train against a faster ' +
    SPEED_HIGH +
    ' mph train.</p>' +
    '<table class="eta">' +
    '<thead><tr>' +
    '<th>Detector</th>' +
    '<th>Catches</th>' +
    '<th>To downtown (mi)</th>' +
    '<th>Typical heads-up</th>' +
    '<th>Note</th>' +
    '</tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody>' +
    '</table>' +
    '<p class="hint" style="margin-top:10px;">The speed is the instantaneous reading at the detector. Trains accelerate and brake on the grade, so the farther-out detectors carry wider error bars. This same model drives the live alerts once a detector radio feed is connected.</p>';
}
