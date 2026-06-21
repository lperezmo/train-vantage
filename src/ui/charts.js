// charts.js - Layer 2 history charts for Train Vantage.
// Renders the #history-summary intro and a set of .chart blocks into #charts,
// all from public/data/blocked.json (passed in as `blocked`).
// No external chart libraries: charts are plain DOM (.bar-row) or inline SVG.
// Honest framing throughout: these are self-reported FRA blocked-crossing
// reports used for historical patterns only, not live train status.

// ---- small helpers -------------------------------------------------------

// Downtown public crossings cluster around lat 45.66-45.68, lng -118.78..-118.80
// (the closest dense public ones sit near lng -118.81 to -118.85). The biggest
// reporter is street "PRIVATE" near Cayuse, well EAST of town (lng ~ -118.586),
// which is a private crossing, not a downtown public street. We label each
// crossing as Downtown, Private, or Outside so the chart is honest.
function classifyCrossing(c) {
  if (!c) return "Outside";
  const street = String(c.street || "").trim().toUpperCase();
  if (street === "PRIVATE") return "Private";
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 45.66 &&
    lat <= 45.68 &&
    lng <= -118.78 &&
    lng >= -118.86
  ) {
    return "Downtown";
  }
  return "Outside";
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch];
  });
}

function truncate(s, n) {
  s = String(s == null ? "" : s);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

function titleCaseStreet(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  // Leave clearly-uppercase labels readable: convert to Title Case.
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, function (m, c) {
      return c.toUpperCase();
    });
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function hourLabel(h) {
  h = ((Number(h) % 24) + 24) % 24;
  const ampm = h < 12 ? "AM" : "PM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return hh + " " + ampm;
}

function isArr(a) {
  return Array.isArray(a);
}

// Build one horizontal bar row. value is scaled against max.
function barRowHtml(label, value, max, opts) {
  opts = opts || {};
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = opts.color || "var(--accent)";
  const labTitle = opts.title ? ' title="' + escapeHtml(opts.title) + '"' : "";
  const num = opts.numText != null ? opts.numText : String(value);
  return (
    '<div class="bar-row">' +
    '<span class="lab"' + labTitle + ">" + escapeHtml(label) + "</span>" +
    '<span class="track"><span class="val" style="width:' +
    pct.toFixed(1) +
    "%;background:" +
    color +
    ';"></span></span>' +
    '<span class="num">' + escapeHtml(num) + "</span>" +
    "</div>"
  );
}

// Make a .chart block element with a heading and honest sub-caption.
function chartBlock(title, sub, innerHtml) {
  const el = document.createElement("div");
  el.className = "chart";
  el.innerHTML =
    "<h3>" + escapeHtml(title) + "</h3>" +
    '<p class="sub">' + escapeHtml(sub) + "</p>" +
    innerHtml;
  return el;
}

// ---- main export ---------------------------------------------------------

export function initCharts(blocked) {
  const summaryEl = document.getElementById("history-summary");
  const chartsEl = document.getElementById("charts");
  if (!summaryEl && !chartsEl) return; // nothing to fill

  // Defensive: no data, or explicitly unavailable.
  if (!blocked || blocked.available === false) {
    const reason =
      blocked && blocked.reason ? String(blocked.reason) : "no reason given";
    if (summaryEl) {
      summaryEl.innerHTML =
        "Historical data is not available right now (" +
        escapeHtml(reason) +
        ").";
    }
    if (chartsEl) chartsEl.innerHTML = "";
    return;
  }

  if (chartsEl) chartsEl.innerHTML = "";

  // ---- summary paragraph ----
  if (summaryEl) {
    summaryEl.innerHTML = buildSummaryHtml(blocked);
  }

  if (!chartsEl) return;

  // 1. Most-blocked crossings
  const byCrossing = isArr(blocked.by_crossing) ? blocked.by_crossing : [];
  if (byCrossing.length) {
    const top = byCrossing.slice(0, 8);
    const max = top.reduce(function (m, c) {
      return Math.max(m, Number(c.count) || 0);
    }, 0);
    let rows = "";
    top.forEach(function (c) {
      const kind = classifyCrossing(c);
      const color =
        kind === "Downtown"
          ? "var(--warning)"
          : kind === "Private"
          ? "var(--muted)"
          : "var(--accent)";
      const niceStreet = titleCaseStreet(c.street) || "(unknown)";
      const label = truncate(niceStreet, 14);
      rows += barRowHtml(label, Number(c.count) || 0, max, {
        color: color,
        title: niceStreet + " (" + kind + ")",
      });
    });
    const block = chartBlock(
      "Most-reported crossings",
      "Self-reported FRA reports by crossing. Orange = downtown public; gray = a private crossing east of town; blue = other public.",
      rows
    );
    chartsEl.appendChild(block);
  }

  // 2. By hour of day
  const byHour = isArr(blocked.by_hour) ? blocked.by_hour : [];
  if (byHour.length === 24) {
    const max = byHour.reduce(function (m, v) {
      return Math.max(m, Number(v) || 0);
    }, 0);
    const peakHour = byHour.indexOf(max);
    chartsEl.appendChild(
      chartBlock(
        "Reports by hour of day",
        "When reports come in (local time). Peak is around " +
          hourLabel(peakHour) +
          ".",
        hourSvg(byHour, max)
      )
    );
  }

  // 3. By day of week
  const dow = blocked.by_dow && isArr(blocked.by_dow.values) ? blocked.by_dow.values : [];
  if (dow.length === 7) {
    const max = dow.reduce(function (m, v) {
      return Math.max(m, Number(v) || 0);
    }, 0);
    let rows = "";
    dow.forEach(function (v, i) {
      rows += barRowHtml(DOW_LABELS[i], Number(v) || 0, max, {
        color: "var(--accent)",
      });
    });
    const peakIdx = dow.indexOf(max);
    chartsEl.appendChild(
      chartBlock(
        "Reports by day of week",
        "Busiest reporting day is " + DOW_LABELS[peakIdx] + ".",
        rows
      )
    );
  }

  // 4. By month
  const month = blocked.by_month && isArr(blocked.by_month.values) ? blocked.by_month.values : [];
  if (month.length === 12) {
    const max = month.reduce(function (m, v) {
      return Math.max(m, Number(v) || 0);
    }, 0);
    let rows = "";
    month.forEach(function (v, i) {
      rows += barRowHtml(MONTH_LABELS[i], Number(v) || 0, max, {
        color: "var(--accent-2)",
      });
    });
    chartsEl.appendChild(
      chartBlock(
        "Reports by month",
        "Seasonal pattern across all years on record.",
        rows
      )
    );
  }

  // 5. Duration distribution
  const durs = isArr(blocked.duration_buckets) ? blocked.duration_buckets : [];
  if (durs.length) {
    const max = durs.reduce(function (m, d) {
      return Math.max(m, Number(d.count) || 0);
    }, 0);
    let rows = "";
    durs.forEach(function (d) {
      rows += barRowHtml(String(d.label || ""), Number(d.count) || 0, max, {
        color: "var(--accent)",
      });
    });
    chartsEl.appendChild(
      chartBlock(
        "How long blockages lasted",
        "Reported duration of each blockage.",
        rows
      )
    );
  }

  // 6. Reasons (top ~5)
  const reasons = isArr(blocked.reasons) ? blocked.reasons : [];
  if (reasons.length) {
    const top = reasons.slice(0, 5);
    const max = top.reduce(function (m, r) {
      return Math.max(m, Number(r.count) || 0);
    }, 0);
    let rows = "";
    top.forEach(function (r) {
      const full = String(r.reason || "");
      rows += barRowHtml(truncate(full, 16), Number(r.count) || 0, max, {
        color: "var(--muted)",
        title: full,
      });
    });
    chartsEl.appendChild(
      chartBlock(
        "Reported reasons",
        "What the reporter said was happening. Most are a stationary train.",
        rows
      )
    );
  }

  // 7. Likelihood heatmap (7 rows Mon..Sun x 24 cols hour 0..23)
  const heat = blocked.hour_dow_heat;
  if (heat && isArr(heat.values) && heat.values.length === 168) {
    chartsEl.appendChild(
      chartBlock(
        "When reports cluster (day x hour)",
        "Each cell is a day-of-week and hour. Darker red = more reports over all years.",
        heatGridHtml(heat.values)
      )
    );
  }
}

// ---- summary builder -----------------------------------------------------

function buildSummaryHtml(blocked) {
  const total = Number(blocked.row_count) || 0;
  const span = blocked.date_span || {};
  const minYear = span.min ? String(span.min).slice(0, 4) : "?";
  const maxYear = span.max ? String(span.max).slice(0, 4) : "?";

  // Top downtown public crossing (skip private/outside for the headline).
  const byCrossing = isArr(blocked.by_crossing) ? blocked.by_crossing : [];
  let topDowntown = null;
  for (let i = 0; i < byCrossing.length; i++) {
    if (classifyCrossing(byCrossing[i]) === "Downtown") {
      topDowntown = byCrossing[i];
      break;
    }
  }

  // Peak hours from by_hour.
  let peakHourText = "";
  const byHour = isArr(blocked.by_hour) ? blocked.by_hour : [];
  if (byHour.length === 24) {
    const max = byHour.reduce(function (m, v) {
      return Math.max(m, Number(v) || 0);
    }, 0);
    const peak = byHour.indexOf(max);
    peakHourText =
      " Reports peak around <strong>" + escapeHtml(hourLabel(peak)) + "</strong>.";
  }

  let topText = "";
  if (topDowntown) {
    topText =
      " The most-reported downtown public crossing is <strong>" +
      escapeHtml(titleCaseStreet(topDowntown.street)) +
      "</strong> (<strong>" +
      (Number(topDowntown.count) || 0) +
      "</strong> reports).";
  }

  return (
    "<strong>" +
    total +
    "</strong> self-reported blocked-crossing reports near Pendleton, from <strong>" +
    escapeHtml(minYear) +
    "</strong> to <strong>" +
    escapeHtml(maxYear) +
    "</strong>." +
    topText +
    peakHourText +
    " These are unverified public reports, shown for historical patterns only, not live train status."
  );
}

// ---- SVG hour chart ------------------------------------------------------

function hourSvg(values, max) {
  // 24 vertical bars in a responsive SVG using a viewBox so it scales to the
  // sidebar width. Label the hour axis at 0, 6, 12, 18.
  const W = 240;
  const H = 90;
  const padBottom = 14;
  const padTop = 4;
  const n = 24;
  const gap = 1.5;
  const barW = (W - (n - 1) * gap) / n;
  const usableH = H - padBottom - padTop;

  let bars = "";
  for (let h = 0; h < n; h++) {
    const v = Number(values[h]) || 0;
    const bh = max > 0 ? (v / max) * usableH : 0;
    const x = h * (barW + gap);
    const y = padTop + (usableH - bh);
    const isPeak = v === max && max > 0;
    const fill = isPeak ? "var(--warning)" : "var(--accent)";
    bars +=
      '<rect x="' +
      x.toFixed(2) +
      '" y="' +
      y.toFixed(2) +
      '" width="' +
      barW.toFixed(2) +
      '" height="' +
      Math.max(0, bh).toFixed(2) +
      '" rx="1" fill="' +
      fill +
      '"><title>' +
      hourLabel(h) +
      ": " +
      v +
      " reports</title></rect>";
  }

  let axis = "";
  [0, 6, 12, 18].forEach(function (h) {
    const x = h * (barW + gap) + barW / 2;
    axis +=
      '<text x="' +
      x.toFixed(2) +
      '" y="' +
      (H - 3) +
      '" text-anchor="middle" class="heat-axis" fill="var(--muted)" font-size="8">' +
      hourLabel(h) +
      "</text>";
  });

  return (
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" aria-label="Reports by hour of day">' +
    bars +
    axis +
    "</svg>"
  );
}

// ---- heatmap -------------------------------------------------------------

function heatColor(v, max) {
  // Interpolate panel -> warning -> danger as the count rises.
  if (!(max > 0) || v <= 0) return "var(--panel)";
  const t = Math.min(1, v / max);
  // panel ~ (20,27,34); warning ~ (245,166,35); danger ~ (239,68,68)
  const panel = [20, 27, 34];
  const warning = [245, 166, 35];
  const danger = [239, 68, 68];
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = panel[0] + (warning[0] - panel[0]) * u;
    g = panel[1] + (warning[1] - panel[1]) * u;
    b = panel[2] + (warning[2] - panel[2]) * u;
  } else {
    const u = (t - 0.5) / 0.5;
    r = warning[0] + (danger[0] - warning[0]) * u;
    g = warning[1] + (danger[1] - warning[1]) * u;
    b = warning[2] + (danger[2] - warning[2]) * u;
  }
  return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";
}

