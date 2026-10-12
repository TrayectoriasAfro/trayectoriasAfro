// Stage 2 — search ramp (stress).
//
// Ramps offered request rate in steps toward MAX_RPS against the uncached
// /search/ endpoint (the true DB-stress target). Params rotate every iteration
// so browsing is realistic; a configurable share of iterations runs a
// deliberately expensive query class, tagged separately so its cost is
// attributable.
//
// Thresholds abort the run on a sustained p95/p99 breach, any 429 (bypass
// broken) or any CF interference (allowlist missing).

import http from 'k6/http';
import { check } from 'k6';

import {
  API_BASE_URL,
  TUNING,
  baselineThresholds,
  latencyThreshold,
  params,
  track,
} from '../config.js';
import { rotate, withQuery } from '../lib/data.js';
import { makeHandleSummary } from '../lib/summary.js';

const SEARCH_URL = `${API_BASE_URL}/search/`;
const DATA = JSON.parse(open('../data/queries.json'));

const varyingPool = (DATA.search && DATA.search.varying) || [];
const expensivePool = (DATA.search && DATA.search.expensive) || [];
const expensiveShare = Number(__ENV.EXPENSIVE_SHARE || 0.1);

function stageTarget(fraction) {
  return Math.max(1, Math.round(TUNING.maxRps * fraction));
}

export const options = {
  scenarios: {
    search_stress: {
      executor: 'ramping-arrival-rate',
      startRate: stageTarget(0.25),
      timeUnit: '1s',
      preAllocatedVUs: Math.min(20, TUNING.maxVus),
      maxVUs: TUNING.maxVus,
      stages: [
        { target: stageTarget(0.25), duration: TUNING.stageHold },
        { target: stageTarget(0.5), duration: TUNING.stageHold },
        { target: stageTarget(0.75), duration: TUNING.stageHold },
        { target: stageTarget(1), duration: TUNING.stageHold },
      ],
    },
  },
  thresholds: Object.assign(
    {},
    baselineThresholds(),
    latencyThreshold('search', 1500, 3000),
    latencyThreshold('search_expensive', 3000, 6000),
    { http_req_duration: [{ threshold: 'p(99)<3000', abortOnFail: true, delayAbortEval: '30s' }] },
  ),
};

export default function () {
  const expensive = expensivePool.length > 0 && __ITER % Math.max(2, Math.round(1 / expensiveShare)) === 0;
  const pool = expensive ? expensivePool : varyingPool;
  const query = rotate(pool, __ITER);
  const endpoint = expensive ? 'search_expensive' : 'search';

  const res = track(http.get(withQuery(SEARCH_URL, query), params({ endpoint })));
  check(res, {
    'search 200': (r) => r.status === 200,
  });
}

export function handleSummary(data) {
  return makeHandleSummary('search-stress')(data);
}
