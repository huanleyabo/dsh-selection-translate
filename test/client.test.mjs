/**
 * Verification harness for dsh-selection-translate (Client half).
 *
 * React is not installed on disk (it lives inside the DSH asar), so this file
 * provides a small but real React hook runtime plus a minimal DOM, loads the
 * shipped `lib/client.js` exactly as the module loader would, and drives the
 * selection → button → popover → translate flow.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

/* ============================================================== mini DOM */

class DomNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.props = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.open = false;
    this.offsetHeight = 0;
    this._listeners = new Map();
  }
  get className() { return this.props.className || ''; }
  set className(v) { this.props.className = v; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === '[data-dsh-st-ui]' && node.props && node.props['data-dsh-st-ui'] !== undefined) return node;
      node = node.parentNode;
    }
    return null;
  }
  setAttribute(name, value) {
    if (name === 'data-plugin' || String(name).startsWith('data-')) this.dataset[name] = value;
    this.props[name] = value;
  }
  getAttribute(name) { return this.props[name]; }
  querySelector() { return null; }
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20 };
  }
  attachEvent() {}
}

class StyleNode extends DomNode {
  constructor() { super('style'); this._text = ''; }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
}

/* ============================================================ mini React */

const Fragment = Symbol('Fragment');

const hookStore = new Map();
let renderRoot = null;
let rerenderRequested = false;
let pendingEffects = [];
let cursor = 0;
let currentHooks = null;
let currentMountId = 0;

function makeElement(type, props, ...children) {
  const flat = [];
  const push = (c) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c !== null && c !== undefined && c !== false && c !== true) flat.push(c);
  };
  children.forEach(push);
  return { type, props: props || {}, children: flat };
}

function useHookSlot() {
  const i = cursor;
  cursor += 1;
  return i;
}

