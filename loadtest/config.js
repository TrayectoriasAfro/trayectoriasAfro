// Shared configuration for the trayectoriasAfro production read-path stress test.
//
// Every value is environment-overridable so the same scripts run across the
// smoke / ramp / spike stages without edits:
//
//   API_BASE_URL      API origin (default: production, through Cloudflare)
//   FRONTEND_URL      frontend origin (default: production, through Cloudflare)
//   LOADTEST_TOKEN    throttle bypass token; empty => bypass inert (expect 429)
//   MAX_VUS           hard cap on virtual users
//   MAX_RPS           hard cap on offered request rate
//   STAGE_HOLD        per-step hold during the ramp (e.g. "2m")
//   ABORT_DELAY       delayAbortEval grace period (e.g. "10s")
//   RESULTS_DIR       where handleSummary writes reports (default loadtest/results)
//
// Safety: read paths only. No script in this harness issues a write verb
// (see scripts/guard_no_writes.sh).

import { Counter } from 'k6/metrics';

const env = (key, fallback) =>
  __ENV[key] !== undefined && __ENV[key] !== '' ? __ENV[key] : fallback;

const num = (key, fallback) => Number(env(key, fallback));

export const API_BASE_URL = env('API_BASE_URL', 'https://db.trayectoriasafro.org/api/v2');
export const FRONTEND_URL = env('FRONTEND_URL', 'https://trayectoriasafro.org');

export const LOADTEST_TOKEN = env('LOADTEST_TOKEN', '');
export const LOADTEST_HEADER = 'X-Loadtest-Token';

export const TUNING = {
  maxVus: num('MAX_VUS', 50),
  maxRps: num('MAX_RPS', 20),
  stageHold: env('STAGE_HOLD', '2m'),
  abortDelay: env('ABORT_DELAY', '10s'),
  requestTimeout: env('REQUEST_TIMEOUT', '130s'),
};

// Custom metrics. error_429 and cf_interference are hard zero-tolerance:
// any 429 means the throttle bypass is missing/broken; any CF challenge means
// the runner allowlist rule is missing. Both abort the run.
export const metrics = {
  error5xx: new Counter('error_5xx'),
  error429: new Counter('error_429'),
  cfInterference: new Counter('cf_interference'),
};

// Case-insensitive header lookup (k6 canonicalises header names inconsistently).
export function header(res, name) {
  const target = name.toLowerCase();
  for (const key in res.headers) {
    if (key.toLowerCase() === target) {
      return res.headers[key];
    }
  }
  return undefined;
}

// Classify a response into the harness error metrics. Call after every request.
export function track(res) {
  if (res.status >= 500) {
    metrics.error5xx.add(1, { endpoint: res.url });
  }
  if (res.status === 429) {
    metrics.error429.add(1, { endpoint: res.url });
  }

  const mitigated = header(res, 'cf-mitigated');
  const server = String(header(res, 'server') || '').toLowerCase();
  const looksLikeChallenge =
    mitigated !== undefined ||
    (res.status === 403 && server.indexOf('cloudflare') !== -1);
  if (looksLikeChallenge) {
    metrics.cfInterference.add(1, { endpoint: res.url });
  }
  return res;
}

// Build k6 request params. Tags drive per-endpoint thresholds; the bypass
// token header is attached only when configured.
export function params(tags, headers) {
  const merged = { Accept: 'application/json' };
  for (const key in headers || {}) {
    merged[key] = headers[key];
  }
  if (LOADTEST_TOKEN) {
    merged[LOADTEST_HEADER] = LOADTEST_TOKEN;
  }
  return { headers: merged, tags: tags || {}, timeout: TUNING.requestTimeout };
}

// Zero-tolerance + 5xx thresholds shared by every scenario.
export function baselineThresholds() {
  const abort = TUNING.abortDelay;
  return {
    http_req_failed: [
      { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: abort },
    ],
    error_5xx: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: abort }],
    error_429: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: abort }],
    cf_interference: [
      { threshold: 'count==0', abortOnFail: true, delayAbortEval: abort },
    ],
  };
}

// Per-endpoint latency threshold on an `endpoint` tag.
export function latencyThreshold(endpoint, p95, p99) {
  const out = {};
  if (p95) {
    out[`http_req_duration{endpoint:${endpoint}}`] = [
      { threshold: `p(95)<${p95}`, abortOnFail: true, delayAbortEval: TUNING.abortDelay },
    ];
  }
  if (p99) {
    out[`http_req_duration{endpoint:${endpoint}}`] = (out[`http_req_duration{endpoint:${endpoint}}`] || []).concat([
      { threshold: `p(99)<${p99}`, abortOnFail: true, delayAbortEval: TUNING.abortDelay },
    ]);
  }
  return out;
}
