# DigitalTwin.ai — Round 2 prototype

Sensor-poor assembly-line digital twin. Two programs, one contract:

- `plant/` — synthetic factory (ground truth)
- `twin/` — estimator (events + layout only)
- `harness/` — scorer (only place allowed to see both)
- `lib/` — shared serial-line mechanics
- `ui/` — chapter 06 interactive demo

## Version

Current release: **0.7.0** (Days 1–7). See [CHANGELOG.md](CHANGELOG.md).

## Run

```bash
bash run_all.sh          # full suite
npm run test:fast        # days 1–3 only
npm run ui               # serve ui/ on :4173
```

Numbers quoted in the pitch must come from `results.json`.
