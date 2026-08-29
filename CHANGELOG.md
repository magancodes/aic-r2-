# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [0.7.1] — 2026-08-29

Honesty and rigor pass on the Day 5 detector, the Day 4 forecast, and the
isolation gate. No plant physics or twin model was changed; the measured story
is now reported the way a reviewer would want to see it.

### Changed
- **Day 5 detector metrics reported honestly.** The old headline ("AUC 0.987,
  FAR 0.59%") hid a 7% per-weld precision. `harness/score_detectors.js` now
  reports, in addition to ROC-AUC, the **average precision** (honest under the
  ~12-in-17k class imbalance) and classifies every alert three ways: confirmed
  scrap, pre-scrap early warning on the known worn electrode, or genuine false
  alarm. Result: **92% of alerts are genuine electrode wear**, with only 9
  genuine false alarms in ~13k normal welds (genuine FAR ≈ 0.07%). Adds a
  precision–recall threshold sweep and a **recommended operating point** that
  catches all scrap ~8 min before the first scrap weld, plus an incident view.
- **Day 4 forecast rollout rewritten.** `twin/forecast.js` no longer nests a
  fresh `SerialLine` per one-unit slice inside a guarded loop; it runs one
  rollout per sample and takes the momentary bottleneck via line callbacks.
  Same lead-time result (median ≈ 12 min), much clearer code.
- **Isolation gate hardened.** `harness/check_isolation.js` scans code with
  comments stripped (so explanatory docstrings are not false positives),
  reports `file:line` and the reason for each violation, and drops a dead
  no-op branch.

### Added
- `twin/detect.js`: `Detector.clusterIncidents()` collapses raw alerts into the
  sustained incidents an operator actually sees.

## [0.7.0] — 2026-08-22

Round 2 prototype complete through Day 7 (rehearsal day is Day 8).

### Added
- Day 5 weld detectors: DR features, Isolation Forest, autoencoder, SPC baseline, `harness/score_detectors.js`
- Day 6 virtual metrology for dark stations + value-of-information ranking, `harness/calibrate_virtual.js`
- Day 7 persona UI (`ui/`) and Roser APM validation (`harness/validate_apm.js`)
- Shared `lib/serialline.js` for plant/twin rollouts; isolation gate allows `lib/`

### Measured (see `results.json`)
- Day 1–3 plant / APM baselines
- Day 4 forecast lead time ~12 min median
- Day 5 detector AUC 0.987, FAR 0.59%
- Day 6 80% CI coverage 80.4% (n=40)
- Day 7 APM improvement validated on S22

## [0.4.0] — 2026-08-22

Days 1–4 plant, twin belief/forecast, and lead-time harness.