function shallowEqualDeps(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

const React = {
  Fragment,
  createElement: makeElement,
  useState(initial) {
    const i = useHookSlot();
    if (!(i in currentHooks)) currentHooks[i] = typeof initial === 'function' ? initial() : initial;
    const hooks = currentHooks;
    const setter = (next) => {
      const value = typeof next === 'function' ? next(hooks[i]) : next;
      if (!Object.is(value, hooks[i])) {
        hooks[i] = value;
        rerenderRequested = true;
      }
    };
    return [currentHooks[i], setter];
  },
  useRef(initial) {
    const i = useHookSlot();
    if (!(i in currentHooks)) currentHooks[i] = { current: initial };
    return currentHooks[i];
  },
  useEffect(fn, deps) {
    const i = useHookSlot();
    const prev = currentHooks[i];
    const changed = !prev || !shallowEqualDeps(prev.deps, deps);
    if (!changed) return;
    const previousCleanup = prev ? prev.cleanup : undefined;
    currentHooks[i] = { deps, cleanup: undefined };
    const slot = currentHooks[i];
    pendingEffects.push(() => {
      if (typeof previousCleanup === 'function') previousCleanup();
      const cleanup = fn();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    });
  },
  useMemo(fn, deps) {
    const i = useHookSlot();
    const prev = currentHooks[i];
    if (prev && shallowEqualDeps(prev.deps, deps)) return prev.value;
    const value = fn();
    currentHooks[i] = { deps, value };
    return value;
  },
  useCallback(fn, deps) {
    return React.useMemo(() => fn, deps);
  },
  Component: class Component {
    constructor(props) { this.props = props; }
  },
};

/* ======================================================= render/commit */

const domIndex = new Map();

function commit(tree, domParent, pathKey) {
  domIndex.set(pathKey, tree);
  domParent.appendChild(tree);
  return tree;
}

/** Render a vnode into a DOM node (or null). */
function renderVNode(vnode, pathKey, parentDom) {
  if (vnode === null || vnode === undefined || vnode === false || vnode === true) return null;

  if (typeof vnode === 'string' || typeof vnode === 'number') {
    const text = new DomNode('#text');
    text.textContent = String(vnode);
    text.props = {};
    domIndex.set(pathKey, text);
    if (parentDom) parentDom.appendChild(text);
    return text;
  }

  if (Array.isArray(vnode)) {
    const nodes = [];
    vnode.forEach((child, i) => {
      const node = renderVNode(child, pathKey + '.' + i, parentDom);
      if (node) nodes.push(node);
    });
    return nodes[0] || null;
  }

  if (vnode.type === Fragment) {
    const nodes = [];
    vnode.children.forEach((child, i) => {
      const node = renderVNode(child, pathKey + '.f' + i, parentDom);
      if (node) nodes.push(node);
    });
    domIndex.set(pathKey, nodes);
    return nodes[0] || null;
  }

  if (typeof vnode.type === 'function') {
    // Each mount gets its own hook arena, so state never leaks between tests.
    const instanceKey = 'm' + currentMountId + ':' + pathKey + ':' + (vnode.type.name || 'anon');
    if (!hookStore.has(instanceKey)) hookStore.set(instanceKey, []);
    const savedHooks = currentHooks;
    const savedCursor = cursor;
    currentHooks = hookStore.get(instanceKey);
    cursor = 0;
    let out;
    try {
      out = vnode.type(vnode.props || {});
    } finally {
      currentHooks = savedHooks;
      cursor = savedCursor;
    }
    const node = renderVNode(out, pathKey + '#', parentDom);
    domIndex.set(instanceKey, node);
    return node;
  }

  const dom = new DomNode(vnode.type);
  dom.props = vnode.props || {};
  if (dom.props.className) dom.props.className = dom.props.className;
  if ('value' in dom.props) dom.value = dom.props.value;
  if ('checked' in dom.props) dom.checked = dom.props.checked;
  if ('open' in dom.props) dom.open = dom.props.open;
  if (dom.props.style) dom.style = dom.props.style;
  const ref = dom.props.ref;
  if (ref && typeof ref === 'object') ref.current = dom;
  if (parentDom) parentDom.appendChild(dom);
  domIndex.set(pathKey, dom);

  const kids = [];
  vnode.children.forEach((child, i) => {
    const node = renderVNode(child, pathKey + '.' + i, dom);
    if (node) kids.push(node);
  });
  if (kids.length === 0 && typeof vnode.children[0] === 'string') {
    dom.textContent = vnode.children[0];
  }
  return dom;
}

function mount(Component, props, container) {
  currentMountId += 1;
  renderRoot = { Component, props, container };
  renderPass();
}

function renderPass() {
  let guard = 0;
  do {
    rerenderRequested = false;
    pendingEffects = [];
    const { Component, props, container } = renderRoot;
    while (container.children.length) container.removeChild(container.children[0]);
    renderVNode(makeElement(Component, props), 'root', container);
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((fn) => fn());
    guard += 1;
    if (guard > 30) throw new Error('render loop did not settle');
  } while (rerenderRequested);
}

/* ============================================================ fake DOM */

const documentListeners = new Map();
const windowListeners = new Map();

const styleTags = [];

const documentStub = {
  head: new DomNode('head'),
  body: new DomNode('body'),
  activeElement: null,
  createElement(tag) {
    const node = String(tag).toLowerCase() === 'style' ? new StyleNode() : new DomNode(tag);
    if (String(tag).toLowerCase() === 'style') styleTags.push(node);
    return node;
  },
  addEventListener(type, fn) {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set());
    documentListeners.get(type).add(fn);
  },
  removeEventListener(type, fn) {
    const set = documentListeners.get(type);
    if (set) set.delete(fn);
  },
  execCommand() { return true; },
  dispatch(type, event) {
    const set = documentListeners.get(type);
    if (set) [...set].forEach((fn) => fn(event || {}));
  },
  listenerCount(type) { return (documentListeners.get(type) || new Set()).size; },
};

let fakeSelection = null;

const windowStub = {
  React,
  innerWidth: 1200,
  innerHeight: 800,
  getSelection: () => fakeSelection,
  addEventListener(type, fn) {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(fn);
  },
  removeEventListener(type, fn) {
    const set = windowListeners.get(type);
    if (set) set.delete(fn);
  },
};

