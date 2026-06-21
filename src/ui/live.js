// Train Vantage - Layer 3 live front end.
//
// Fetches /api/live and reflects the live state into:
//   - #live-banner  the discreet sidebar banner
//   - #live-detail  the explainer / recent-detection list in the Live & ETA tab
//
// Default (configured:false): subtle grey banner saying live alarms are not
// wired in yet, and an explainer pointing at the watchtower + Supabase env.
// Configured + detections: active (green) banner with the latest detection,
// a recent-detection list, and a defensive call to map.showLiveTrain(d) for
// each row so the map can render the train if that hook exists.
//
// This module is a safe no-op on any error: a fetch failure is treated as
// "not configured" so the rest of the app is never affected.

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function describe(d) {
  // Build a short human summary of a detection row.
  const dir = d && d.direction ? String(d.direction) : 'a train';
  const where =
    d && d.milepost != null ? 'MP ' + escapeHtml(d.milepost) : 'a detector';
  const eta =
    d && Number.isFinite(Number(d.eta_downtown_min))
      ? 'about ' + Math.round(Number(d.eta_downtown_min)) + ' min to downtown'
      : 'heading toward downtown';
  const cap = dir.charAt(0).toUpperCase() + dir.slice(1);
  return cap + ' train detected at ' + where + ', ' + eta + '.';
}

function showNotConfigured(reason) {
  const banner = el('live-banner');
  if (banner) {
    banner.classList.remove('active');
    banner.innerHTML =
      '<span class="dot"></span>' +
      '<span>No live radio detector is configured yet, so live alarms are not wired in yet. ' +
      'Train Vantage is showing the map, the history, and the history-based odds.</span>';
    banner.hidden = false;
  }
  const detail = el('live-detail');
  if (detail) {
    detail.innerHTML =
      '<p class="hint">The live-alert layer is built and ready to plug in, but it is off by default. ' +
      'To turn it on, run the local watchtower pipeline (an RTL-SDR radio that listens to the wayside ' +
      'detector calls on 160.410 MHz, transcribes them, and posts each detection) and point the app at a ' +
      'detection store by setting the <code>SUPABASE_URL</code>, <code>SUPABASE_KEY</code>, and ' +
      '<code>INGEST_TOKEN</code> environment variables. Until then, the heads-up table below is the model ' +
      'that would drive those live alerts.</p>';
  }
}

function showConfigured(detections, opts) {
  const list = Array.isArray(detections) ? detections : [];
  const banner = el('live-banner');

  if (!list.length) {
    // Configured but quiet: keep it subtle, no active state.
    if (banner) {
      banner.classList.remove('active');
      banner.innerHTML =
        '<span class="dot"></span>' +
        '<span>Live detector feed is connected. No train detected in the last few reports.</span>';
      banner.hidden = false;
    }
    const detailQuiet = el('live-detail');
    if (detailQuiet) {
      detailQuiet.innerHTML =
        '<p class="hint">A live detector feed is connected. No recent detections to show. ' +
        'The heads-up table below is the ETA model behind these alerts.</p>';
    }
    return;
  }

  const latest = list[0];
  if (banner) {
    banner.classList.add('active');
    banner.innerHTML =
      '<span class="dot"></span><span>' + escapeHtml(describe(latest)) + '</span>';
    banner.hidden = false;
  }

  const items = list
    .map((d) => {
      const when =
        d && d.detected_at ? escapeHtml(d.detected_at) : 'recently';
      const defect =
        d && d.defect
          ? ' <strong style="color:var(--warning);">defect flagged</strong>'
          : '';
      return (
        '<li style="margin:6px 0;line-height:1.4;">' +
        escapeHtml(describe(d)) +
        ' <span class="k" style="color:var(--muted);">(' +
        when +
        ')</span>' +
        defect +
        '</li>'
      );
    })
    .join('');

  const detail = el('live-detail');
  if (detail) {
    detail.innerHTML =
      '<p class="hint">Live detector feed connected. Recent detections:</p>' +
      '<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--text);">' +
      items +
      '</ul>';
  }

  // Defensive map hook for each recent detection.
  const map = opts && opts.map;
  if (map && typeof map.showLiveTrain === 'function') {
    list.forEach((d) => {
      try {
        map.showLiveTrain(d);
      } catch (e) {
        // A bad row must not break the rest.
      }
    });
  }
}

export async function initLive(opts) {
  try {
    let data = null;
    try {
      const res = await fetch('/api/live');
      if (res && res.ok) {
        data = await res.json();
      }
    } catch (e) {
      data = null;
    }

    if (!data || data.configured !== true) {
      showNotConfigured(data && data.reason);
      return;
    }

    showConfigured(data.detections, opts);
  } catch (e) {
    // Last-resort safety: fall back to the subtle banner, never throw.
    try {
      showNotConfigured();
    } catch (_) {
      // give up silently
    }
  }
}
