'use strict';

/**
 * Resistance spot weld (RSW) dynamic-resistance curve synthesis.
 * Tip mushrooms → tip face area grows → current density falls → DR curve sits LOWER.
 * Do not flip this direction.
 */

const DR_SAMPLES = 41; // 1 ms apart

function synthesizeDR(rng, tipRatio, fitUp, noiseScale) {
  // Nominal healthy curve (µΩ): rise → min → secondary peak → end
  const scale = 1 / tipRatio; // worn tip → lower curve
  const fit = fitUp;
  const base = [
    180, 165, 140, 118, 102, 92, 86, 82, 80, 79, 78.5, 79, 81, 84, 88, 93, 97, 100, 101.5, 102,
    101, 99, 96, 93, 90, 88, 86, 85, 84.5, 84, 83.5, 83, 82.5, 82, 81.5, 81, 80.5, 80, 79.5, 79, 78.5,
  ];
  const dr = new Array(DR_SAMPLES);
  for (let i = 0; i < DR_SAMPLES; i++) {
    const n = rng.normal(0, noiseScale);
    dr[i] = Math.max(20, (base[i] * scale * (0.92 + 0.08 * fit)) + n);
  }
  return dr;
}

/** 12 geometric features — plant-side only; twin reimplements from raw dr. */
function extractFeatures(dr) {
  const n = dr.length;
  let rMin = Infinity, tMin = 0, rPeak2 = -Infinity, tPeak2 = 0;
  for (let i = 0; i < n; i++) {
    if (dr[i] < rMin) { rMin = dr[i]; tMin = i; }
  }
  for (let i = tMin; i < n; i++) {
    if (dr[i] > rPeak2) { rPeak2 = dr[i]; tPeak2 = i; }
  }
  const rInitial = dr[0];
  const rEnd = dr[n - 1];
  const totalFall = rInitial - rMin;
  const peakProminence = rPeak2 - rMin;
  let auc = 0;
  for (let i = 0; i < n; i++) auc += dr[i];
  let mean = auc / n;
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

module.exports = { synthesizeDR, extractFeatures, DR_SAMPLES };
