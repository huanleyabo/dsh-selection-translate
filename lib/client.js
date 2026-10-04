/* dsh-selection-translate — client bundle v0.1.0
 *
 * Select any text inside the DSH client → a small「译」button appears next to
 * the selection → click it and the translation pops up in place.
 *
 * Seats used:
 *   shell.overlay      – frame-wide floating layer (the button + result popover)
 *   settings.general.item – enable toggle + default target language
 *   settings.plugin.item  – full provider configuration card
 *
 * The model call happens in the Host half; this half only talks to
 * /api/dsh-selection-translate/*.
 */
(function () {
  function initModule(require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React =
      typeof window !== 'undefined' && window.React
        ? window.React
        : require
          ? require('react')
          : null;

    var plugin = (function () {
      var API = '/api/dsh-selection-translate';
      var MIN_CHARS = 1;

      var LANGS = [
        { value: 'auto', label: '智能中英互译', short: '智能' },
        { value: 'zh-CN', label: '简体中文', short: '简中' },
        { value: 'zh-TW', label: '繁體中文', short: '繁中' },
        { value: 'en', label: 'English', short: 'EN' },
        { value: 'ja', label: '日本語', short: '日' },
        { value: 'ko', label: '한국어', short: '한' },
        { value: 'fr', label: 'Français', short: 'FR' },
        { value: 'de', label: 'Deutsch', short: 'DE' },
        { value: 'es', label: 'Español', short: 'ES' },
        { value: 'ru', label: 'Русский', short: 'RU' },
        { value: 'pt', label: 'Português', short: 'PT' },
        { value: 'it', label: 'Italiano', short: 'IT' },
        { value: 'ar', label: 'العربية', short: 'AR' },
      ];

      var DEFAULT_CONFIG = {
        enabled: true,
        targetLang: 'auto',
        maxChars: 6000,
        temperature: 0.1,
        timeoutMs: 60000,
        provider: 'current',
        endpoint: '',
        model: '',
        hasApiKey: false,
      };

      var CSS = [
        '[data-dsh-st-ui]{pointer-events:auto;font-family:inherit;box-sizing:border-box}',
        '[data-dsh-st-ui] *{box-sizing:border-box}',

        /* floating trigger next to the selection */
        '.dsh-st-trigger{position:fixed;z-index:10050;display:inline-flex;align-items:center;gap:4px;',
        'height:26px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);',
        'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
        'box-shadow:0 4px 14px rgba(0,0,0,.22);cursor:pointer;font-size:12px;line-height:1;',
        'font-weight:600;user-select:none;-webkit-user-select:none;white-space:nowrap;',
        'transition:transform .12s ease,border-color .12s ease,color .12s ease}',
        '.dsh-st-trigger:hover{transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary);',
        'color:var(--dsw-alias-brand-primary)}',
        '.dsh-st-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',

        /* result popover */
        '.dsh-st-pop{position:fixed;z-index:10051;width:420px;max-width:calc(100vw - 24px);',
        'border-radius:12px;border:1px solid var(--dsw-alias-border-l2);',
        'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
        'box-shadow:0 14px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}',
        '.dsh-st-head{display:flex;align-items:center;gap:8px;padding:8px 10px;',
        'border-bottom:1px solid var(--dsw-alias-border-l1)}',
        '.dsh-st-title{font-size:12.5px;font-weight:700;white-space:nowrap}',
        '.dsh-st-badge{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:5px;',
        'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);',
        'max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-st-spacer{flex:1 1 auto}',
        '.dsh-st-iconbtn{appearance:none;border:1px solid transparent;background:transparent;',
        'color:var(--dsw-alias-label-secondary);width:22px;height:22px;border-radius:6px;',
        'cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;',
        'justify-content:center;padding:0}',
        '.dsh-st-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',

        '.dsh-st-body{padding:10px;display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto}',
        '.dsh-st-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
        '.dsh-st-src{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);',
        'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);',
        'border-radius:8px;padding:7px 9px;max-height:76px;overflow:auto;white-space:pre-wrap;',
        'word-break:break-word}',
        '.dsh-st-out{font-size:13.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;',
        'border-radius:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);',
        'background:var(--dsw-alias-bg-layer-1);min-height:52px}',
        '.dsh-st-out-ok{border-color:var(--dsw-alias-border-l2)}',
        '.dsh-st-err{font-size:12.5px;line-height:1.55;color:var(--dsw-alias-state-error-primary);',
        'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary);',
        'border-radius:8px;padding:9px 10px;word-break:break-word}',
        '.dsh-st-loading{display:flex;align-items:center;gap:8px;font-size:12.5px;',
        'color:var(--dsw-alias-label-secondary);padding:16px 4px;justify-content:center}',
        '.dsh-st-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);',
        'border-top-color:var(--dsw-alias-brand-primary);animation:dshStSpin .8s linear infinite}',
        '@keyframes dshStSpin{to{transform:rotate(360deg)}}',

        '.dsh-st-foot{display:flex;align-items:center;gap:6px;padding:8px 10px;flex-wrap:wrap;',
        'border-top:1px solid var(--dsw-alias-border-l1)}',
        '.dsh-st-btn{appearance:none;font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;',
        'border:1px solid var(--dsw-alias-border-l2);background:transparent;',
        'color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
        '.dsh-st-btn:hover:enabled{background:var(--dsw-alias-bg-layer-2)}',
        '.dsh-st-btn:disabled{opacity:.5;cursor:default}',
        '.dsh-st-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);',
        'color:#fff;font-weight:600}',
        '.dsh-st-btn-primary:hover:enabled{opacity:.9}',
        '.dsh-st-chip{appearance:none;font:inherit;font-size:11px;padding:2px 7px;border-radius:999px;',
        'border:1px solid var(--dsw-alias-border-l1);background:transparent;',
        'color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
        '.dsh-st-chip:hover{color:var(--dsw-alias-label-primary)}',
        '.dsh-st-chip-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);',
        'color:#fff;font-weight:600}',
        '.dsh-st-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}',

        /* settings rows */
        '.dsh-st-sect{display:flex;align-items:center;gap:10px;min-height:34px;width:100%}',
        '.dsh-st-sect-name{font-size:13px;font-weight:600;min-width:96px}',
        '.dsh-st-sect-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
        '.dsh-st-sect-grow{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.dsh-st-field{display:flex;flex-direction:column;gap:5px}',
        '.dsh-st-input,.dsh-st-select{width:100%;font:inherit;font-size:12.5px;padding:5px 8px;',
        'border-radius:6px;border:1px solid var(--dsw-alias-border-l2);',
        'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none}',
        '.dsh-st-input:focus,.dsh-st-select:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.dsh-st-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
        'border-radius:10px;overflow:hidden;margin-bottom:10px}',
        '.dsh-st-card > summary{cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:10px;',
        'list-style:none;user-select:none}',
        '.dsh-st-card > summary::-webkit-details-marker{display:none}',
        '.dsh-st-card[open] > summary{border-bottom:1px solid var(--dsw-alias-border-l1)}',
        '.dsh-st-cardbody{padding:12px 14px;display:flex;flex-direction:column;gap:11px}',
        '.dsh-st-ok{font-size:11.5px;color:var(--dsw-alias-state-success-primary);font-weight:600}',
        '.dsh-st-warn{font-size:11.5px;color:var(--dsw-alias-state-warn-primary);font-weight:600}',
        '.dsh-st-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.dsh-st-switch{appearance:none;width:34px;height:19px;border-radius:999px;cursor:pointer;',
        'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
        'position:relative;transition:background .15s,border-color .15s;flex:none}',
        '.dsh-st-switch::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;',
        'border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s,background .15s}',
        '.dsh-st-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
        '.dsh-st-switch:checked::after{transform:translateX(15px);background:#fff}',
      ].join('');

      /* ------------------------------------------------------------ config */

      var store = { config: DEFAULT_CONFIG, loaded: false };
      var listeners = new Set();

      function emit() {
        listeners.forEach(function (fn) {
          try {
            fn(store.config);
          } catch (e) {}
        });
      }

      function loadConfig() {
        return fetch(API + '/config', { headers: { Accept: 'application/json' } })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            if (data && data.ok && data.config) {
              store.config = data.config;
              store.loaded = true;
              emit();
            }
            return store.config;
          })
          .catch(function () {
            return store.config;
          });
      }

      function saveConfig(patch) {
        store.config = Object.assign({}, store.config, patch);
        emit();
        return fetch(API + '/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            if (data && data.ok && data.config) {
              store.config = data.config;
              emit();
            }
            return store.config;
          })
          .catch(function () {
            return store.config;
          });
      }

      function useConfig() {
        var state = React.useState(store.config);
        var config = state[0];
        var setConfig = state[1];
        React.useEffect(function () {
          listeners.add(setConfig);
          if (!store.loaded) loadConfig();
          return function () {
            listeners.delete(setConfig);
          };
        }, []);
        return [config, saveConfig];
      }

      /* --------------------------------------------------------- selection */

      function rectOf(node) {
        var r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }

      /** Read the current selection, including input/textarea selections. */
      function readSelection() {
        try {
          var active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            var start = active.selectionStart;
            var end = active.selectionEnd;
            if (typeof start === 'number' && typeof end === 'number' && end > start) {
              var text = String(active.value || '').slice(start, end);
              if (text.trim().length >= MIN_CHARS) return { text: text, rect: rectOf(active) };
            }
            return null;
          }
          var sel = window.getSelection ? window.getSelection() : null;
          if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
          var raw = sel.toString();
          if (!raw || raw.trim().length < MIN_CHARS) return null;
          var range = sel.getRangeAt(0);
          var node = range.commonAncestorContainer;
          var el = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
          if (el && el.closest && el.closest('[data-dsh-st-ui]')) return null;
          var rects = range.getClientRects();
          var box = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
          if (!box || (!box.width && !box.height)) return null;
          return { text: raw, rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } };
        } catch (e) {
          return null;
        }
      }

      function clamp(value, min, max) {
        if (max < min) return min;
        return Math.min(max, Math.max(min, value));
      }

      /* ------------------------------------------------------- translation */

      function requestTranslation(text, targetLang, sessionId) {
        return fetch(API + '/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, targetLang: targetLang, sessionId: sessionId || '' }),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            if (!data || !data.ok) throw new Error((data && data.error) || '翻译失败。');
            return data;
          });
      }

      function copyText(text) {
        if (!text) return Promise.resolve(false);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(
              function () {
                return true;
              },
              function () {
                return legacyCopy(text);
              },
            );
          }
        } catch (e) {}
        return Promise.resolve(legacyCopy(text));
      }

      function legacyCopy(text) {
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(area);
          return ok;
        } catch (e) {
          return false;
        }
      }

      /* --------------------------------------------------- overlay widget */

      function SelectionTranslator(props) {
        var useSessions = props.useSessions;
        var sessionId = '';
        try {
          if (typeof useSessions === 'function') {
            sessionId =
              useSessions(function (state) {
                if (!state || !state.byId) return '';
                var ids = Object.keys(state.byId);
                for (var i = 0; i < ids.length; i += 1) {
                  var s = state.byId[ids[i]];
                  if (s && s.retainedBy && (s.retainedBy.mainView || 0) > 0) return ids[i];
                }
                return '';
              }) || '';
          }
        } catch (e) {
          sessionId = '';
        }

        var cfgState = useConfig();
        var config = cfgState[0] || DEFAULT_CONFIG;

        var anchorState = React.useState(null);
        var anchor = anchorState[0];
        var setAnchor = anchorState[1];

        var panelState = React.useState(null);
        var panel = panelState[0];
        var setPanel = panelState[1];

        var copiedState = React.useState(false);
        var copied = copiedState[0];
        var setCopied = copiedState[1];

        var panelRef = React.useRef(null);

        var enabled = config.enabled !== false;

        /* watch the selection */
        React.useEffect(
          function () {
            if (!enabled) {
              setAnchor(null);
              return undefined;
            }
            var timer = null;

            function refresh() {
              if (panelRef.current) return;
              var next = readSelection();
              setAnchor(next ? { text: next.text, rect: next.rect } : null);
            }

            function schedule() {
              if (timer) clearTimeout(timer);
              timer = setTimeout(refresh, 120);
            }

            function onDown(event) {
              var target = event.target;
              if (target && target.closest && target.closest('[data-dsh-st-ui]')) return;
              setAnchor(null);
              setPanel(null);
            }

            function onKey(event) {
              if (event.key === 'Escape') {
                setAnchor(null);
                setPanel(null);
                return;
              }
              if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                schedule();
              }
            }

            document.addEventListener('mouseup', schedule, true);
            document.addEventListener('keyup', schedule, true);
            document.addEventListener('selectionchange', schedule);
            document.addEventListener('mousedown', onDown, true);
            document.addEventListener('keydown', onKey, true);
            window.addEventListener('scroll', schedule, true);
            window.addEventListener('resize', schedule, true);
            return function () {
              if (timer) clearTimeout(timer);
              document.removeEventListener('mouseup', schedule, true);
              document.removeEventListener('keyup', schedule, true);
              document.removeEventListener('selectionchange', schedule);
              document.removeEventListener('mousedown', onDown, true);
              document.removeEventListener('keydown', onKey, true);
              window.removeEventListener('scroll', schedule, true);
              window.removeEventListener('resize', schedule, true);
            };
          },
          [enabled, panel === null],
        );

        var run = React.useCallback(
          function (text, targetLang) {
            var lang = targetLang || config.targetLang || 'auto';
            setCopied(false);
            setPanel(function (prev) {
              return {
                text: text,
                targetLang: lang,
                status: 'loading',
                result: '',
                error: '',
                model: '',
                ms: 0,
                x: prev ? prev.x : 0,
                y: prev ? prev.y : 0,
              };
            });
            return requestTranslation(text, lang, sessionId)
              .then(function (data) {
                setPanel(function (prev) {
                  if (!prev || prev.text !== text) return prev;
                  return Object.assign({}, prev, {
                    status: 'done',
                    result: data.text,
                    model: data.model || '',
                    ms: data.ms || 0,
                  });
                });
                return data;
              })
              .catch(function (error) {
                setPanel(function (prev) {
                  if (!prev || prev.text !== text) return prev;
                  return Object.assign({}, prev, {
                    status: 'error',
                    error: (error && error.message) || String(error),
                  });
                });
                return null;
              });
          },
          [config.targetLang, sessionId],
        );

        function openFrom(anchorValue) {
          var status = anchorValue;
          var text = String(anchorValue.text || '');
          var rect = anchorValue.rect;
          var width = 420;
          var left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
          var top = rect.bottom + 8;
          if (top + 260 > window.innerHeight) {
            top = Math.max(12, rect.top - 260 - 8);
          }
          setPanel({
            text: text,
            targetLang: config.targetLang || 'auto',
            status: 'loading',
            result: '',
            error: '',
            model: '',
            ms: 0,
            x: left,
            y: top,
          });
          setAnchor(null);
          run(text, config.targetLang || 'auto');
        }

        /* keep the panel inside the viewport and close it when its anchor dies */
        React.useEffect(
          function () {
            if (!panelRef.current || !panel) return;
            var node = panelRef.current;
            var height = node.offsetHeight || 240;
            if (panel.y + height > window.innerHeight - 8) {
              var next = clamp(window.innerHeight - height - 8, 12, Math.max(12, window.innerHeight - height - 8));
              if (Math.abs(next - panel.y) > 2) {
                setPanel(function (prev) {
                  return prev ? Object.assign({}, prev, { y: next }) : prev;
                });
              }
            }
          },
          [panel && panel.status, panel && panel.result, panel && panel.error],
        );

        if (!enabled) return null;

        var trigger = null;
        if (anchor && !panel) {
          var tLeft = clamp(anchor.rect.right + 6, 8, Math.max(8, window.innerWidth - 84));
          var tTop = anchor.rect.top - 32;
          if (tTop < 8) tTop = Math.min(window.innerHeight - 34, anchor.rect.bottom + 6);
          trigger = React.createElement(
            'button',
            {
              type: 'button',
              'data-dsh-st-ui': '1',
              className: 'dsh-st-trigger',
              style: { left: tLeft + 'px', top: tTop + 'px' },
              title: '翻译选中的文字',
              onMouseDown: function (event) {
                event.preventDefault();
                event.stopPropagation();
              },
              onClick: function (event) {
                event.preventDefault();
                event.stopPropagation();
                openFrom(anchor);
              },
            },
            React.createElement('span', { style: { fontSize: '13px' } }, '译'),
            React.createElement('span', null, '翻译'),
          );
        }

        var popover = null;
        if (panel) {
          var head = React.createElement(
            'div',
            { className: 'dsh-st-head' },
            React.createElement('span', { className: 'dsh-st-title' }, '划词翻译'),
            panel.model ? React.createElement('span', { className: 'dsh-st-badge', title: panel.model }, panel.model) : null,
            panel.status === 'done' && panel.ms
              ? React.createElement('span', { className: 'dsh-st-badge' }, Math.round(panel.ms / 100) / 10 + 's')
              : null,
            React.createElement('span', { className: 'dsh-st-spacer' }),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-iconbtn',
                title: '关闭 (Esc)',
                onClick: function () {
                  setPanel(null);
                },
              },
              '×',
            ),
          );

          var bodyChildren = [];
          bodyChildren.push(
            React.createElement('div', { className: 'dsh-st-label' }, '原文'),
            React.createElement('div', { className: 'dsh-st-src' }, panel.text),
            React.createElement('div', { className: 'dsh-st-label' }, '译文'),
          );
          if (panel.status === 'loading') {
            bodyChildren.push(
              React.createElement(
                'div',
                { className: 'dsh-st-loading' },
                React.createElement('span', { className: 'dsh-st-spin' }),
                React.createElement('span', null, '正在调用模型翻译…'),
              ),
            );
          } else if (panel.status === 'error') {
            bodyChildren.push(React.createElement('div', { className: 'dsh-st-err' }, panel.error || '翻译失败。'));
          } else {
            bodyChildren.push(React.createElement('div', { className: 'dsh-st-out dsh-st-out-ok' }, panel.result));
          }

          var chips = LANGS.map(function (lang) {
            return React.createElement(
              'button',
              {
                key: lang.value,
                type: 'button',
                className: 'dsh-st-chip' + (panel.targetLang === lang.value ? ' dsh-st-chip-on' : ''),
                title: lang.label,
                onClick: function () {
                  run(panel.text, lang.value);
                },
              },
              lang.short,
            );
          });

          var foot = React.createElement(
            'div',
            { className: 'dsh-st-foot' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-btn dsh-st-btn-primary',
                disabled: panel.status !== 'done' || !panel.result,
                onClick: function () {
                  copyText(panel.result).then(function (ok) {
                    setCopied(!!ok);
                  });
                },
              },
              copied ? '已复制 ✓' : '复制译文',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-btn',
                disabled: panel.status === 'loading',
                onClick: function () {
                  run(panel.text, panel.targetLang);
                },
              },
              panel.status === 'loading' ? '翻译中…' : '重译',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-btn',
                onClick: function () {
                  setPanel(null);
                },
              },
              '关闭',
            ),
            React.createElement('span', { className: 'dsh-st-spacer' }),
            React.createElement('span', { className: 'dsh-st-hint' }, '目标语言'),
          );

          popover = React.createElement(
            'div',
            {
              'data-dsh-st-ui': '1',
              className: 'dsh-st-pop',
              ref: panelRef,
              style: { left: panel.x + 'px', top: panel.y + 'px' },
              onMouseDown: function (event) {
                event.stopPropagation();
              },
            },
            head,
            React.createElement('div', { className: 'dsh-st-body' }, bodyChildren),
            React.createElement('div', { className: 'dsh-st-foot' }, chips),
            foot,
          );
        }

        return React.createElement(React.Fragment, null, trigger, popover);
      }

      /* -------------------------------------------------------- settings */

      /**
       * The shared configuration fields. Rendered by the General preference
       * row (always present) and, where the profile declares that seat, by the
       * Plugins-section card as well.
       */
      function ConfigFields() {
        var cfgState = useConfig();
        var config = cfgState[0] || DEFAULT_CONFIG;
        var save = cfgState[1];
        var showKeyState = React.useState(false);
        var showKey = showKeyState[0];
        var setShowKey = showKeyState[1];
        var testState = React.useState(null);
        var test = testState[0];
        var setTest = testState[1];
        var draftState = React.useState({ endpoint: '', model: '', apiKey: '' });
        var draft = draftState[0];
        var setDraft = draftState[1];
        var noticeState = React.useState('');
        var notice = noticeState[0];
        var setNotice = noticeState[1];

        React.useEffect(
          function () {
            setDraft({
              endpoint: config.endpoint || '',
              model: config.model || '',
              apiKey: '',
            });
          },
          [config.endpoint, config.model],
        );

        function flash(message) {
          setNotice(message);
          setTimeout(function () {
            setNotice('');
          }, 1800);
        }

        function persistExternal() {
          save({
            endpoint: draft.endpoint,
            model: draft.model,
            apiKey: draft.apiKey,
          }).then(function () {
            setDraft(function (prev) {
              return Object.assign({}, prev, { apiKey: '' });
            });
            flash('已保存');
          });
        }

        function runTest() {
          setTest({ ok: null, text: '测试中…' });
          fetch(API + '/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Hello, world!', targetLang: 'zh-CN' }),
          })
            .then(function (res) {
              return res.json();
            })
            .then(function (data) {
              if (data && data.ok) setTest({ ok: true, text: '成功：' + String(data.text || '').slice(0, 80) });
              else setTest({ ok: false, text: (data && data.error) || '测试失败。' });
            })
            .catch(function (error) {
              setTest({ ok: false, text: (error && error.message) || '测试失败。' });
            });
        }

        var isExternal = config.provider === 'external';
        var nodes = [];

        nodes.push(
          React.createElement(
            'div',
            { className: 'dsh-st-row' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-btn' + (!isExternal ? ' dsh-st-btn-primary' : ''),
                onClick: function () {
                  save({ provider: 'current' });
                },
              },
              '使用当前会话模型',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-st-btn' + (isExternal ? ' dsh-st-btn-primary' : ''),
                onClick: function () {
                  save({ provider: 'external' });
                },
              },
              '自定义 OpenAI 兼容端点',
            ),
          ),
        );

        if (!isExternal) {
          nodes.push(
            React.createElement(
              'div',
              { className: 'dsh-st-hint' },
              '直接复用当前会话所选的模型，无需额外 API Key；模型由 Host 端 llm 服务解析。',
            ),
          );
        } else {
          nodes.push(
            React.createElement(
              'div',
              { className: 'dsh-st-field' },
              React.createElement('span', { className: 'dsh-st-label' }, 'API Base URL（/chat/completions）'),
              React.createElement('input', {
                className: 'dsh-st-input',
                type: 'text',
                value: draft.endpoint,
                placeholder: 'https://api.openai.com/v1/chat/completions',
                onChange: function (event) {
                  setDraft(Object.assign({}, draft, { endpoint: event.target.value }));
                },
              }),
            ),
            React.createElement(
              'div',
              { className: 'dsh-st-field' },
              React.createElement('span', { className: 'dsh-st-label' }, '模型名称'),
              React.createElement('input', {
                className: 'dsh-st-input',
                type: 'text',
                value: draft.model,
                placeholder: 'gpt-4o-mini',
                onChange: function (event) {
                  setDraft(Object.assign({}, draft, { model: event.target.value }));
                },
              }),
            ),
            React.createElement(
              'div',
              { className: 'dsh-st-field' },
              React.createElement(
                'span',
                { className: 'dsh-st-label' },
                'API Key' + (config.hasApiKey ? '（已保存，留空则保持不变）' : ''),
              ),
              React.createElement(
                'div',
                { className: 'dsh-st-row' },
                React.createElement('input', {
                  className: 'dsh-st-input',
                  style: { flex: '1 1 auto', minWidth: '180px' },
                  type: showKey ? 'text' : 'password',
                  value: draft.apiKey,
                  placeholder: config.hasApiKey ? '••••••••' : 'sk-…',
                  onChange: function (event) {
                    setDraft(Object.assign({}, draft, { apiKey: event.target.value }));
                  },
                }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-st-btn',
                    onClick: function () {
                      setShowKey(!showKey);
                    },
                  },
                  showKey ? '隐藏' : '显示',
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dsh-st-btn dsh-st-btn-primary', onClick: persistExternal },
                  '保存',
                ),
              ),
            ),
          );
        }

        nodes.push(
          React.createElement(
            'div',
            { className: 'dsh-st-row' },
            React.createElement('button', { type: 'button', className: 'dsh-st-btn', onClick: runTest }, '测试翻译'),
            notice ? React.createElement('span', { className: 'dsh-st-ok' }, notice) : null,
          ),
        );
        if (test) {
          nodes.push(React.createElement('div', { className: test.ok ? 'dsh-st-ok' : 'dsh-st-warn' }, test.text));
        }

        return React.createElement('div', { className: 'dsh-st-cardbody' }, nodes);
      }

      /**
       * The General-section preference row: switch, default language, and the
       * full provider configuration behind an expander.
       */
      function GeneralRow() {
        var cfgState = useConfig();
        var config = cfgState[0] || DEFAULT_CONFIG;
        var save = cfgState[1];
        var enabled = config.enabled !== false;
        var openState = React.useState(false);
        var open = openState[0];
        var setOpen = openState[1];
        var isExternal = config.provider === 'external';

        return React.createElement(
          'div',
          { className: 'dsh-st-sectwrap', 'data-dsh-st-ui': '1' },
          React.createElement(
            'div',
            { className: 'dsh-st-sect' },
            React.createElement(
              'div',
              { className: 'dsh-st-sect-grow' },
              React.createElement('div', { className: 'dsh-st-sect-name' }, '划词翻译'),
              React.createElement(
                'div',
                { className: 'dsh-st-sect-desc' },
                enabled
                  ? '选中文字后点击「译」即可翻译 · ' + (isExternal ? '自定义端点' : '当前会话模型')
                  : '已关闭',
              ),
            ),
            React.createElement(
              'select',
              {
                className: 'dsh-st-select',
                style: { width: '150px', flex: 'none' },
                value: config.targetLang || 'auto',
                disabled: !enabled,
                title: '默认目标语言',
                onChange: function (event) {
                  save({ targetLang: event.target.value });
                },
              },
              LANGS.map(function (lang) {
                return React.createElement('option', { key: lang.value, value: lang.value }, lang.label);
              }),
            ),
            React.createElement('input', {
              type: 'checkbox',
              className: 'dsh-st-switch',
              checked: enabled,
              title: enabled ? '关闭划词翻译' : '开启划词翻译',
              onChange: function (event) {
                save({ enabled: event.target.checked });
              },
            }),
          ),
          React.createElement(
            'details',
            {
              className: 'dsh-st-card',
              style: { marginBottom: 0 },
              open: open,
              onToggle: function (event) {
                setOpen(event.currentTarget.open);
              },
            },
            React.createElement(
              'summary',
              null,
              React.createElement('span', { className: 'dsh-st-hint' }, '模型与端点设置'),
              React.createElement('span', { className: 'dsh-st-spacer' }),
              React.createElement('span', { className: 'dsh-st-badge' }, isExternal ? '自定义端点' : '当前会话模型'),
            ),
            React.createElement(ConfigFields, null),
          ),
        );
      }

      /** The Plugins-section card (only where that seat is declared). */
      function ConfigCard() {
        var cfgState = useConfig();
        var config = cfgState[0] || DEFAULT_CONFIG;
        var openState = React.useState(false);
        var open = openState[0];
        var setOpen = openState[1];

        return React.createElement(
          'details',
          {
            className: 'dsh-st-card',
            'data-dsh-st-ui': '1',
            open: open,
            onToggle: function (event) {
              setOpen(event.currentTarget.open);
            },
          },
          React.createElement(
            'summary',
            null,
            React.createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, '划词翻译'),
            React.createElement(
              'span',
              { className: 'dsh-st-hint' },
              config.provider === 'external' ? '自定义端点' : '当前会话模型',
            ),
            React.createElement('span', { className: 'dsh-st-spacer' }),
            React.createElement(
              'span',
              { className: 'dsh-st-badge' },
              config.enabled === false ? '已关闭' : '已启用',
            ),
          ),
          React.createElement(ConfigFields, null),
        );
      }


      /* ------------------------------------------------------------- apply */

      function apply(ctx) {
        var slots = ctx.get('slots');
        if (!slots) {
          console.warn('[dsh-selection-translate] slots service unavailable');
          return;
        }

        ctx.effect(function () {
          var style = document.createElement('style');
          style.setAttribute('data-plugin', 'dsh-selection-translate');
          style.textContent = CSS;
          document.head.appendChild(style);
          return function () {
            if (style.parentNode) style.parentNode.removeChild(style);
          };
        }, 'dsh-selection-translate: styles');

        loadConfig();

        try {
          slots.inject('shell.overlay', function () {
            return slots.register(
              { name: 'shell.overlay', id: 'dsh-selection-translate', order: 50 },
              SelectionTranslator,
            );
          });
        } catch (error) {
          console.error('[dsh-selection-translate] shell.overlay registration failed:', error);
        }

        try {
          slots.inject('settings.general.item', function () {
            return slots.register(
              { name: 'settings.general.item', id: 'dsh-selection-translate', order: 40 },
              GeneralRow,
            );
          });
        } catch (error) {
          console.error('[dsh-selection-translate] settings.general.item registration failed:', error);
        }

        // The General row always exists and carries the full configuration.
        // `settings.plugin.item` is only declared in some compositions, so this
        // extra card is best-effort and must never break the plugin when absent.
        try {
          slots.inject('settings.plugin.item', function () {
            return slots.register(
              { name: 'settings.plugin.item', id: 'dsh-selection-translate', key: 'dsh-selection-translate', order: 60 },
              ConfigCard,
            );
          });
        } catch (error) {
          console.warn('[dsh-selection-translate] settings.plugin.item seat unavailable:', error && error.message);
        }
      }

      return { name: 'dsh-selection-translate', inject: ['slots'], apply: apply };
    })();

    exports.name = 'dsh-selection-translate';
    exports.inject = plugin.inject;
    exports.apply = plugin.apply;
    exports.default = { name: exports.name, inject: exports.inject, apply: exports.apply };
    return module.exports;
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && window.__ModuleLoader__.load) {
    window.__ModuleLoader__.load({
      id: 'dsh-selection-translate',
      factory: initModule,
    });
  }
})();
