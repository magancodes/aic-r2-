# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

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
