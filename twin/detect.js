'use strict';

/**
 * Combine Isolation Forest + autoencoder + SPC control limits.
 * Emits alerts with station, gun estimate, score, timestamp.
 */

const { extractFeatures, featureVector, FEATURE_KEYS } = require('./features');
const { IsolationForest } = require('./iforest');
const { Autoencoder } = require('./autoencoder');
const { makeRng } = require('../lib/rng');

function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

class SPCBaseline {
  fit(vectors) {
    const d = vectors[0].length;
    this.mu = new Array(d);
    this.sigma = new Array(d);
    for (let j = 0; j < d; j++) {
      const col = vectors.map((v) => v[j]);
      this.mu[j] = mean(col);
      this.sigma[j] = Math.max(1e-6, sd(col));
    }
    return this;
  }

  /** Max |z| across features — higher = more anomalous. */
  score(vec) {
    let maxZ = 0;
    for (let j = 0; j < vec.length; j++) {
      const z = Math.abs((vec[j] - this.mu[j]) / this.sigma[j]);
      if (z > maxZ) maxZ = z;
    }
    return maxZ;
  }
}

class Detector {
  /**
   * @param {object} layout
   * @param {object} [opts]
   */
  constructor(layout, opts = {}) {
    this.layout = layout;
    this.opts = opts;
    this.iforest = new IsolationForest({
      nTrees: opts.nTrees || 100,
      subsample: opts.subsample || 256,
    });
    this.ae = new Autoencoder({
      hidden: opts.hidden || 4,
      lr: opts.lr || 0.04,
      epochs: opts.epochs || 25,
    });
    this.spc = new SPCBaseline();
    this.thresholds = {
      iforest: opts.iforestThreshold != null ? opts.iforestThreshold : 0.62,
      ae: opts.aeThreshold != null ? opts.aeThreshold : null, // set after fit
      spc: opts.spcThreshold != null ? opts.spcThreshold : 3.5,
    };
    this.trained = false;
  }

  gunEstimate(stationId, spot) {
    const cfg = this.layout.weldStations[stationId];
    if (!cfg) return 0;
    return spot % cfg.guns;
  }

  /**
   * Train on normal-only weld feature vectors (warm-up window).
   * @param {Array<{dr:number[]}>} welds
   * @param {object} rng
   */
  fit(welds, rng) {
    const vectors = [];
    for (const w of welds) {
      if (!w.dr || !w.dr.length) continue;
      vectors.push(featureVector(extractFeatures(w.dr)));
    }
    if (vectors.length < 50) {
      throw new Error(`Detector.fit needs ≥50 normal welds, got ${vectors.length}`);
    }
    // Cap training size for speed
    const cap = Math.min(vectors.length, 4000);
    const train = [];
    for (let i = 0; i < cap; i++) {
      train.push(vectors[Math.floor((i * vectors.length) / cap)]);
    }

    this.iforest.fit(train, rng);
    this.ae.fit(train, rng);
    this.spc.fit(train);

    // AE threshold = 99th pct of training reconstruction error
    const aeScores = train.map((v) => this.ae.score(v));
    this.thresholds.ae =
      this.opts.aeThreshold != null ? this.opts.aeThreshold : percentile(aeScores, 0.99);
    // Operating thresholds: high-precision point on the ROC (trust on the floor)
    if (this.opts.iforestThreshold == null) {
      const ifScores = train.map((v) => this.iforest.score(v));
      this.thresholds.iforest = percentile(ifScores, 0.999);
    }
    this.trained = true;
    return this;
  }

