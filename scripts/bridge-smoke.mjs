#!/usr/bin/env node
/**
 * Bridge smoke matrix (P16). Exit 0 only if selected steps pass.
 * Usage:
 *   node scripts/bridge-smoke.mjs           # full matrix
 *   node scripts/bridge-smoke.mjs --quick   # health + models + one completion
 */
const BASE = process.env.CURSOR_BRIDGE_URL || 'http://127.0.0.1:8787/v1';
const KEY = process.env.CURSOR_BRIDGE_KEY || 'local-bridge-key';
const QUICK = process.argv.includes('--quick');
const args = new Set(process.argv.slice(2));

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${KEY}`,
    'content-type': 'application/json',
    'x-dpp-client': 'hermes',
    ...extra,
  };
}

async function chat(body, headers = {}) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(headers),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function textOf(json) {
  return json?.choices?.[0]?.message?.content || '';
}

async function main() {
  const failures = [];
  const log = (step, ok, detail) => {
    console.log(`${ok ? 'OK' : 'FAIL'} ${step}`, detail || '');
    if (!ok) failures.push(step);
  };

  // H — health
  const healthRes = await fetch(`${BASE}/health`);
  const health = await healthRes.json();
  const r = health.readiness || {};
  const countBefore = r.accountCount ?? 0;
  log('H health', Boolean(health.ok || r.extensionAlive), {
    ok: health.ok,
    ready: r.ready,
    accountCount: countBefore,
    queueDepth: health.queueDepth,
    lastJob: health.lastJob || r.lastJob || null,
  });

  // M — models
  const modelsRes = await fetch(`${BASE}/models`);
  const models = await modelsRes.json();
  const ids = (models.data || []).map((m) => m.id);
  const need = ['ds/octopus', 'ds/octopus-eyes', 'ds/squid', 'ds/eni'];
  log('M models', need.every((n) => ids.includes(n)), ids);

  if (!r.ready && !r.hasLogin) {
    console.error('FAIL not ready for completion', r);
    process.exit(1);
  }

  // C1 — completion
  const c1 = await chat({
    model: 'ds/octopus',
    stream: false,
    reset_thread: true,
    messages: [{ role: 'user', content: 'Reply with exactly one word: smoke-ok' }],
  });
  const c1text = textOf(c1.json);
  const threadId = c1.res.headers.get('x-dpp-thread-id') || c1.json.system_fingerprint || '';
  const sticky1 = c1.res.headers.get('x-dpp-sticky') || '';
  const account1 = c1.res.headers.get('x-dpp-account-id') || '';
  log(
    'C1 completion',
    !c1.json.error && c1.res.status === 200 && c1text.trim().length > 0,
    { status: c1.res.status, text: c1text.slice(0, 80), threadId, sticky: sticky1, accountId: account1 },
  );

  if (QUICK) {
    if (failures.length) {
      console.error('SMOKE FAIL', failures);
      process.exit(1);
    }
    console.log('SMOKE PASS (quick)');
    return;
  }

  // S — sticky turn 2
  if (threadId) {
    const c2 = await chat({
      model: 'ds/octopus',
      stream: false,
      messages: [
        { role: 'user', content: 'Reply with exactly one word: smoke-ok' },
        { role: 'assistant', content: c1text || 'smoke-ok' },
        { role: 'user', content: 'Reply with exactly one word: sticky-ok' },
      ],
    }, { 'x-dpp-thread-id': threadId });
    const sticky2 = c2.res.headers.get('x-dpp-sticky') || '';
    const account2 = c2.res.headers.get('x-dpp-account-id') || '';
    const t2 = textOf(c2.json);
    const stickyOk = !c2.json.error && c2.res.status === 200 && t2.trim().length > 0;
    const pinOk = !account1 || !account2 || account1 === account2;
    log('S sticky', stickyOk && pinOk, { sticky: sticky2, account1, account2, text: t2.slice(0, 60) });
  } else {
    log('S sticky', false, 'missing thread id from C1');
  }

  // Q — two parallel completions (queue)
  const [q1, q2] = await Promise.all([
    chat({
      model: 'ds/squid',
      stream: false,
      reset_thread: true,
      messages: [{ role: 'user', content: 'Reply with exactly one word: q1' }],
    }),
    chat({
      model: 'ds/squid',
      stream: false,
      reset_thread: true,
      messages: [{ role: 'user', content: 'Reply with exactly one word: q2' }],
    }),
  ]);
  log(
    'Q concurrent',
    q1.res.status === 200 && q2.res.status === 200 && !q1.json.error && !q2.json.error,
    { s1: q1.res.status, s2: q2.res.status },
  );

  // T — OpenAI tools shape (may return tool_calls or text)
  const t = await chat({
    model: 'ds/octopus',
    stream: false,
    reset_thread: true,
    messages: [{ role: 'user', content: 'Do not call tools. Reply with exactly one word: tools-ok' }],
    tools: [{
      type: 'function',
      function: {
        name: 'noop_probe',
        description: 'Do not use unless asked',
        parameters: { type: 'object', properties: { x: { type: 'string' } } },
      },
    }],
  });
  const tMsg = t.json?.choices?.[0]?.message || {};
  const toolsOk = t.res.status === 200 && !t.json.error && (
    (typeof tMsg.content === 'string' && tMsg.content.trim().length > 0)
    || Array.isArray(tMsg.tool_calls)
  );
  log('T tools-shape', toolsOk, {
    status: t.res.status,
    finish: t.json?.choices?.[0]?.finish_reason,
    hasToolCalls: Array.isArray(tMsg.tool_calls),
  });

  // E — eni one-liner
  const e = await chat({
    model: 'ds/eni',
    stream: false,
    reset_thread: true,
    messages: [{ role: 'user', content: 'Reply with exactly one word: eni-ok' }],
  });
  log(
    'E eni',
    e.res.status === 200 && !e.json.error && textOf(e.json).trim().length > 0,
    { status: e.res.status, text: textOf(e.json).slice(0, 60) },
  );

  // V — vault count stable
  const health2 = await (await fetch(`${BASE}/health`)).json();
  const countAfter = health2.readiness?.accountCount ?? 0;
  log('V vault-stable', countAfter >= countBefore && countAfter > 0, {
    before: countBefore,
    after: countAfter,
    lastJob: health2.lastJob || health2.readiness?.lastJob,
  });

  if (failures.length) {
    console.error('SMOKE FAIL', failures);
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
