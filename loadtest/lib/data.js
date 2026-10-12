// Query-string helpers and deterministic param rotation for the harness.
//
// `qs()` is a hand-rolled encoder (no URLSearchParams dependency) that sorts
// keys so identical param objects always yield identical URLs — this makes
// cache-hit vs cache-miss behaviour predictable.

export function qs(params) {
  const parts = [];
  const keys = Object.keys(params || {}).sort();
  for (const key of keys) {
    const value = params[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

export function withQuery(base, params) {
  const query = qs(params);
  return query ? `${base}?${query}` : base;
}

// Rotate through a pool so consecutive iterations rarely repeat a param set.
// For the cached viz endpoints this deliberately defeats the Redis cache key so
// the DB cost of a cache miss is measured; pair it with `fixed` pools to
// measure cache-hit latency.
export function rotate(pool, iteration) {
  if (!pool || pool.length === 0) {
    return {};
  }
  return pool[iteration % pool.length];
}
