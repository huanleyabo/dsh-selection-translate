/**
 * dsh-selection-translate — Host half.
 *
 * Owns the model call and the persisted configuration. The browser half never
 * sees the API key: it only posts `{ text, targetLang, sessionId }` to
 * `/api/dsh-selection-translate/translate` and reads a JSON answer.
 *
 * Two translation routes:
 *   - `current`  : the DSH `llm` service, using the session's (or the default)
 *                  provider/model — no extra credential needed.
 *   - `external` : any OpenAI-compatible `/chat/completions` endpoint.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const CONFIG_FILE = path.join(DSH_HOME, 'selection-translate.json');
const ROUTE_PREFIX = '/api/dsh-selection-translate';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const name = 'dsh-selection-translate';
export const inject = [];

export const DEFAULT_CONFIG = {
  enabled: true,
  targetLang: 'auto',
  maxChars: 6000,
  temperature: 0.1,
  timeoutMs: 60000,
  provider: 'current',
  endpoint: '',
  model: '',
  apiKey: '',
};

/** Human-readable names used inside the translation prompt. */
const LANG_LABELS = {
  auto: '智能中英互译（中文→英文，其他语言→简体中文）',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية',
  th: 'ไทย',
  vi: 'Tiếng Việt',
};

/* ------------------------------------------------------------------ config */

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const endpoint = typeof source.endpoint === 'string' ? source.endpoint.trim() : DEFAULT_CONFIG.endpoint;
  const model = typeof source.model === 'string' ? source.model.trim() : DEFAULT_CONFIG.model;
  const targetLang =
    typeof source.targetLang === 'string' && source.targetLang.trim()
      ? source.targetLang.trim()
      : DEFAULT_CONFIG.targetLang;
  return {
    enabled: source.enabled !== false,
    targetLang,
    maxChars: Math.round(clampNumber(source.maxChars, DEFAULT_CONFIG.maxChars, 50, 50000)),
    temperature: clampNumber(source.temperature, DEFAULT_CONFIG.temperature, 0, 2),
    timeoutMs: Math.round(clampNumber(source.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5000, 300000)),
    provider: source.provider === 'external' ? 'external' : 'current',
    endpoint,
    model,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : DEFAULT_CONFIG.apiKey,
  };
}

