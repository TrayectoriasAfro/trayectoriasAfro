// Stage 2 (mix) — visualization endpoints, cache-miss vs cache-hit.
//
// Two concurrent scenarios run the same endpoint mix:
//   viz_cache_miss  rotates distinct querystrings (and, by default, appends a
//                   unique `_v` param) to force Redis misses and measure true
//                   DB cost. Set CACHE_BUST=0 to disable the `_v` buster.
//   viz_cache_hit   repeats a small fixed set of URLs to measure cache latency.
//
// Every request is tagged with `endpoint` and `cache` so the summary separates
// the two regimes.

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

const DATA = JSON.parse(open('../data/queries.json'));
const CACHE_BUST = __ENV.CACHE_BUST !== '0';

const ENDPOINTS = [
  { name: 'counts', base: `${API_BASE_URL}/counts/`, section: DATA.counts },
  { name: 'network', base: `${API_BASE_URL}/search/network/`, section: DATA.network },
  { name: 'crosstab', base: `${API_BASE_URL}/crosstab/`, section: DATA.crosstab },
  { name: 'aggregated', base: `${API_BASE_URL}/travel-trajectories/aggregated/`, section: DATA.aggregated },
  {
    name: 'places_people_distribution',
    base: `${API_BASE_URL}/places-people-distribution/`,
    section: DATA.places_people_distribution,
  },
];

function poolFor(endpoint, key) {
  if (endpoint.section && Array.isArray(endpoint.section[key])) {
    return endpoint.section[key];
  }
  return [{}];
}

const missEndpoints = ENDPOINTS.map((endpoint) => ({
  endpoint,
  pool: poolFor(endpoint, 'varying').length ? poolFor(endpoint, 'varying') : poolFor(endpoint, 'fixed'),
}));

const hitEndpoints = ENDPOINTS.map((endpoint) => ({
  endpoint,
  pool: poolFor(endpoint, 'fixed').length ? poolFor(endpoint, 'fixed') : poolFor(endpoint, 'varying'),
}));

function stageTarget(fraction) {
  return Math.max(1, Math.round(TUNING.maxRps * fraction));
}

export const options = {
  scenarios: {
    viz_cache_miss: {
      executor: 'ramping-arrival-rate',
      exec: 'miss',
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
    viz_cache_hit: {
      executor: 'constant-arrival-rate',
      exec: 'hit',
      rate: Number(__ENV.VIZ_HIT_RPS || 2),
      timeUnit: '1s',
      duration: __ENV.VIZ_HIT_DURATION || '10m',
      preAllocatedVUs: 5,
      maxVUs: Math.min(20, TUNING.maxVus),
    },
  },
  thresholds: Object.assign(
    {},
    baselineThresholds(),
    latencyThreshold('aggregated', 2500, 5000),
    { http_req_duration: [{ threshold: 'p(99)<3000', abortOnFail: true, delayAbortEval: '30s' }] },
  ),
};

function call(entry, cache, iteration) {
  let query = rotate(entry.pool, iteration);
  if (cache === 'miss' && CACHE_BUST) {
    query = Object.assign({}, query, { _v: String(iteration) });
  }
  const res = track(
    http.get(withQuery(entry.endpoint.base, query), params({ endpoint: entry.endpoint.name, cache })),
  );
  check(res, {
    [`${entry.endpoint.name} 200`]: (r) => r.status === 200,
  });
}

export function miss() {
  const entry = missEndpoints[__ITER % missEndpoints.length];
  call(entry, 'miss', __ITER);
}

export function hit() {
  const entry = hitEndpoints[__ITER % hitEndpoints.length];
  call(entry, 'hit', __ITER);
}

export function handleSummary(data) {
  return makeHandleSummary('viz-mix')(data);
}
