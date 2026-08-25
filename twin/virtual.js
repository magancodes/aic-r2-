'use strict';

/**
 * Virtual metrology for dark stations.
 * Per-unit transit from last instrumented before a dark run to first after
 * is measurable. Low-quantile transit ≈ sum(dark CT) when the downstream
 * station is not queueing; when it is (e.g. dark run feeding S22), shrink
 * toward layout std. Rank dark stations by value-of-information.
 */

const { NormalGamma } = require('./belief');

function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function darkRuns(layout) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < layout.n; i++) {
    const st = layout.stations[i];
    if (!st.instrumented) {
      if (!cur) {
        const before = i > 0 ? layout.stations[i - 1].id : null;
        cur = { stations: [st.id], idxs: [i], before, after: null };
      } else {
        cur.stations.push(st.id);
        cur.idxs.push(i);
      }
    } else if (cur) {
      cur.after = st.id;
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) {
    cur.after = null;
    runs.push(cur);
  }
  return runs;
}

function transitObservations(ingest, beforeId, afterId) {
  if (!beforeId || !afterId) return [];
  const before = ingest.cycles.get(beforeId) || [];
  const after = ingest.cycles.get(afterId) || [];
  const afterByUnit = new Map();
  for (const c of after) afterByUnit.set(c.unit, c);
  const out = [];
  for (const c of before) {
    const a = afterByUnit.get(c.unit);
    if (!a) continue;
    const transit = a.start - c.end;
    if (transit > 0 && transit < 7200) out.push({ unit: c.unit, transit, t: a.start });
  }
  return out;
}

/**
 * Estimate sum of dark cycle times from transit quantiles, shrunk to layout
 * std when downstream queueing inflates the minimum (ratio >> 1).
 */
function estimateSumCT(transits, stdSum) {
  if (!transits.length) {
    return { sum: stdSum, flow: stdSum, weight: 0, discord: 0 };
  }
  const flow = percentile(transits, 0.20);
  const ratio = flow / Math.max(1, stdSum);
  // Full trust near 0.85–1.15× std; collapse toward prior when ratio ≫ 1 (queueing)
  let trust = 1;
  if (ratio > 1.15) trust = 1 / (1 + Math.pow((ratio - 1.15) / 0.25, 2));
  if (ratio < 0.75) trust = 1 / (1 + Math.pow((0.75 - ratio) / 0.2, 2));
  const sum = trust * flow + (1 - trust) * stdSum;
  return { sum, flow, weight: trust, discord: Math.abs(flow - stdSum) };
}

function estimateDark(layout, ingest, opts = {}) {
  const sinceT = opts.sinceT != null ? opts.sinceT : 0;
  const runs = darkRuns(layout);
  const posteriors = new Map();
  const diagnostics = [];
  const estimates = {};

  for (const st of layout.stations) {
    if (!st.instrumented) posteriors.set(st.id, new NormalGamma(st.stdTime));
  }

  for (const run of runs) {
    const obs = transitObservations(ingest, run.before, run.after).filter(
      (o) => o.t >= sinceT
    );
    const stdSum = run.stations.reduce((a, id) => a + layout.stdTime(id), 0);
    const weights = run.stations.map((id) => layout.stdTime(id) / stdSum);
    const transits = obs.map((o) => o.transit);
    const { sum, flow, weight, discord } = estimateSumCT(transits, stdSum);

    // Pseudo-observations: a handful of updates at the shrunk estimate (not hundreds)
    const nPseudo = Math.max(3, Math.min(20, Math.floor(3 + weight * 12)));
    for (let i = 0; i < nPseudo; i++) {
      for (let j = 0; j < run.stations.length; j++) {
        const id = run.stations[j];
        posteriors.get(id).update(Math.max(5, sum * weights[j]));
      }
    }

    // 80% CI for the mean: analytic SE plus discord / √n epistemic term
    const nEff = Math.max(1, obs.length * weight);
    for (let j = 0; j < run.stations.length; j++) {
      const id = run.stations[j];
      const mu = sum * weights[j];
      const prior = layout.stdTime(id);
      // Process noise on CT (~5.5% CV in plant) + discord allocation
      const procSd = 0.06 * mu;
      const discordSd = (discord * weights[j]) / Math.sqrt(Math.max(1, nEff));
      const priorPull = (1 - weight) * Math.abs(mu - prior);
      // Calibrated floor: aim for ~80% coverage, not 100%
      const se = Math.max(
        0.028 * mu,
        Math.sqrt(
          (procSd * procSd) / Math.max(12, nEff * 0.08) +
            discordSd * discordSd +
            priorPull * priorPull * 0.2 +
            0.35
        )
      );
      const z80 = 1.2815515655446004;
      estimates[id] = {
        mean: mu,
        lo80: mu - z80 * se,
        hi80: mu + z80 * se,
        ci80: [mu - z80 * se, mu + z80 * se],
        varianceMu: se * se,
        nEff,
        trust: weight,
      };
      // Keep posterior mean aligned for VOI
      const post = posteriors.get(id);
      post.mu = mu;
    }

    diagnostics.push({
      stations: run.stations.slice(),
      before: run.before,
      after: run.after,
      nObs: obs.length,
      flow,
      stdSum,
      sum,
      trust: weight,
      discord,
    });
  }

  return { estimates, posteriors, runs, diagnostics };
}

function valueOfInformation(layout, ingest, opts = {}) {
  const { estimates, runs } = estimateDark(layout, ingest, opts);
  const ranked = [];

  for (const run of runs) {
    const totalVar = run.stations.reduce(
      (a, id) => a + (estimates[id].varianceMu || 0),
      0
    );
    for (const id of run.stations) {
      const v = estimates[id].varianceMu || 0;
      const k = run.stations.length;
      const siblingShrink = k > 1 ? ((k - 1) / k) * (totalVar - v) : 0;
      const voi = v + (totalVar - v - siblingShrink);
      // Prefer low-trust (queue-contaminated) stations — highest sensor value
      const trustPenalty = 1 + 2 * (1 - (estimates[id].trust || 0));
      ranked.push({
        station: id,
        run: run.stations.slice(),
        varianceMu: v,
        voi: voi * trustPenalty,
        meanCT: estimates[id].mean,
        ci80: estimates[id].ci80,
        trust: estimates[id].trust,
      });
    }
  }

  ranked.sort((a, b) => b.voi - a.voi);
  return ranked;
}

module.exports = {
  darkRuns,
  transitObservations,
  estimateDark,
  valueOfInformation,
  percentile,
  estimateSumCT,
};
