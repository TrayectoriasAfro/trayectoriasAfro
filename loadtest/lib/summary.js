// Standalone reporting for the stress-test harness.
//
// No Grafana/Prometheus: each scenario's handleSummary writes a timestamped
// JSON + HTML report into RESULTS_DIR (default loadtest/results) and prints a
// compact text summary to stdout so the stage-gate decision is visible live.

const num = (v, digits) =>
  v === undefined || v === null ? '-' : Number(v).toFixed(digits === undefined ? 2 : digits);

function thresholdsFor(metric) {
  const result = [];
  const thresholds = (metric && metric.thresholds) || {};
  for (const expression in thresholds) {
    const ok = thresholds[expression] && thresholds[expression].ok;
    result.push({ expression, ok: ok !== false });
  }
  return result;
}

function renderText(label, data) {
  const metrics = data.metrics || {};
  const lines = [];
  lines.push('');
  lines.push(`=== ${label} summary ===`);

  const pick = (name) => metrics[name] && metrics[name].values;
  const httpReqs = pick('http_reqs');
  const failed = pick('http_req_failed');
  if (httpReqs) lines.push(`http_reqs..............: ${httpReqs.count}`);
  if (failed) lines.push(`http_req_failed........: ${num(failed.rate * 100)}%`);

  const duration = pick('http_req_duration');
  if (duration) {
    lines.push(
      `http_req_duration......: avg=${num(duration.avg)}ms p(95)=${num(duration['p(95)'])}ms ` +
        `p(99)=${num(duration['p(99)'])}ms max=${num(duration.max)}ms`,
    );
  }
  for (const name of ['error_5xx', 'error_429', 'cf_interference']) {
    const values = pick(name);
    if (values) lines.push(`${name.padEnd(22, '.')}: ${values.count}`);
  }
  for (const name in metrics) {
    if (name.indexOf('http_req_duration{') === 0) {
      const values = metrics[name].values;
      lines.push(`${name}: p(95)=${num(values['p(95)'])}ms p(99)=${num(values['p(99)'])}ms`);
    }
  }

  lines.push('thresholds:');
  let anyFail = false;
  for (const name in metrics) {
    const ths = thresholdsFor(metrics[name]);
    for (const t of ths) {
      if (!t.ok) anyFail = true;
      lines.push(`  [${t.ok ? 'PASS' : 'FAIL'}] ${name} ${t.expression}`);
    }
  }
  if (!anyFail) lines.push('  all thresholds passed');

  lines.push('');
  return lines.join('\n');
}

function renderHtml(label, data) {
  const metrics = data.metrics || {};
  const rows = [];
  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  for (const name in metrics) {
    const metric = metrics[name];
    const values = metric.values || {};
    let detail = '';
    for (const key in values) {
      detail += `${esc(key)}=${esc(num(values[key]))} `;
    }
    const ths = thresholdsFor(metric)
      .map((t) => `${t.ok ? 'PASS' : 'FAIL'} ${esc(t.expression)}`)
      .join('; ');
    rows.push(
      `<tr><td>${esc(name)}</td><td>${esc(detail.trim())}</td><td>${ths}</td></tr>`,
    );
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(label)} — stress test report</title>
<style>
body{font-family:system-ui,monospace;margin:2rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;font-size:.85rem;vertical-align:top}
th{background:#f2f2f2}
</style></head><body>
<h1>${esc(label)} — stress test report</h1>
<p>Generated ${esc(new Date().toISOString())}</p>
<table><thead><tr><th>metric</th><th>values</th><th>thresholds</th></tr></thead>
<tbody>${rows.join('')}</tbody></table>
</body></html>`;
}

// Returns a k6 handleSummary function writing `<label>-<timestamp>.{json,html}`.
export function makeHandleSummary(label) {
  return function (data) {
    const dir = __ENV.RESULTS_DIR || 'loadtest/results';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${dir}/${label}-${stamp}`;
    return {
      [`${base}.json`]: JSON.stringify(data, null, 2),
      [`${base}.html`]: renderHtml(label, data),
      stdout: renderText(label, data),
    };
  };
}
