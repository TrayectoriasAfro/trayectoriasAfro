// Stage 3 — spike (optional, small).
//
// A short step up to SPIKE_RPS, held briefly, then a graceful ramp back down.
// Kept small for the first production run: a near-instant step reveals
// queueing weakness (only 3 gunicorn workers) and recovery behaviour.
//
// Latency thresholds are armed but with a longer delayAbortEval than the ramp,
// since a spike is expected to raise tail latency.

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
import { makeHandleSummary } from '../lib/summary.js';

const HEALTH_URL = `${API_BASE_URL}/health/`;
const SEARCH_URL = `${API_BASE_URL}/search/?q=esclavizada&type=personaesclavizada&page_size=30`;

const baseRate = Number(__ENV.SPIKE_BASE_RPS || 2);
const spikeRate = Number(__ENV.SPIKE_RPS || TUNING.maxRps);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: baseRate,
      timeUnit: '1s',
      preAllocatedVUs: Math.min(20, TUNING.maxVus),
      maxVUs: TUNING.maxVus,
      stages: [
        { target: baseRate, duration: __ENV.SPIKE_WARMUP || '1m' },
        { target: spikeRate, duration: __ENV.SPIKE_RISE || '30s' },
        { target: spikeRate, duration: __ENV.SPIKE_HOLD || '30s' },
        { target: baseRate, duration: __ENV.SPIKE_FALL || '1m' },
      ],
    },
  },
  thresholds: Object.assign(
    {},
    baselineThresholds(),
    latencyThreshold('search', 1500, 3000),
    { http_req_duration: [{ threshold: 'p(99)<3000', abortOnFail: true, delayAbortEval: '30s' }] },
  ),
};

export default function () {
  if (__ITER % 5 === 0) {
    const health = track(http.get(HEALTH_URL, params({ endpoint: 'health' })));
    check(health, { 'health 200': (r) => r.status === 200 });
    return;
  }
  const search = track(http.get(SEARCH_URL, params({ endpoint: 'search' })));
  check(search, { 'search 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  return makeHandleSummary('spike')(data);
}
