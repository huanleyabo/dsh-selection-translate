/**
 * Verification harness for dsh-selection-translate (Host half).
 * Runs the pure helpers and the translate pipeline against a fake ctx —
 * no network, no DSH runtime required.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the config file at a scratch dir BEFORE importing the module.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-st-test-'));
process.env.DSH_HOME = scratch;

const mod = await import('../lib/index.js');
const {
  name,
  inject,
  apply,
  readConfig,
  writeConfig,
  publicConfig,
  normalizeConfig,
  buildTranslationPrompt,
  cleanupTranslation,
  resolveCurrentRoute,
  handleTranslate,
  DEFAULT_CONFIG,
} = mod;

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log('  ok  ' + label);
}
async function checkAsync(label, fn) {
  await fn();
  passed += 1;
  console.log('  ok  ' + label);
}

/* ------------------------------------------------------------- shape */
check('exports a cordis plugin', () => {
  assert.equal(name, 'dsh-selection-translate');
  assert.ok(Array.isArray(inject));
  assert.equal(typeof apply, 'function');
});

/* ------------------------------------------------------------ config */
check('defaults are sane', () => {
  const c = readConfig();
  assert.equal(c.enabled, true);
  assert.equal(c.provider, 'current');
  assert.equal(c.targetLang, 'auto');
});

check('config round-trips and clamps', () => {
  writeConfig({ targetLang: 'ja', maxChars: 10_000_000, temperature: 99, provider: 'external', endpoint: ' https://x/v1/chat/completions ', model: ' m ', apiKey: ' sk-secret ' });
  const c = readConfig();
  assert.equal(c.targetLang, 'ja');
  assert.equal(c.maxChars, 50000);          // clamped to max
  assert.equal(c.temperature, 2);            // clamped to max
  assert.equal(c.provider, 'external');
  assert.equal(c.endpoint, 'https://x/v1/chat/completions'); // trimmed
  assert.equal(c.model, 'm');
  assert.equal(c.apiKey, 'sk-secret');
});

check('unknown provider falls back to current', () => {
  assert.equal(normalizeConfig({ provider: 'evil' }).provider, 'current');
});

check('apiKey is never exposed by publicConfig', () => {
  const pub = publicConfig(readConfig());
  assert.equal(pub.apiKey, undefined);
  assert.equal(pub.hasApiKey, true);
  assert.ok(!JSON.stringify(pub).includes('sk-secret'));
});

check('partial patch preserves the stored apiKey', () => {
  const c = writeConfig({ targetLang: 'en' });
  assert.equal(c.apiKey, 'sk-secret');
  assert.equal(c.targetLang, 'en');
});

check('empty-string apiKey clears it', () => {
  const c = writeConfig({ apiKey: '' });
  assert.equal(c.apiKey, '');
  assert.equal(readConfig().apiKey, '');
});

check('unparseable config file degrades to defaults', () => {
  fs.writeFileSync(path.join(scratch, 'selection-translate.json'), '{ not json');
  const c = readConfig();
  assert.deepEqual(c, DEFAULT_CONFIG);
});

/* ------------------------------------------------------------ prompt */
check('auto prompt tells the model to mirror the language', () => {
  const p = buildTranslationPrompt('hello', 'auto');
  assert.match(p.system, /只输出译文本身/);
  assert.match(p.user, /hello$/);
  assert.match(p.user, /中文/);
});

check('explicit language names the target', () => {
  const p = buildTranslationPrompt('bonjour', 'ja');
  assert.match(p.system, /日本語/);
  assert.match(p.user, /日本語/);
});

check('selected text is passed through verbatim', () => {
  const text = 'line1\n  indented {var}\n```code```';
  assert.ok(buildTranslationPrompt(text, 'en').user.endsWith(text));
});

/* ----------------------------------------------------------- cleanup */
check('cleanup strips code fences', () => {
  assert.equal(cleanupTranslation('```\n你好\n```'), '你好');
  assert.equal(cleanupTranslation('```text\n你好\n```'), '你好');
});

check('cleanup strips one wrapping quote pair', () => {
  assert.equal(cleanupTranslation('"你好"'), '你好');
  assert.equal(cleanupTranslation('“你好”'), '你好');
  assert.equal(cleanupTranslation('「你好」'), '你好');
});

check('cleanup keeps inner quotes intact', () => {
  assert.equal(cleanupTranslation('He said "hi"'), 'He said "hi"');
  assert.equal(cleanupTranslation(''), '');
  assert.equal(cleanupTranslation(null), '');
});

