#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "======== DigitalTwin.ai — run_all ========"

node harness/check_isolation.js
node plant/test_day1.js
node plant/test_day2.js
node harness/test_apm.js

# Day 4 lead-time (default N=40; LEAD_N=200 for paper figures)
if [[ "${SKIP_LEADTIME:-}" != "1" ]]; then
  LEAD_N="${LEAD_N:-40}" node harness/measure_leadtime.js
fi

# Day 5 detectors
if [[ "${SKIP_DETECT:-}" != "1" ]]; then
  DET_UNITS="${DET_UNITS:-320}" node harness/score_detectors.js
fi

# Day 6 virtual metrology (VIRT_N=200 for paper)
if [[ "${SKIP_VIRTUAL:-}" != "1" ]]; then
  VIRT_N="${VIRT_N:-40}" VIRT_UNITS="${VIRT_UNITS:-900}" node harness/calibrate_virtual.js
fi

# Day 7 APM validation
if [[ "${SKIP_APMVAL:-}" != "1" ]]; then
  APM_REPS="${APM_REPS:-6}" APM_UNITS="${APM_UNITS:-1100}" node harness/validate_apm.js
fi

node write_results.js >/dev/null
echo "======== all stages passed — see results.json ========"