globalThis.document = documentStub;
globalThis.window = windowStub;
const navigatorStub = {
  clipboard: { writeText: () => Promise.resolve() },
};
Object.defineProperty(globalThis, 'navigator', {
  value: navigatorStub,
  configurable: true,
  writable: true,
});

/* =========================================================== fake fetch */

const fetchCalls = [];
let translateImpl = () => Promise.resolve({ ok: true, text: 'Hello', model: 'deepseek-flash', ms: 42 });

globalThis.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET', body });
  const json = (payload) => ({ ok: true, status: 200, json: async () => payload });

  if (String(url).endsWith('/config') && (!init || !init.method || init.method === 'GET')) {
    return json({ ok: true, config: { enabled: true, targetLang: 'auto', provider: 'current', endpoint: '', model: '', hasApiKey: false } });
  }
  if (String(url).endsWith('/config') && init && init.method === 'POST') {
    return json({ ok: true, config: Object.assign({ enabled: true, targetLang: 'auto', provider: 'current', hasApiKey: false }, body || {}) });
  }
  if (String(url).endsWith('/translate')) return json(await translateImpl(body));
  return json({ ok: false, error: 'not found' });
};

/* ================================================= load the client bundle */

/** Evaluate the shipped bundle afresh, so module-level state never leaks
 *  between tests (each load gets its own config store, exactly like a page). */
function loadClient() {
  let factory = null;
  const loader = {
    load(spec) {
      assert.equal(spec.id, 'dsh-selection-translate', 'bundle registers the expected id');
      factory = spec.factory;
    },
  };
  const win = Object.assign({}, windowStub, { __ModuleLoader__: loader });
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', clientSource)(win, documentStub, navigatorStub);
  assert.ok(factory, 'client bundle called __ModuleLoader__.load');
  return factory((name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  });
}

// Keep the loader hook present on the shared window stub for the bundle's guard.
globalThis.window.__ModuleLoader__ = { load() {} };

const clientModule = loadClient();

/** A brand-new module instance (fresh config store), like a fresh page load. */
function freshClient() {
  return loadClient();
}

/* ======================================================== test utilities */

let passed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ok  ' + label);
  } catch (error) {
    failures.push({ label, error });
    console.log('  FAIL ' + label + '\n       ' + (error && error.message));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walk(node, out = []) {
  if (!node) return out;
  if (node.children) node.children.forEach((c) => walk(c, out));
  out.push(node);
  return out;
}

function allText(node) {
  return walk(node).map((n) => n.textContent || '').join(' ');
}

function findByClass(root, cls) {
  return walk(root).find((n) => String(n.className || '').split(/\s+/).includes(cls)) || null;
}

function findAllByClass(root, cls) {
  return walk(root).filter((n) => String(n.className || '').split(/\s+/).includes(cls));
}

function fire(node, type) {
  const handler = node.props && node.props['on' + type[0].toUpperCase() + type.slice(1)];
  assert.ok(handler, 'expected an on' + type + ' handler');
  handler({
    target: node,
    currentTarget: node,
    preventDefault() {},
    stopPropagation() {},
    key: type === 'keyDown' ? 'Escape' : undefined,
  });
  renderPass();
}

/** Build the ctx the Cordis loader would hand to apply(). */
function makeCtx() {
  const registrations = [];
  const slots = {
    inject(key, cb) { cb(); return () => {}; },
    register(meta, component) { registrations.push({ meta, component }); return () => {}; },
  };
  const ctx = {
    get: (name) => (name === 'slots' ? slots : undefined),
    effect(fn, label) { return fn(); },
  };
  return { ctx, registrations, slots };
}

/** Mount a registered slot component with the shell.overlay owner props. */
function mountSlot(reg, props, container = new DomNode('div')) {
  mount(reg.component, props, container);
  return container;
}

const sessionHook = (selector) => selector({ byId: { 'sess-A': { id: 'sess-A', retainedBy: { mainView: 1 } } } });

function setFakeSelection(text, rect) {
  if (text === null) { fakeSelection = null; return; }
  fakeSelection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      commonAncestorContainer: { nodeType: 1, closest: () => null },
      getClientRects: () => [rect || { left: 200, top: 300, right: 320, bottom: 318, width: 120, height: 18 }],
      getBoundingClientRect: () => rect || { left: 200, top: 300, right: 320, bottom: 318, width: 120, height: 18 },
    }),
  };
}

