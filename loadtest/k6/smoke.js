// Stage 1 — smoke.
//
// 1-2 rps of health + one real search call for a few minutes. Gate before the
// ramp: 0 x 429, 0 x 5xx, 0 CF interference. Any failure auto-aborts.

import http from 'k6/http';
import { check } from 'k6';

import {
  API_BASE_URL,
  LOADTEST_TOKEN,
  TUNING,
  baselineThresholds,
  params,
  track,
} from '../config.js';
import { makeHandleSummary } from '../lib/summary.js';

const HEALTH_URL = `${API_BASE_URL}/health/`;
const SEARCH_URL = `${API_BASE_URL}/search/`;

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.SMOKE_RPS || 2),
      timeUnit: '1s',
      duration: __ENV.SMOKE_DURATION || '3m',
      preAllocatedVUs: 5,
      maxVUs: TUNING.maxVus,
    },
  },
  thresholds: Object.assign({}, baselineThresholds(), { http_reqs: ['count>0'] }),
};

export default function () {
  const health = track(http.get(HEALTH_URL, params({ endpoint: 'health' })));
  check(health, {
    'health status 200': (r) => r.status === 200,
    'health body healthy': (r) => r.status === 200 && r.body.indexOf('"healthy"') !== -1,
  });

  const search = track(
    http.get(
      `${SEARCH_URL}?q=esclavizada&type=personaesclavizada&page_size=30`,
      params({ endpoint: 'search' }),
    ),
  );
  check(search, {
    'search status 200': (r) => r.status === 200,
  });
}

export function handleSummary(data) {
  const label = LOADTEST_TOKEN ? 'smoke' : 'smoke-NO-TOKEN';
  return makeHandleSummary(label)(data);
}