/* ------------------------------------------------- route resolution */
check('session id route wins', () => {
  const ctx = fakeCtx({
    sessions: {
      get: () => ({
        requestContext: () => ({ provider: 'p-session', model: 'm-session' }),
        requestHeader: () => null,
      }),
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p-default', model: 'm-default' }) },
  });
  assert.deepEqual(resolveCurrentRoute(ctx, 'sess-1'), { provider: 'p-session', model: 'm-session' });
});

check('falls back to the default model selection', () => {
  const ctx = fakeCtx({
    sessions: { get: () => undefined, list: () => [] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p-default', model: 'm-default' }) },
  });
  assert.deepEqual(resolveCurrentRoute(ctx, 'gone'), { provider: 'p-default', model: 'm-default' });
});

check('falls back to the newest live session', () => {
  const ctx = fakeCtx({
    sessions: {
      get: (id) => (id === 'live-2' ? { requestContext: () => ({ provider: 'p2', model: 'm2' }), requestHeader: () => null } : undefined),
      list: () => [{ id: 'live-1' }, { id: 'live-2' }],
    },
    agentDefaultModel: { currentSelection: () => null },
  });
  assert.deepEqual(resolveCurrentRoute(ctx, ''), { provider: 'p2', model: 'm2' });
});

check('reports nothing found instead of throwing', () => {
  const ctx = fakeCtx({ agentDefaultModel: { currentSelection: () => null } });
  assert.deepEqual(resolveCurrentRoute(ctx, ''), { provider: '', model: '' });
});

/* -------------------------------------------------------- translate */
await checkAsync('streams text from the current-model route', async () => {
  writeConfig({ provider: 'current', targetLang: 'auto', maxChars: 6000 });
  let sawSystem = '';
  let sawSessionId = null;
  const ctx = fakeCtx({
    llm: {
      stream: (options) => {
        sawSystem = options.system;
        sawSessionId = options.sessionId;
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: '```\n' };
          yield { type: 'text-delta', index: 0, text: 'Hello' };
          yield { type: 'text-delta', index: 0, text: '\n```' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    },
    sessions: { get: () => ({ requestContext: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }), requestHeader: () => null }) },
  });
  const result = await handleTranslate(ctx, { text: '你好', sessionId: 'sess-9' });
  assert.equal(result.text, 'Hello');
  assert.equal(result.provider, 'deepseek-account');
  assert.equal(result.model, 'deepseek-flash');
  assert.equal(result.targetLang, 'auto');
  assert.equal(sawSessionId, 'sess-9');
  assert.match(sawSystem, /翻译引擎/);
  assert.equal(typeof result.ms, 'number');
});

await checkAsync('surface finish reason becomes a thrown error', async () => {
  const ctx = fakeCtx({
    llm: {
      stream: () =>
        (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: '429' } } };
        })(),
    },
    sessions: { get: () => ({ requestContext: () => ({ provider: 'p', model: 'm' }), requestHeader: () => null }) },
  });
  await assert.rejects(() => handleTranslate(ctx, { text: 'hi', sessionId: 's1' }), /rate limited/);
});

