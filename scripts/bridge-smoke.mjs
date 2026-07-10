#!/usr/bin/env node
/**
 * One-command bridge smoke (no Cursor required).
 * Exit 0 only if health + models + a real non-stream completion succeed.
 */
const BASE = process.env.CURSOR_BRIDGE_URL || 'http://127.0.0.1:8787/v1';
const KEY = process.env.CURSOR_BRIDGE_KEY || 'local-bridge-key';

async function main() {
  const healthRes = await fetch(`${BASE}/health`);
  const health = await healthRes.json();
  if (!health.ok && !health.readiness?.extensionAlive) {
    console.error('FAIL health', health);
    process.exit(1);
  }
  console.log('OK health', {
    ok: health.ok,
    models: health.models,
    queueDepth: health.queueDepth,
    features: health.features,
  });

  const modelsRes = await fetch(`${BASE}/models`);
  const models = await modelsRes.json();
  const ids = (models.data || []).map((m) => m.id);
  for (const need of ['ds/octopus', 'ds/octopus-eyes', 'ds/squid']) {
    if (!ids.includes(need)) {
      console.error('FAIL missing model', need, ids);
      process.exit(1);
    }
  }
  console.log('OK models', ids);

  if (!health.readiness?.ready && !health.readiness?.hasLogin) {
    console.error('FAIL not ready for completion', health.readiness);
    process.exit(1);
  }

  const prompt =
    'In 4-6 sentences: why do multi-turn browser-origin LLM bridges lose opening stream tokens, and what is the practical fix? No greeting.';
  const chatRes = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      'x-dpp-client': 'generic',
    },
    body: JSON.stringify({
      model: 'ds/octopus',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const chat = await chatRes.json();
  if (chat.error) {
    console.error('FAIL chat', chat.error);
    process.exit(1);
  }
  const text = chat.choices?.[0]?.message?.content || '';
  if (text.length < 80) {
    console.error('FAIL short answer', text);
    process.exit(1);
  }
  const first = text.trim()[0];
  if (first && first === first.toLowerCase() && /[a-z]/.test(first) && text.startsWith(' ')) {
    console.warn('WARN possible mid-word open:', JSON.stringify(text.slice(0, 40)));
  }
  console.log('OK completion len=', text.length, 'preview=', text.slice(0, 160).replace(/\n/g, ' / '));
  console.log('OK thread header', chatRes.headers.get('x-dpp-thread-id'));
  console.log('SMOKE PASS');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
