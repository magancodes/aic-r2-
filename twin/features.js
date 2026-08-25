'use strict';

/**
 * 12 geometric DR features — computed from the raw `dr` array in weld events.
 * Reimplemented here (not imported from the plant weld synthesizer) so twin/ stays isolated.
 */

const FEATURE_KEYS = [
  'r_initial',
  'r_min',
  't_min',
  'r_peak2',
  't_peak2',
  'r_end',
  'total_fall',
  'peak_prominence',
  'auc',
  'sd',
  'slope_early',
  'slope_late',
];

function extractFeatures(dr) {
  const n = dr.length;
  let rMin = Infinity;
  let tMin = 0;
  let rPeak2 = -Infinity;
  let tPeak2 = 0;
  for (let i = 0; i < n; i++) {
    if (dr[i] < rMin) {
      rMin = dr[i];
      tMin = i;
    }
  }
  for (let i = tMin; i < n; i++) {
    if (dr[i] > rPeak2) {
      rPeak2 = dr[i];
      tPeak2 = i;
    }
  }
  const rInitial = dr[0];
  const rEnd = dr[n - 1];
  const totalFall = rInitial - rMin;
  const peakProminence = rPeak2 - rMin;
  let auc = 0;
  for (let i = 0; i < n; i++) auc += dr[i];
  const mean = auc / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (dr[i] - mean) ** 2;
  const sd = Math.sqrt(varSum / n);
  const earlyN = Math.max(2, Math.floor(n / 3));
  const late0 = Math.floor((2 * n) / 3);
  const slopeEarly = (dr[earlyN - 1] - dr[0]) / (earlyN - 1);
  const slopeLate = (dr[n - 1] - dr[late0]) / Math.max(1, n - 1 - late0);
  return {
    r_initial: rInitial,
    r_min: rMin,
    t_min: tMin,
    r_peak2: rPeak2,
    t_peak2: tPeak2,
    r_end: rEnd,
    total_fall: totalFall,
    peak_prominence: peakProminence,
    auc,
    sd,
    slope_early: slopeEarly,
    slope_late: slopeLate,
  };
}

function featureVector(feat) {
  return FEATURE_KEYS.map((k) => feat[k]);
}

module.exports = { extractFeatures, featureVector, FEATURE_KEYS };