await checkAsync('reasoning-only replies are still usable', async () => {
  const ctx = fakeCtx({
    llm: {
      stream: () =>
        (async function* () {
          yield { type: 'reasoning-delta', index: 1, text: 'Hola' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })(),
    },
    sessions: { get: () => ({ requestContext: () => ({ provider: 'p', model: 'm' }), requestHeader: () => null }) },
  });
  const result = await handleTranslate(ctx, { text: 'hello', sessionId: 's1' });
  assert.equal(result.text, 'Hola');
});

await checkAsync('empty model output is an error, not a silent blank', async () => {
  const ctx = fakeCtx({
    llm: {
      stream: () =>
        (async function* () {
          yield { type: 'finish', reason: { kind: 'stop' } };
        })(),
    },
    sessions: { get: () => ({ requestContext: () => ({ provider: 'p', model: 'm' }), requestHeader: () => null }) },
  });
  await assert.rejects(() => handleTranslate(ctx, { text: 'hi', sessionId: 's1' }), /没有返回可用的译文/);
});

await checkAsync('missing llm service gives an actionable message', async () => {
  const ctx = fakeCtx({});
  await assert.rejects(() => handleTranslate(ctx, { text: 'hi' }), /LLM 服务未就绪/);
});

await checkAsync('no resolvable model gives an actionable message', async () => {
  const ctx = fakeCtx({ llm: { stream: () => (async function* () {})() } });
  await assert.rejects(() => handleTranslate(ctx, { text: 'hi' }), /未检测到可用模型/);
});

await checkAsync('blank selection is rejected', async () => {
  const ctx = fakeCtx({});
  await assert.rejects(() => handleTranslate(ctx, { text: '   ' }), /没有选中任何文字/);
});

await checkAsync('oversized selection is rejected before any model call', async () => {
  writeConfig({ maxChars: 50 });
  let called = false;
  const ctx = fakeCtx({
    llm: {
      stream: () => {
        called = true;
        return (async function* () {})();
      },
    },
  });
  await assert.rejects(() => handleTranslate(ctx, { text: 'x'.repeat(51) }), /过长/);
  assert.equal(called, false);
});

await checkAsync('external route posts an OpenAI-compatible body', async () => {
  writeConfig({ provider: 'external', endpoint: 'https://example.test/v1/chat/completions', model: 'gpt-4o-mini', apiKey: 'sk-x', maxChars: 6000, timeoutMs: 6000 });
  const originalFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      json: async () => ({ model: 'gpt-4o-mini', choices: [{ message: { content: ' "Hello" ' } }] }),
    };
  };
  try {
    const result = await handleTranslate(fakeCtx({}), { text: '你好', targetLang: 'en' });
    assert.equal(result.text, 'Hello');
    assert.equal(result.provider, 'external');
    assert.equal(seen.url, 'https://example.test/v1/chat/completions');
    assert.equal(seen.init.headers.Authorization, 'Bearer sk-x');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2);
    assert.match(body.messages[1].content, /你好/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await checkAsync('external upstream error is surfaced verbatim', async () => {
  writeConfig({ provider: 'external', endpoint: 'https://example.test/v1/chat/completions', model: 'm', apiKey: 'sk-x' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
  });
  try {
    await assert.rejects(() => handleTranslate(fakeCtx({}), { text: 'hi' }), /Invalid API key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await checkAsync('external route requires credentials up front', async () => {
  writeConfig({ provider: 'external', endpoint: '', model: '', apiKey: '' });
  await assert.rejects(() => handleTranslate(fakeCtx({}), { text: 'hi' }), /API Key/);
});

await checkAsync('aborted model call reports a timeout', async () => {
  writeConfig({ provider: 'current' });
  const ctx = fakeCtx({
    llm: {
      stream: () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return (async function* () {
          throw err;
        })();
      },
    },
    sessions: { get: () => ({ requestContext: () => ({ provider: 'p', model: 'm' }), requestHeader: () => null }) },
  });
  await assert.rejects(() => handleTranslate(ctx, { text: 'hi', sessionId: 's1' }), /超时/);
});

/* --------------------------------------------------------------- routes */
await checkAsync('registers one prefix route and disposes cleanly', async () => {
  const registered = [];
  const disposers = [];
  let effects = 0;
  const ctx = {
    get: () => undefined,
    inject: (deps, fn) => {
      assert.deepEqual(deps, ['webServer']);
      fn({
        effect: (factory, label) => {
          effects += 1;
          disposers.push(factory());
        },
        webServer: {
          register: (route) => {
            registered.push(route);
            return () => {};
          },
        },
      });
    },
  };
  apply(ctx);
  assert.equal(effects, 1);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'prefix');
  assert.equal(registered[0].path, '/api/dsh-selection-translate');
  assert.equal(typeof registered[0].handler, 'function');
});

/* ---------------------------------------------------------- readBody/res */
function fakeCtx(services) {
  return { get: (key) => services[key] };
}

/* --------------------------------------------------------- HTTP smoke test */
const { createServer } = await import('node:http');
await checkAsync('HTTP surface answers ping/config/translate', async () => {
  const handlers = [];
  const ctx = {
    get: () => undefined,
    inject: (_deps, fn) =>
      fn({
        effect: (factory) => { handlers.push(factory()); },
        webServer: { register: (r) => { handlers.registered = r; return () => {}; } },
      }),
  };
  apply(ctx);
  const server = createServer(handlers.registered.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const ping = await (await fetch(base + '/api/dsh-selection-translate/ping')).json();
    assert.equal(ping.ok, true);

    const cfg = await (await fetch(base + '/api/dsh-selection-translate/config')).json();
    assert.equal(cfg.ok, true);
    assert.equal(cfg.config.apiKey, undefined);

    const posted = await (await fetch(base + '/api/dsh-selection-translate/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLang: 'fr' }),
    })).json();
    assert.equal(posted.config.targetLang, 'fr');

    const bad = await (await fetch(base + '/api/dsh-selection-translate/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })).json();
    assert.equal(bad.ok, false);
    assert.match(bad.error, /没有选中任何文字/);

    const missing = await fetch(base + '/api/dsh-selection-translate/nope');
    assert.equal(missing.status, 404);

    const wrongMethod = await fetch(base + '/api/dsh-selection-translate/translate');
    assert.equal(wrongMethod.status, 405);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log('\n' + passed + ' checks passed.');