  scoreWeld(weld) {
    const feat = extractFeatures(weld.dr);
    const vec = featureVector(feat);
    const ifs = this.iforest.score(vec);
    const aes = this.ae.score(vec);
    const spcs = this.spc.score(vec);
    const flags = {
      iforest: ifs >= this.thresholds.iforest,
      ae: aes >= this.thresholds.ae,
      spc: spcs >= this.thresholds.spc,
    };
    // Primary score is Isolation Forest (best ROC on DR features); AE confirms.
    const aeNorm = aes / Math.max(this.thresholds.ae, 1e-9);
    const score = Math.min(1, 0.75 * ifs + 0.25 * Math.min(1, aeNorm * 0.5));
    const combined = flags.iforest || (flags.ae && ifs >= this.thresholds.iforest * 0.9);
    return {
      station: weld.s || weld.station,
      unit: weld.unit != null ? weld.unit : weld.u,
      spot: weld.spot,
      t: weld.t,
      gun: this.gunEstimate(weld.s || weld.station, weld.spot),
      features: feat,
      scores: { iforest: ifs, ae: aes, spc: spcs, combined: score },
      flags,
      alert: combined,
      spcAlert: flags.spc,
    };
  }

  /**
   * Score all welds from an Ingest (or raw weld list).
   * @returns {{alerts: object[], scored: object[]}}
   */
  detect(welds) {
    if (!this.trained) throw new Error('Detector not trained');
    const scored = [];
    const alerts = [];
    for (const w of welds) {
      if (!w.dr) continue;
      const row = this.scoreWeld(w);
      scored.push(row);
      if (row.alert) {
        alerts.push({
          station: row.station,
          gun: row.gun,
          score: row.scores.combined,
          iforest: row.scores.iforest,
          ae: row.scores.ae,
          t: row.t,
          unit: row.unit,
          spot: row.spot,
          method: row.flags.iforest && row.flags.ae ? 'both' : row.flags.iforest ? 'iforest' : 'ae',
        });
      }
    }
    return { alerts, scored };
  }

  /** Flatten welds map from Ingest into a list with station id. */
  static weldsFromIngest(ingest) {
    const out = [];
    for (const [sid, rows] of ingest.welds) {
      for (const w of rows) out.push({ s: sid, t: w.t, unit: w.unit, spot: w.spot, dr: w.dr });
    }
    return out;
  }

  /**
   * Collapse a raw alert stream into incidents an operator would actually see.
   * Consecutive alerts on the same (station, gun) whose unit index is within
   * `gapUnits` of the previous one belong to the same sustained alarm.
   * @param {object[]} alerts rows with {station, gun, unit, t, score}
   * @param {object} [opts]
   * @param {number} [opts.gapUnits=8] max unit gap that still counts as one incident
   * @returns {Array<{station,gun,startUnit,endUnit,startT,endT,count,peakScore}>}
   */
  static clusterIncidents(alerts, opts = {}) {
    const gapUnits = opts.gapUnits != null ? opts.gapUnits : 8;
    const sorted = alerts
      .slice()
      .sort((a, b) =>
        a.station === b.station
          ? a.gun === b.gun
            ? a.unit - b.unit
            : a.gun - b.gun
          : String(a.station).localeCompare(String(b.station))
      );
    const incidents = [];
    let cur = null;
    for (const a of sorted) {
      if (
        cur &&
        cur.station === a.station &&
        cur.gun === a.gun &&
        a.unit - cur.endUnit <= gapUnits
      ) {
        cur.endUnit = a.unit;
        cur.endT = a.t;
        cur.count += 1;
        cur.peakScore = Math.max(cur.peakScore, a.score);
      } else {
        cur = {
          station: a.station,
          gun: a.gun,
          startUnit: a.unit,
          endUnit: a.unit,
          startT: a.t,
          endT: a.t,
          count: 1,
          peakScore: a.score,
        };
        incidents.push(cur);
      }
    }
    return incidents;
  }
}

function trainDetector(layout, normalWelds, seed = 7) {
  const det = new Detector(layout);
  det.fit(normalWelds, makeRng(seed));
  return det;
}

module.exports = {
  Detector,
  SPCBaseline,
  trainDetector,
  FEATURE_KEYS,
  percentile,
  mean,
  sd,
};
