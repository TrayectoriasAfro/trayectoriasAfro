// Stage 2 (static) — SvelteKit bundle through the Cloudflare edge / frontend nginx.
//
// Fetches the landing HTML once in setup(), extracts the hashed /_app/ asset
// URLs, then requests a rotating subset. Each response is labelled by
// Cloudflare's cf-cache-status so edge-cached and origin-pass traffic are
// distinguishable — client latency here reflects the edge, not origin.

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

import {
  FRONTEND_URL,
  TUNING,
  header,
  latencyThreshold,
  params,
  track,
} from '../config.js';
import { makeHandleSummary } from '../lib/summary.js';

const edgeLatency = new Trend('edge_latency', true);

export const options = {
  scenarios: {
    static_assets: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.STATIC_RPS || 3),
      timeUnit: '1s',
      duration: __ENV.STATIC_DURATION || '10m',
      preAllocatedVUs: 10,
      maxVUs: TUNING.maxVus,
    },
  },
  thresholds: Object.assign(
    {},
    latencyThreshold('static', 800, 2000),
    {
      http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: TUNING.abortDelay }],
      error_429: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: TUNING.abortDelay }],
      cf_interference: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: TUNING.abortDelay }],
    },
  ),
};

export function setup() {
  const res = http.get(FRONTEND_URL + '/', params({ endpoint: 'static' }));
  track(res);

  const assets = [];
  const pattern = /["'(]((?:\/_app\/)[^"')\s]+\.(?:js|css))["')]/g;
  let match;
  while ((match = pattern.exec(res.body || '')) !== null) {
    if (assets.indexOf(match[1]) === -1) {
      assets.push(match[1]);
    }
  }
  return { assets, indexOk: res.status === 200 };
}

export default function (data) {
  const assets = data.assets && data.assets.length ? data.assets : [];
  if (assets.length === 0) {
    return;
  }
  const path = assets[__ITER % assets.length];
  const res = track(http.get(FRONTEND_URL + path, params({ endpoint: 'static' })));

  edgeLatency.add(res.timings.duration, {
    cache: String(header(res, 'cf-cache-status') || 'unknown').toLowerCase(),
  });

  check(res, {
    'asset 200 or 304': (r) => r.status === 200 || r.status === 304,
  });
}

export function handleSummary(data) {
  return makeHandleSummary('static')(data);
}
