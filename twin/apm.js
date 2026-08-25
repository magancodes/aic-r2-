'use strict';

/**
 * Active Period Method (Roser, Nakano & Tanaka, WSC 2001/2002).
 */

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

/** 95% CI half-width using normal approx. */
function ci95(xs) {
  const n = xs.length;
  if (n < 2) return { mean: mean(xs), sd: 0, ci: 0, lo: mean(xs), hi: mean(xs), n };
  const m = mean(xs);
  const sd = sampleSd(xs);
  const ci = 1.96 * sd / Math.sqrt(n);
  return { mean: m, sd, ci, lo: m - ci, hi: m + ci, n };
}

function periodsInWindow(periods, fromT, toT, { excludeStraddle = false } = {}) {
  const out = [];
  for (const p of periods) {
    if (excludeStraddle) {
      // Exclude periods that straddle the warm-up boundary (do not clip).
      if (p.start < fromT && p.end > fromT) continue;
      if (p.end <= fromT || p.start >= toT) continue;
      out.push(p.end - p.start);
    } else {
      const a = Math.max(p.start, fromT);
      const b = Math.min(p.end, toT);
      if (b > a) out.push(b - a);
    }
  }
  return out;
}

function averageActivePeriods(ingest, fromT, toT) {
  const rows = [];
  for (const id of ingest.observedStations()) {
    const periods = ingest.activePeriods.get(id) || [];
    // Clip to window for averages (straddle-exclude is only for shiftingBottlenecks).
    const durs = periodsInWindow(periods, fromT, toT, { excludeStraddle: false });
    const stats = ci95(durs);
    rows.push({
      station: id,
      avgActive: stats.mean,
      median: median(durs),
      p90: percentile(durs, 0.9),
      sd: stats.sd,
      ci: stats.ci,
      n: stats.n,
      lo: stats.lo,
      hi: stats.hi,
    });
  }
  return rows.sort((a, b) => b.avgActive - a.avgActive);
}