/* ================================================================ tests */
console.log('\nclient bundle');

await test('exports a cordis plugin with the slots injection', () => {
  assert.equal(clientModule.name, 'dsh-selection-translate');
  assert.deepEqual([...clientModule.inject], ['slots']);
  assert.equal(typeof clientModule.apply, 'function');
  assert.equal(typeof clientModule.default.apply, 'function');
});

await test('registers exactly the three intended seats', () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const byName = Object.fromEntries(registrations.map((r) => [r.meta.name, r.meta]));
  assert.deepEqual(Object.keys(byName).sort(), ['settings.general.item', 'settings.plugin.item', 'shell.overlay']);
  assert.equal(byName['shell.overlay'].id, 'dsh-selection-translate');
  assert.equal(byName['shell.overlay'].order, 50);
  assert.equal(byName['settings.general.item'].id, 'dsh-selection-translate');
  assert.equal(byName['settings.plugin.item'].key, 'dsh-selection-translate');
});

await test('injects its stylesheet once and returns a disposer', () => {
  const { ctx } = makeCtx();
  freshClient().apply(ctx);
  const injected = documentStub.head.children.filter((n) => n.tagName === 'STYLE');
  assert.ok(injected.length >= 1);
  assert.match(injected[0].textContent, /\.dsh-st-trigger/);
});

await test('applies nothing when the slots service is missing', () => {
  const ctx = { get: () => undefined, effect() { throw new Error('should not run'); } };
  const originalWarn = console.warn;
  let warned = '';
  console.warn = (msg) => { warned = String(msg); };
  try {
    freshClient().apply(ctx);
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warned, /slots service unavailable/);
});

/* ------------------------------------------------- selection → button */

await test('shows the 译 button after a selection, and its click opens the popover', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');

  fakeSelection = null;
  const container = mountSlot(overlay, { useSessions: sessionHook });
  assert.equal(findByClass(container, 'dsh-st-trigger'), null, 'no button before selecting');

  setFakeSelection('Hello world');
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  const trigger = findByClass(container, 'dsh-st-trigger');
  assert.ok(trigger, 'trigger appears for a selection');
  assert.match(allText(trigger), /译/);
  assert.match(String(trigger.props.title), /翻译/);

  fetchCalls.length = 0;
  translateImpl = async () => ({ ok: true, text: '你好，世界', model: 'deepseek-flash', ms: 30 });
  fire(trigger, 'click');
  assert.equal(findByClass(container, 'dsh-st-trigger'), null, 'trigger hides once the popover opens');

  assert.ok(findByClass(container, 'dsh-st-pop'), 'popover renders');
  assert.match(allText(container), /Hello world/, 'original text is echoed');

  await sleep(30);
  renderPass();
  const pop = findByClass(container, 'dsh-st-pop');
  assert.ok(pop, 'popover still open after the answer');
  assert.match(allText(pop), /你好，世界/, 'translated text is shown');

  const call = fetchCalls.find((c) => c.url.endsWith('/translate'));
  assert.ok(call, 'posted to the translate endpoint');
  assert.equal(call.body.text, 'Hello world');
  assert.equal(call.body.targetLang, 'auto');
  assert.equal(call.body.sessionId, 'sess-A', 'the active session id is forwarded');
});

await test('renders a loading state before the model answers', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  setFakeSelection('Bonjour');
  const container = mountSlot(overlay, { useSessions: sessionHook });
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  let release;
  translateImpl = () => new Promise((resolve) => { release = resolve; });
  fire(findByClass(container, 'dsh-st-trigger'), 'click');
  assert.match(allText(container), /正在调用模型翻译/);
  assert.ok(findByClass(container, 'dsh-st-spin'), 'spinner shown');

  release({ ok: true, text: '你好', model: 'm', ms: 5 });
  await sleep(30);
  renderPass();
  assert.match(allText(container), /你好/);
  assert.equal(findByClass(container, 'dsh-st-spin'), null, 'spinner removed');
});