export function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (error) {
    console.warn('[dsh-selection-translate] read config failed:', error && error.message);
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(patch) {
  const current = readConfig();
  const merged = Object.assign({}, current, patch && typeof patch === 'object' ? patch : {});
  const next = normalizeConfig(merged);
  // An explicit apiKey string wins (including '' to clear); otherwise keep the stored one.
  next.apiKey = patch && typeof patch.apiKey === 'string' ? patch.apiKey.trim() : current.apiKey;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

/** Strip the secret before it ever crosses the wire. */
export function publicConfig(config) {
  const clone = { ...config };
  const hasApiKey = !!(clone.apiKey && String(clone.apiKey).trim());
  delete clone.apiKey;
  clone.hasApiKey = hasApiKey;
  return clone;
}

/* ------------------------------------------------------------------ prompt */

export function buildTranslationPrompt(text, targetLang) {
  const key = typeof targetLang === 'string' && targetLang.trim() ? targetLang.trim() : 'auto';
  const label = LANG_LABELS[key] || key;
  const system = [
    '你是一台专业的翻译引擎，只做翻译。',
    '目标语言：' + label + '。',
    '必须遵守：',
    '1. 只输出译文本身。禁止输出解释、前言、说明、注释、标签、序号或任何包裹用的引号。',
    '2. 完整保留原文的换行、缩进、标点、Markdown 标记、代码块、URL、变量名、占位符（如 {name}、%s、{{var}}）与专有名词。',
    '3. 不要增删信息，不要总结，不要改写语气。',
    '4. 若原文已经是目标语言，原样返回。',
    '5. 若原文是词语或短语，只给出最贴切的对译，不要展开成句子。',
  ].join('\n');
  const instruction =
    key === 'auto'
      ? '请翻译下面的文本：若主要是中文就译成地道自然的英文，否则译成流畅的简体中文。\n\n'
      : '请把下面的文本翻译成' + label + '。\n\n';
  return { system, user: instruction + text };
}

/** Remove code fences and one wrapping quote pair the model likes to add. */
export function cleanupTranslation(raw) {
  let out = String(raw == null ? '' : raw).trim();
  if (!out) return '';
  const fence = /^```[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(out);
  if (fence) out = fence[1].trim();
  const pairs = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    if (out.length > open.length + close.length && out.startsWith(open) && out.endsWith(close)) {
      const inner = out.slice(open.length, out.length - close.length).trim();
      if (inner) {
        out = inner;
        break;
      }
    }
  }
  return out.trim();
}

/* ------------------------------------------------------------- model route */

/**
 * Decide which provider/model to call for the "current session model" mode.
 * Priority: explicit session → default model selection → any live session.
 */
export function resolveCurrentRoute(ctx, sessionId) {
  let provider = '';
  let model = '';

  const sessions = ctx.get('sessions');
  const fromSession = (id) => {
    if (!id || !sessions || typeof sessions.get !== 'function') return null;
    let session;
    try {
      session = sessions.get(id);
    } catch {
      return null;
    }
    if (!session) return null;
    const context = typeof session.requestContext === 'function' ? session.requestContext() : null;
    const header = typeof session.requestHeader === 'function' ? session.requestHeader() : null;
    const sessionProvider = (context && context.provider) || (header && header.config && header.config.provider);
    const sessionModel = (context && context.model) || (header && header.config && header.config.model);
    return sessionProvider && sessionModel ? { provider: sessionProvider, model: sessionModel } : null;
  };

  const explicit = fromSession(sessionId);
  if (explicit) return explicit;

  const selection = ctx.get('agentDefaultModel');
  try {
    const current = selection && typeof selection.currentSelection === 'function' ? selection.currentSelection() : null;
    if (current && current.provider && current.model) return { provider: current.provider, model: current.model };
  } catch {
    /* fall through to the live-session scan */
  }

  if (sessions && typeof sessions.list === 'function') {
    let live = [];
    try {
      live = sessions.list() || [];
    } catch {
      live = [];
    }
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const found = fromSession(live[i] && live[i].id);
      if (found) return found;
    }
  }
  return { provider: '', model: '' };
}

/* -------------------------------------------------------------- translating */

async function translateWithCurrentModel(ctx, options) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') {
    throw new Error('DSH 内部 LLM 服务未就绪，无法调用当前会话模型。');
  }
  const route = resolveCurrentRoute(ctx, options.sessionId);
  if (!route.provider || !route.model) {
    throw new Error('未检测到可用模型。请先在输入框下方选择模型，或在划词翻译设置里改用「自定义 OpenAI 兼容端点」。');
  }
  const { system, user } = buildTranslationPrompt(options.text, options.targetLang);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let text = '';
  let reasoning = '';
  try {
    const request = {
      provider: route.provider,
      model: route.model,
      system,
      messages: [
        {
          id: 'dsh-st-' + Date.now().toString(36),
          role: 'user',
          content: [{ type: 'text', text: user }],
          source: { kind: 'user' },
        },
      ],
      temperature: options.temperature,
      signal: controller.signal,
    };
    if (options.sessionId) request.sessionId = options.sessionId;

    for await (const chunk of llm.stream(request)) {
      if (!chunk) continue;
      if (chunk.type === 'text-delta') text += chunk.text;
      else if (chunk.type === 'reasoning-delta') reasoning += chunk.text;
      else if (chunk.type === 'finish') {
        const reason = chunk.reason;
        if (reason && (reason.kind === 'error' || reason.kind === 'aborted')) {
          throw new Error((reason.failure && reason.failure.message) || '模型响应中断。');
        }
      }
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('调用模型超时（' + Math.round(options.timeoutMs / 1000) + ' 秒）。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const cleaned = cleanupTranslation(text) || cleanupTranslation(reasoning);
  if (!cleaned) throw new Error('模型没有返回可用的译文。');
  return { text: cleaned, provider: route.provider, model: route.model };
}

async function translateWithExternal(config, options) {
  if (!config.apiKey || !config.apiKey.trim()) throw new Error('尚未配置 API Key。');
  if (!config.endpoint || !config.endpoint.trim()) throw new Error('尚未配置 API Base URL。');
  if (!config.model || !config.model.trim()) throw new Error('尚未配置模型名称。');

  const { system, user } = buildTranslationPrompt(options.text, options.targetLang);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(config.endpoint.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey.trim(),
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: options.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let message = '上游接口返回 HTTP ' + response.status;
      try {
        const parsed = JSON.parse(raw);
        message = (parsed.error && parsed.error.message) || parsed.message || message;
      } catch {
        if (raw) message = message + '：' + raw.slice(0, 300);
      }
      throw new Error(message);
    }
    const data = await response.json();
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const content =
      (choice && choice.message && choice.message.content) ||
      (choice && choice.text) ||
      '';
    const cleaned = cleanupTranslation(content);
    if (!cleaned) throw new Error('上游模型没有返回可用的译文。');
    return { text: cleaned, provider: 'external', model: data.model || config.model.trim() };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('请求上游模型超时（' + Math.round(options.timeoutMs / 1000) + ' 秒）。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleTranslate(ctx, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const config = readConfig();
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw new Error('没有选中任何文字。');
  if (text.length > config.maxChars) {
    throw new Error('选中文字过长：' + text.length + ' 字符，上限 ' + config.maxChars + ' 字符。');
  }
  const targetLang =
    typeof body.targetLang === 'string' && body.targetLang.trim() ? body.targetLang.trim() : config.targetLang;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const options = {
    text,
    targetLang,
    sessionId,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
  };
  const startedAt = Date.now();
  const result =
    config.provider === 'external'
      ? await translateWithExternal(config, options)
      : await translateWithCurrentModel(ctx, options);
  return {
    text: result.text,
    provider: result.provider,
    model: result.model,
    targetLang,
    ms: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------------- routes */

function writeJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function route(ctx, req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
    res.end();
    return;
  }

  if (pathname === ROUTE_PREFIX + '/ping') {
    writeJson(res, 200, { ok: true, name });
    return;
  }

  if (pathname === ROUTE_PREFIX + '/config') {
    if (req.method === 'GET') {
      writeJson(res, 200, { ok: true, config: publicConfig(readConfig()) });
      return;
    }
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const patch = JSON.parse(raw || '{}');
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          writeJson(res, 400, { ok: false, error: '请求体必须是一个 JSON 对象。' });
          return;
        }
        const saved = writeConfig(patch);
        writeJson(res, 200, { ok: true, config: publicConfig(saved) });
      } catch (error) {
        writeJson(res, 400, { ok: false, error: (error && error.message) || '保存配置失败。' });
      }
      return;
    }
    writeJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (pathname === ROUTE_PREFIX + '/translate') {
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch (error) {
      writeJson(res, 400, { ok: false, error: (error && error.message) || '请求体解析失败。' });
      return;
    }
    try {
      writeJson(res, 200, { ok: true, ...(await handleTranslate(ctx, payload)) });
    } catch (error) {
      writeJson(res, 200, { ok: false, error: (error && error.message) || String(error) });
    }
    return;
  }

  writeJson(res, 404, { ok: false, error: 'Not Found' });
}

export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => route(ctx, req, res),
        }),
      'dsh-selection-translate: web routes',
    );
  });
}

export default { name, inject, apply };
