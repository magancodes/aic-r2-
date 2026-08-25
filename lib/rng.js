'use strict';

/** Seeded mulberry32 RNG. Every result must be reproducible from its seed. */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function uniform(lo, hi) {
    return lo + (hi - lo) * next();
  }
  function normal(mu, sd) {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mu + sd * z;
  }
  function lognormal(mean, cv) {
    // mean of the lognormal, cv = sd/mean
    const v = cv * cv;
    const sigma2 = Math.log(1 + v);
    const mu = Math.log(mean) - 0.5 * sigma2;
    return Math.exp(normal(mu, Math.sqrt(sigma2)));
  }
  function exponential(rate) {
    const u = Math.max(next(), Number.EPSILON);
    return -Math.log(u) / rate;
  }
  function bernoulli(p) {
    return next() < p;
  }
  function pick(arr) {
    return arr[Math.floor(next() * arr.length)];
  }
  return { next, uniform, normal, lognormal, exponential, bernoulli, pick, seed };
}

module.exports = { makeRng };