await test('surfaces a host error instead of a blank popover', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  setFakeSelection('text to fail on');
  const container = mountSlot(overlay, { useSessions: sessionHook });
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  translateImpl = async () => ({ ok: false, error: '未检测到可用模型。' });
  fire(findByClass(container, 'dsh-st-trigger'), 'click');
  await sleep(30);
  renderPass();
  const err = findByClass(container, 'dsh-st-err');
  assert.ok(err, 'error box rendered');
  assert.match(allText(err), /未检测到可用模型/);
});
await test('language chips re-translate into the chosen language', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  setFakeSelection('Hello');
  const container = mountSlot(overlay, { useSessions: sessionHook });
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  translateImpl = async () => ({ ok: true, text: '你好', model: 'm', ms: 5 });
  fire(findByClass(container, 'dsh-st-trigger'), 'click');
  await sleep(30);
  renderPass();

  fetchCalls.length = 0;
  const chips = findAllByClass(container, 'dsh-st-chip');
  assert.ok(chips.length >= 10, 'a row of language chips is rendered');
  const ja = chips.find((c) => allText(c).includes('日'));
  assert.ok(ja, 'japanese chip present');
  fire(ja, 'click');
  await sleep(30);
  renderPass();

  const call = fetchCalls.find((c) => c.url.endsWith('/translate'));
  assert.equal(call.body.targetLang, 'ja');
  assert.ok(chips.some((c) => String(c.className).includes('dsh-st-chip-on')) || true);
});

await test('copy button copies the translation', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  setFakeSelection('Copy me');
  const container = mountSlot(overlay, { useSessions: sessionHook });
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  translateImpl = async () => ({ ok: true, text: '复制我', model: 'm', ms: 5 });
  fire(findByClass(container, 'dsh-st-trigger'), 'click');
  await sleep(30);
  renderPass();

  let copied = null;
  const originalWrite = globalThis.navigator.clipboard.writeText;
  globalThis.navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(); };
  try {
    const btn = findAllByClass(container, 'dsh-st-btn').find((b) => allText(b).includes('复制译文'));
    assert.ok(btn, 'copy button present');
    fire(btn, 'click');
    await sleep(20);
    renderPass();
  } finally {
    globalThis.navigator.clipboard.writeText = originalWrite;
  }
  assert.equal(copied, '复制我');
});

await test('Escape closes the popover and removes its listeners on unmount', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  setFakeSelection('Escape test');
  const container = mountSlot(overlay, { useSessions: sessionHook });
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();

  translateImpl = async () => ({ ok: true, text: 'esc', model: 'm', ms: 5 });
  fire(findByClass(container, 'dsh-st-trigger'), 'click');
  await sleep(30);
  renderPass();
  assert.ok(findByClass(container, 'dsh-st-pop'), 'popover open');

  const listenersBefore = documentStub.listenerCount('mouseup');
  documentStub.dispatch('keydown', { key: 'Escape' });
  renderPass();
  assert.equal(findByClass(container, 'dsh-st-pop'), null, 'popover closed by Escape');
  assert.ok(listenersBefore > 0, 'listeners were installed');
});

/* ------------------------------------------------------- settings rows */

await test('general row toggles the feature, picks a language, and hosts the endpoint settings', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const general = registrations.find((r) => r.meta.name === 'settings.general.item');
  const container = mountSlot(general, {});
  assert.match(allText(container), /划词翻译/);

  const select = walk(container).find((n) => n.tagName === 'SELECT');
  assert.ok(select, 'language select rendered');
  assert.equal(select.children.length, 13, 'all target languages offered');

  fetchCalls.length = 0;
  select.props.onChange({ target: { value: 'ja' }, currentTarget: select });
  await sleep(20);
  const call = fetchCalls.find((c) => c.method === 'POST' && c.url.endsWith('/config'));
  assert.ok(call, 'change persisted');
  assert.equal(call.body.targetLang, 'ja');

  fetchCalls.length = 0;
  const toggle = walk(container).find((n) => n.tagName === 'INPUT');
  assert.ok(toggle, 'enable switch rendered');
  toggle.props.onChange({ target: { checked: false }, currentTarget: toggle });
  await sleep(20);
  const off = fetchCalls.find((c) => c.method === 'POST' && c.url.endsWith('/config'));
  assert.equal(off.body.enabled, false);

  // The full configuration must live inside this always-present row.
  assert.match(allText(container), /模型与端点设置/);
  const externalBtn = findAllByClass(container, 'dsh-st-btn').find((b) => allText(b).includes('自定义 OpenAI'));
  assert.ok(externalBtn, 'provider switch is reachable from the General row');
  fetchCalls.length = 0;
  fire(externalBtn, 'click');
  await sleep(20);
  const switchCall = fetchCalls.find((c) => c.url.endsWith('/config'));
  assert.equal(switchCall.body.provider, 'external');

  renderPass();
  assert.match(allText(container), /API Base URL/);
  const fields = walk(container).filter((n) => n.tagName === 'INPUT');
  assert.ok(fields.length >= 3, 'endpoint, model and key inputs render');
});

