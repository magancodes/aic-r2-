'use strict';

/**
 * Normal-Gamma conjugate posterior on cycle time per station.
 * Prior mean from layout standard time, kappa0=5, alpha0=2.
 * Maintains full-history and rolling-window posteriors.
 * Posterior predictive is Student-t.
 */

const KAPPA0 = 5;
const ALPHA0 = 2;

function logGamma(z) {
  // Lanczos approximation
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776533,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.984369654078991e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

class NormalGamma {
  /**
   * @param {number} mu0 prior mean
   * @param {number} [kappa0]
   * @param {number} [alpha0]
   * @param {number} [beta0] prior rate; default so prior sd ≈ 0.1 * mu0
   */
  constructor(mu0, kappa0 = KAPPA0, alpha0 = ALPHA0, beta0 = null) {
    this.mu = mu0;
    this.kappa = kappa0;
    this.alpha = alpha0;
    const priorSd = Math.max(0.5, 0.1 * mu0);
    // E[1/τ] = beta/(alpha-1) for alpha>1 → var ≈ that
    this.beta = beta0 != null ? beta0 : priorSd * priorSd * (alpha0 - 1);
  }

  update(x) {
    const mu = this.mu;
    const kappa = this.kappa;
    const alpha = this.alpha;
    const beta = this.beta;
    const kappa1 = kappa + 1;
    const mu1 = (kappa * mu + x) / kappa1;
    const alpha1 = alpha + 0.5;
    const beta1 = beta + 0.5 * (kappa / kappa1) * (x - mu) * (x - mu);
    this.mu = mu1;
    this.kappa = kappa1;
    this.alpha = alpha1;
    this.beta = beta1;
  }

  /** Posterior mean of μ */
  mean() {
    return this.mu;
  }

  /** Posterior variance of μ (marginal) */
  varianceMu() {
    // Var(μ) = beta / (kappa * (alpha - 1)) for alpha > 1
    if (this.alpha <= 1) return Infinity;
    return this.beta / (this.kappa * (this.alpha - 1));
  }

  /**
   * Draw from posterior predictive (Student-t).
   * X_new | data ~ t_{2α}(μ, β(κ+1)/(κ α))
   */
  predictiveDraw(rng) {
    const nu = 2 * this.alpha;
    const scale = Math.sqrt((this.beta * (this.kappa + 1)) / (this.kappa * this.alpha));
    const z = studentT(rng, nu);
    return Math.max(0.01, this.mu + scale * z);
  }

  /** Quantile of posterior predictive via Student-t approx */
  predictiveQuantile(p) {
    const nu = 2 * this.alpha;
    const scale = Math.sqrt((this.beta * (this.kappa + 1)) / (this.kappa * this.alpha));
    const t = approxTQuantile(p, nu);
    return this.mu + scale * t;
  }

  clone() {
    const c = new NormalGamma(this.mu, this.kappa, this.alpha, this.beta);
    return c;
  }
}

function studentT(rng, nu) {
  if (nu === Infinity || nu > 1e6) return rng.normal(0, 1);
  // Bailey's method / ratio: Z / sqrt(V/nu) where V~chi2(nu)
  const z = rng.normal(0, 1);
  // chi2(nu) ≈ Gamma(nu/2, 1/2) — sample via sum of squares for small nu, else Wilson-Hilferty
  let v;
  if (nu <= 30) {
    v = 0;
    const nInt = Math.floor(nu);
    for (let i = 0; i < nInt; i++) {
      const g = rng.normal(0, 1);
      v += g * g;
    }
    const frac = nu - nInt;
    if (frac > 0.01) {
      // incomplete — scale
      v = v + frac * rng.normal(0, 1) ** 2;
    }
  } else {
    const a = rng.normal(0, 1);
    const w = 1 - 2 / (9 * nu) + a * Math.sqrt(2 / (9 * nu));
    v = nu * w * w * w;
  }
  return z / Math.sqrt(v / nu);
}

function approxTQuantile(p, nu) {
  // Hill's approximation via normal
  const z = approxNormQuantile(p);
  if (nu > 1e5) return z;
  const g1 = (z * z * z + z) / (4 * nu);
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * nu * nu);
  return z + g1 + g2;
}

function approxNormQuantile(p) {
  // Acklam rational approximation
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614436e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447923739394907e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (phigh < p) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

class Belief {
  /**
   * @param {object} layout
   * @param {object} [opts]
   */
  constructor(layout, opts = {}) {
    this.layout = layout;
    this.windowSec = opts.windowSec != null ? opts.windowSec : 30 * 60; // rolling 30 min
    this.full = new Map();
    this.rolling = new Map();
    this._rollingObs = new Map(); // station -> [{t, x}]

    for (const st of layout.stations) {
      if (!st.instrumented) continue;
      this.full.set(st.id, new NormalGamma(st.stdTime));
      this.rolling.set(st.id, new NormalGamma(st.stdTime));
      this._rollingObs.set(st.id, []);
    }
  }

  observe(stationId, cycleTime, t) {
    const full = this.full.get(stationId);
    if (!full) return; // dark — ignored here
    full.update(cycleTime);

    const obs = this._rollingObs.get(stationId);
    obs.push({ t, x: cycleTime });
    const cutoff = t - this.windowSec;
    while (obs.length && obs[0].t < cutoff) obs.shift();

    // Rebuild rolling posterior from window (simple, correct)
    const st = this.layout.station(stationId);
    const roll = new NormalGamma(st.stdTime);
    for (const o of obs) roll.update(o.x);
    this.rolling.set(stationId, roll);
  }

  /** Ingest cycles from twin Ingest object */
  updateFromIngest(ingest, sinceT = 0) {
    for (const id of ingest.observedStations()) {
      const cycles = ingest.cycles.get(id) || [];
      for (const c of cycles) {
        if (c.start < sinceT) continue;
        this.observe(id, c.end - c.start, c.end);
      }
    }
    return this;
  }

  posterior(stationId, which = 'full') {
    const map = which === 'rolling' ? this.rolling : this.full;
    return map.get(stationId) || null;
  }

  /** Point estimate (posterior mean) for instrumented; layout std for dark. */
  meanCT(stationId, which = 'rolling') {
    const p = this.posterior(stationId, which);
    if (p) return p.mean();
    return this.layout.stdTime(stationId);
  }

  /** Sampler for SerialLine rollouts — uses rolling predictive. */
  makeSampler(rng, which = 'rolling') {
    const self = this;
    return function cycleTimeFn(stationIdx, unitSeq) {
      const st = self.layout.stations[stationIdx];
      const post = self.posterior(st.id, which);
      if (post) return post.predictiveDraw(rng);
      // Dark: use layout std with mild noise from prior predictive
      const prior = new NormalGamma(st.stdTime);
      return prior.predictiveDraw(rng);
    };
  }

  driftScore(stationId) {
    const f = this.full.get(stationId);
    const r = this.rolling.get(stationId);
    if (!f || !r) return 0;
    return (r.mean() - f.mean()) / Math.max(1, f.mean());
  }
}

module.exports = {
  Belief,
  NormalGamma,
  KAPPA0,
  ALPHA0,
  studentT,
  approxTQuantile,
  logGamma,
};