function utilisationRanking(ingest, fromT, toT) {
  const span = toT - fromT;
  const rows = [];
  for (const id of ingest.observedStations()) {
    const cycles = ingest.cycles.get(id) || [];
    let busy = 0;
    for (const c of cycles) {
      const a = Math.max(c.start, fromT);
      const b = Math.min(c.end, toT);
      if (b > a) busy += b - a;
    }
    const pct = span > 0 ? (100 * busy) / span : 0;
    // Bootstrap-ish CI via treating cycle contributions — use normal approx on binary occupancy samples
    // Simpler: Wilson-like from time fraction with effective n = span / meanCT
    const meanCT = cycles.length ? mean(cycles.map((c) => c.end - c.start)) : 50;
    const nEff = Math.max(2, span / meanCT);
    const p = pct / 100;
    const se = 100 * Math.sqrt((p * (1 - p)) / nEff);
    const ci = 1.96 * se;
    rows.push({ station: id, pct, ci, lo: pct - ci, hi: pct + ci, nEff });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

function separates(rows, key) {
  if (rows.length < 2) {
    return { separated: true, overlap: false, sigmaGap: Infinity, top: rows[0], second: null };
  }
  const top = rows[0];
  const second = rows[1];
  const gap = top[key] - second[key];
  const ciTop = top.ci || 0;
  const ciSec = second.ci || 0;
  const pooled = Math.sqrt(ciTop * ciTop + ciSec * ciSec) / 1.96 || 1e-9;
  const sigmaGap = gap / pooled;
  const overlap = top.lo < second.hi && second.lo < top.hi;
  return {
    separated: !overlap && sigmaGap > 1.5,
    overlap,
    sigmaGap,
    top,
    second,
  };
}

/** Momentary bottleneck at time t: station with longest ongoing active period. */
function momentaryAt(ingest, t) {
  let best = null;
  let bestElapsed = -1;
  for (const id of ingest.observedStations()) {
    const periods = ingest.activePeriods.get(id) || [];
    for (const p of periods) {
      if (p.start <= t && t <= p.end) {
        const elapsed = t - p.start;
        if (elapsed > bestElapsed) {
          bestElapsed = elapsed;
          best = { station: id, elapsed, period: p };
        }
      }
    }
    // Also check open cycle still running
    // (active periods only close on end — open work is in _open, not exposed;
    //  approximate from cycles that contain t)
    const cycles = ingest.cycles.get(id) || [];
    for (const c of cycles) {
      if (c.start <= t && t <= c.end) {
        // find merged period covering this
        const elapsed = t - c.start;
        // prefer period-based; skip if already covered
      }
    }
  }
  return best || { station: null, elapsed: 0, period: null };
}

/**
 * Shifting bottleneck analysis over [fromT, toT].
 * Periods that would straddle fromT are force-split at fromT (elapsed resets),
 * so fill-phase multi-hour stretches cannot dominate — without dropping the
 * true bottleneck that runs continuously through the boundary.
 */
function shiftingBottlenecks(ingest, fromT, toT) {
  const stations = ingest.observedStations();
  const soleTime = new Map();
  const shiftingTime = new Map();
  for (const s of stations) {
    soleTime.set(s, 0);
    shiftingTime.set(s, 0);
  }

  const segments = [];
  for (const id of stations) {
    const periods = ingest.activePeriods.get(id) || [];
    for (const p of periods) {
      if (p.end <= fromT || p.start >= toT) continue;
      // Force-split at fromT: in-window segment starts at max(start, fromT)
      const a = Math.max(p.start, fromT);
      const b = Math.min(p.end, toT);
      if (b > a) segments.push({ id, start: a, end: b, fullStart: a });
    }
  }

  const times = new Set([fromT, toT]);
  for (const seg of segments) {
    times.add(seg.start);
    times.add(seg.end);
  }
  const T = [...times].sort((a, b) => a - b);
  const timeline = [];

  for (let i = 0; i < T.length - 1; i++) {
    const t0 = T[i];
    const t1 = T[i + 1];
    const mid = 0.5 * (t0 + t1);
    const dt = t1 - t0;
    if (dt <= 0) continue;

    const live = [];
    for (const seg of segments) {
      if (seg.start <= mid && mid < seg.end) {
        live.push({ id: seg.id, elapsed: mid - seg.fullStart });
      }
    }
    if (!live.length) continue;
    live.sort((a, b) => b.elapsed - a.elapsed);
    const top = live[0];

    if (live.length >= 2) {
      const second = live[1];
      const gap = top.elapsed - second.elapsed;
      if (gap / Math.max(top.elapsed, 1e-9) < 0.25) {
        shiftingTime.set(top.id, shiftingTime.get(top.id) + dt);
        shiftingTime.set(second.id, shiftingTime.get(second.id) + dt);
        timeline.push({ t: t0, t1, sole: null, shifting: [top.id, second.id] });
        continue;
      }
    }
    soleTime.set(top.id, soleTime.get(top.id) + dt);
    timeline.push({ t: t0, t1, sole: top.id, shifting: [] });
  }

  const span = toT - fromT;
  const summary = stations.map((s) => {
    const sole = soleTime.get(s) || 0;
    const sh = shiftingTime.get(s) || 0;
    return {
      station: s,
      solePct: span > 0 ? (100 * sole) / span : 0,
      shiftingPct: span > 0 ? (100 * sh) / span : 0,
      totalPct: span > 0 ? (100 * (sole + sh)) / span : 0,
    };
  }).sort((a, b) => b.totalPct - a.totalPct);

  let handoffs = 0;
  let prevSole = null;
  for (const row of timeline) {
    if (row.shifting && row.shifting.length) {
      handoffs += 1;
      prevSole = null;
    } else if (row.sole && prevSole && row.sole !== prevSole) {
      handoffs += 1;
      prevSole = row.sole;
    } else if (row.sole) {
      prevSole = row.sole;
    }
  }

  return { timeline, summary, handoffs, span };
}

/**
 * If station is bottleneck X% of time, 1s improvement → ~X s improvement in mean IAT,
 * bounded by sole% .. sole%+shifting%.
 */
function predictImprovement(summary, station, ds = 1) {
  const row = summary.find((r) => r.station === station);
  if (!row) return { lowerBound: 0, upperBound: 0, solePct: 0, totalPct: 0 };
  const lowerBound = (row.solePct / 100) * ds;
  const upperBound = (row.totalPct / 100) * ds;
  return {
    lowerBound,
    upperBound,
    solePct: row.solePct,
    totalPct: row.totalPct,
  };
}

module.exports = {
  averageActivePeriods,
  utilisationRanking,
  separates,
  momentaryAt,
  shiftingBottlenecks,
  predictImprovement,
  mean,
  median,
  percentile,
  sampleSd,
  ci95,
};