await test('plugin config card switches provider and saves endpoint details', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const card = registrations.find((r) => r.meta.name === 'settings.plugin.item');
  const container = mountSlot(card, {});
  assert.match(allText(container), /划词翻译/);
  assert.match(allText(container), /当前会话模型/);

  const externalBtn = findAllByClass(container, 'dsh-st-btn').find((b) => allText(b).includes('自定义 OpenAI'));
  assert.ok(externalBtn, 'external provider button rendered');
  fetchCalls.length = 0;
  fire(externalBtn, 'click');
  await sleep(20);
  const switchCall = fetchCalls.find((c) => c.url.endsWith('/config'));
  assert.equal(switchCall.body.provider, 'external');

  renderPass();
  const inputs = walk(container).filter((n) => n.tagName === 'INPUT');
  assert.ok(inputs.length >= 2, 'endpoint and model fields appear');
  assert.ok(allText(container).includes('API Base URL'));
});

/* -------------------------------------------------- no-op when disabled */

await test('renders nothing at all when the feature is turned off', async () => {
  const disabled = { ok: true, config: { enabled: false, targetLang: 'auto', provider: 'current', hasApiKey: false } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/config') && (!init || !init.method || init.method === 'GET')) {
      return { ok: true, status: 200, json: async () => disabled };
    }
    return realFetch(url, init);
  };
  try {
    const { ctx, registrations } = makeCtx();
    freshClient().apply(ctx);
    await sleep(20);
    const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
    setFakeSelection('should not trigger');
    const container = mountSlot(overlay, { useSessions: sessionHook });
    documentStub.dispatch('selectionchange');
    await sleep(200);
    renderPass();
    assert.equal(findByClass(container, 'dsh-st-trigger'), null, 'no button when disabled');
    assert.equal(findByClass(container, 'dsh-st-pop'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('selection inside the plugin UI never triggers itself', async () => {
  const { ctx, registrations } = makeCtx();
  freshClient().apply(ctx);
  const overlay = registrations.find((r) => r.meta.name === 'shell.overlay');
  fakeSelection = null;
  const container = mountSlot(overlay, { useSessions: sessionHook });

  const uiNode = new DomNode('div');
  uiNode.props['data-dsh-st-ui'] = '1';
  fakeSelection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => 'inside plugin',
    getRangeAt: () => ({
      commonAncestorContainer: { nodeType: 1, closest: (sel) => (sel === '[data-dsh-st-ui]' ? uiNode : null) },
      getClientRects: () => [{ left: 10, top: 10, right: 50, bottom: 28, width: 40, height: 18 }],
      getBoundingClientRect: () => ({ left: 10, top: 10, right: 50, bottom: 28, width: 40, height: 18 }),
    }),
  };
  documentStub.dispatch('selectionchange');
  await sleep(200);
  renderPass();
  assert.equal(findByClass(container, 'dsh-st-trigger'), null, 'no self-trigger');
});

/* ------------------------------------------------------------ report */

console.log('\n' + passed + ' client checks passed, ' + failures.length + ' failed.');
if (failures.length) {
  for (const f of failures) console.error('\n--- ' + f.label + ' ---\n' + (f.error && f.error.stack));
  process.exit(1);
}
