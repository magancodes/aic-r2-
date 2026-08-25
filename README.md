# DigitalTwin.ai

Two deliverables in one repo:

1. **Story dashboard** (Round 1) — static walkthrough at the repo root (`index.html`, `pages/`, `css/`, `js/`). Deployed on [Vercel](https://waterpark-enthusiasts-digital-twin.vercel.app).
2. **Round 2 prototype** (v0.7.0) — sensor-poor assembly-line digital twin engine.

## Story dashboard (local)

Open `index.html` in a browser, or:

```bash
python -m http.server 8765
```

Then visit http://127.0.0.1:8765/

### Deploy on Vercel

Static site — no build step, no environment variables. Import this repo at [vercel.com/new](https://vercel.com/new); `vercel.json` sets framework to none.

## Round 2 prototype

Two programs, one contract:

- `plant/` — synthetic factory (ground truth)
- `twin/` — estimator (events + layout only)
- `harness/` — scorer (only place allowed to see both)
- `lib/` — shared serial-line mechanics
- `ui/` — chapter 06 interactive demo

Current release: **0.7.0** (Days 1–7). See [CHANGELOG.md](CHANGELOG.md).

```bash
bash run_all.sh          # full suite
npm run test:fast        # days 1–3 only
npm run ui               # serve ui/ on :4173
```

Numbers quoted in the pitch must come from `results.json`.
