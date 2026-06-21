// now.js - Layer 2 "is a train blocking downtown right now?" headline.
// Fills the #now-card with a history-based probability for the CURRENT local
// hour and weekday. This is a historical-frequency estimate from public
// FRA blocked-crossing reports, NOT a live observation of any train.
//
// Source of probability: blocked.predictive.by_hour[h].prob, where
//   prob = (incidents reported in that hour) / (observation days), capped at 1.
// We blend it lightly with the day-of-week factor so the headline feels
// responsive to "today", while staying honest about what it means.

const DOW_LABELS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

function hourLabel12(h) {
  h = ((Number(h) % 24) + 24) % 24;
  const ampm = h < 12 ? "AM" : "PM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return hh + " " + ampm;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Express a probability as "about 1 in N days".
function oneInN(prob) {
  if (!(prob > 0)) return null;
  return Math.round(1 / prob);
}

export function initNow(blocked) {
  const card = document.getElementById("now-card");
  const gauge = document.getElementById("now-gauge");
  const fill = document.getElementById("now-fill");
  const detail = document.getElementById("now-detail");
  if (!card) return;

  // Unavailable / missing data: show an honest message and unhide the card.
  if (!blocked || blocked.available === false) {
    const reason =
      blocked && blocked.reason ? String(blocked.reason) : "no reason given";
    if (gauge) gauge.textContent = "n/a";
    if (fill) fill.style.width = "0%";
    if (detail) {
      detail.textContent =
        "Historical data is not available right now (" + reason + ").";
    }
    card.removeAttribute("hidden");
    return;
  }

  render(blocked, { card: card, gauge: gauge, fill: fill, detail: detail });
  card.removeAttribute("hidden");

  // Cheap refresh: recompute every 5 minutes so the hour/weekday stay current
  // if the page is left open. No network, just a recompute from in-memory data.
  if (!initNow._timer) {
    initNow._timer = setInterval(function () {
      render(blocked, { card: card, gauge: gauge, fill: fill, detail: detail });
    }, 5 * 60 * 1000);
  }
}

function render(blocked, els) {
  const pred = blocked.predictive || {};
  const byHour = Array.isArray(pred.by_hour) ? pred.by_hour : [];

  const now = new Date();
  const hour = now.getHours();
  // JS getDay(): 0=Sun..6=Sat. Convert to data convention 0=Mon..6=Sun.
  const jsDow = now.getDay();
  const dow = (jsDow + 6) % 7;

  // Base hourly probability for the current hour.
  let baseProb = 0;
  let maxHourlyProb = 0;
  if (byHour.length) {
    for (let i = 0; i < byHour.length; i++) {
      const p = Number(byHour[i] && byHour[i].prob) || 0;
      if (p > maxHourlyProb) maxHourlyProb = p;
    }
    const match = byHour.find(function (x) {
      return Number(x.hour) === hour;
    });
    baseProb = match ? Number(match.prob) || 0 : 0;
  }

  // Day-of-week factor: multiply by (this day's reports / mean across days),
  // clamped to a modest range so one busy weekday cannot wildly inflate the
  // estimate. This keeps the headline responsive but honest.
  let dowFactor = 1;
  const dowVals =
    blocked.by_dow && Array.isArray(blocked.by_dow.values)
      ? blocked.by_dow.values
      : [];
  if (dowVals.length === 7) {
    const sum = dowVals.reduce(function (a, b) {
      return a + (Number(b) || 0);
    }, 0);
    const mean = sum / 7;
    if (mean > 0) {
      dowFactor = clamp((Number(dowVals[dow]) || 0) / mean, 0.5, 1.6);
    }
  }

  let prob = clamp(baseProb * dowFactor, 0, 1);

  // ---- gauge percentage ----
  // These daily frequencies are small (often 1-2%). Show whole-percent, but
  // never round a real, nonzero chance down to "0%": floor at "<1%".
  if (els.gauge) {
    const pctNum = prob * 100;
    let pctText;
    if (prob <= 0) pctText = "0%";
    else if (pctNum < 1) pctText = "<1%";
    else pctText = Math.round(pctNum) + "%";
    els.gauge.textContent = pctText;
  }

  // ---- fill bar ----
  // Scale the bar against the busiest hour's probability (after applying the
  // same dow factor is not needed for the reference; we use raw max so the
  // single busiest hour reads near full). width = min(100, prob/max * 100).
  if (els.fill) {
    const ref = maxHourlyProb > 0 ? maxHourlyProb : prob;
    const width = ref > 0 ? clamp((prob / ref) * 100, 0, 100) : 0;
    els.fill.style.width = width.toFixed(0) + "%";
  }

  // ---- detail sentence ----
  if (els.detail) {
    const span = pred.date_span || blocked.date_span || {};
    const minYear = span.min ? String(span.min).slice(0, 4) : "?";
    const maxYear = span.max ? String(span.max).slice(0, 4) : "?";
    const n =
      Number(pred.total_incidents) || Number(blocked.row_count) || 0;

    const dayName = DOW_LABELS[dow] || "today";
    const hr = hourLabel12(hour);

    let sentence =
      "It is about " + hr + " on a " + dayName + ". ";

    const inN = oneInN(prob);
    if (prob > 0 && inN) {
      sentence +=
        "Historically, crossings near Pendleton have a reported blockage in this hour on roughly 1 in " +
        inN +
        " days (about " +
        (prob * 100 < 1 ? "under 1" : Math.round(prob * 100)) +
        " percent), based on " +
        n +
        " reports from " +
        minYear +
        " to " +
        maxYear +
        ".";
    } else {
      sentence +=
        "History shows very few reported blockages in this hour, based on " +
        n +
        " reports from " +
        minYear +
        " to " +
        maxYear +
        ".";
    }

    els.detail.textContent = sentence;
  }
}
