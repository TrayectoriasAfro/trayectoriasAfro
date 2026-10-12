#!/usr/bin/env node
// Expand the curated seed inventory into queries.json.
//
// Each section's `variation` axis is turned into a cartesian product and merged
// over every base param object. The result is what the k6 scenarios consume:
// `varying` pools change the cache key between iterations, `fixed` pools repeat
// the same URL to measure cache-hit latency.
//
// Usage: node loadtest/scripts/generate_queries.js
//        (reads loadtest/data/queries.seed.json, writes loadtest/data/queries.json)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SEED_PATH = path.join(DATA_DIR, 'queries.seed.json');
const OUT_PATH = path.join(DATA_DIR, 'queries.json');

function expand(base, variation) {
  const keys = Object.keys(variation || {});
  if (keys.length === 0) {
    return [Object.assign({}, base)];
  }
  let combos = [{}];
  for (const key of keys) {
    const next = [];
    for (const combo of combos) {
      for (const value of variation[key]) {
        next.push(Object.assign({}, combo, { [key]: value }));
      }
    }
    combos = next;
  }
  return combos.map((combo) => Object.assign({}, base, combo));
}

function expandSection(section) {
  const out = {};
  if (Array.isArray(section.fixed)) {
    out.fixed = section.fixed;
  }
  if (Array.isArray(section.varying)) {
    out.varying = section.varying.reduce((acc, base) => {
      return acc.concat(expand(base, section.variation));
    }, []);
  }
  if (Array.isArray(section.expensive)) {
    out.expensive = section.expensive;
  }

  // Drop empty sections and empty pools so scripts can feature-detect.
  for (const key of Object.keys(out)) {
    if (out[key].length === 0) {
      delete out[key];
    }
  }
  return out;
}

function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const result = {
    meta: Object.assign({}, seed.meta, {
      generated_at: new Date().toISOString(),
    }),
  };

  for (const section of Object.keys(seed)) {
    if (section === 'meta') {
      continue;
    }
    result[section] = expandSection(seed[section]);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n');

  const counts = Object.keys(result)
    .filter((key) => key !== 'meta')
    .map((key) => {
      const section = result[key];
      const pools = Object.keys(section)
        .map((pool) => `${pool}=${section[pool].length}`)
        .join(' ');
      return `  ${key}: ${pools}`;
    })
    .join('\n');
  console.log(`wrote ${OUT_PATH}\n${counts}`);
}

main();