function heatGridHtml(values) {
  // values: 168 ints, index = dow*24 + hour, dow 0=Mon..6=Sun.
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]) || 0;
    if (v > max) max = v;
  }

  // Layout: one row label column + 24 hour columns, then a 7-row data grid.
  // We build it as a single grid: 25 columns (label + 24 hours).
  let html =
    '<div class="heat-grid" style="grid-template-columns:18px repeat(24,1fr);">';

  for (let d = 0; d < 7; d++) {
    // Row label (day initial).
    html +=
      '<div class="heat-axis" style="display:flex;align-items:center;justify-content:center;">' +
      DOW_LABELS[d][0] +
      "</div>";
    for (let h = 0; h < 24; h++) {
      const v = Number(values[d * 24 + h]) || 0;
      const color = heatColor(v, max);
      html +=
        '<div class="heat-cell" style="background:' +
        color +
        ';" title="' +
        escapeHtml(DOW_LABELS[d] + " " + hourLabel(h) + ": " + v + " reports") +
        '"></div>';
    }
  }

  html += "</div>";

  // Hour axis under the grid (0, 6, 12, 18 aligned to columns).
  html +=
    '<div class="heat-grid" style="grid-template-columns:18px repeat(24,1fr);margin-top:3px;">' +
    '<div></div>';
  for (let h = 0; h < 24; h++) {
    let lab = "";
    if (h === 0 || h === 6 || h === 12 || h === 18) lab = String(h);
    html +=
      '<div class="heat-axis" style="text-align:center;">' + lab + "</div>";
  }
  html += "</div>";

  return html;
}
