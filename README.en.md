# dsh-selection-translate · Select-to-Translate

Select any text inside the DSH client → a small **译** (translate) button appears next to it → click once and the model translates it in place. Copy with one click.

By default it **reuses the model your current session is already using** (through the Host-side `llm` service), so **no extra API key is required**. It can also be pointed at any **OpenAI-compatible endpoint**.

> 中文文档见 [README.md](README.md)。

---

## Features

| Feature | Description |
| --- | --- |
| Selection trigger | Select text with the mouse (inputs, chat transcript, tool output, document preview) and a **译** button floats next to the selection |
| One-click translate | Calls the model and shows the result in a popover anchored to the selection |
| Smart placement | The popover avoids screen edges and flips above / clamps into view when space runs out |
| Target language | A row of language chips retranslates instantly to another language |
| Smart zh⇄en | The default **Smart** mode translates Chinese→English and everything else→Simplified Chinese |
| Copy result | One-click copy, with an `execCommand` fallback outside secure contexts |
| Two model sources | ① the current session model (default, zero-config) ② any OpenAI-compatible endpoint |
| Settings | **Settings → General** gains a row: on/off switch, default target language, and a **Model & endpoint** expander (provider switch / base URL / model / API key / test) |
| Privacy | The API key lives only on the Host side and is **never sent to the browser**; the browser only posts `{text, targetLang, sessionId}` |

## Usage

1. Select a piece of text → a **译** button appears at the end of the selection.
2. Click **译** → a popover opens showing the source text and starts translating.
3. To switch language, click a language chip at the bottom (`智能 / 简中 / 繁中 / EN / 日 / 韩 …`).
4. **复制译文** copies the result, **重译** retries, and `Esc` or a click outside closes it.

> Keyboard selection (`Shift + arrow keys`) also triggers the button.

## Install

This is a standard DSH bundle package. Install it into a profile:

```bash
# from GitHub
dsh plugin --profile desktop add github:huanleyabo/dsh-selection-translate

# or from a local checkout
dsh plugin --profile desktop add link:/absolute/path/to/dsh-selection-translate
```

`cordis.patch.yml` inserts the plugin row into the profile's loader tree:

```yaml
- insert:
    - id: dsh-selection-translate
      name: dsh-selection-translate
```

## Configuration

The config file lives at `~/.dsh/selection-translate.json` (mode `0600`):

```json
{
  "enabled": true,
  "targetLang": "auto",
  "maxChars": 6000,
  "temperature": 0.1,
  "timeoutMs": 60000,
  "provider": "current",
  "endpoint": "",
  "model": "",
  "apiKey": ""
}
```

| Field | Description |
| --- | --- |
| `enabled` | Master switch for select-to-translate |
| `targetLang` | Default target language; `auto` means smart zh⇄en |
| `maxChars` | Maximum characters per request (guards against accidental huge selections) |
| `temperature` | Sampling temperature; keep it low for translation |
| `timeoutMs` | Per-request timeout (default 60s) |
| `provider` | `current` uses the current session model; `external` uses the endpoint below |
| `endpoint` / `model` / `apiKey` | Used when `provider` is `"external"`; `endpoint` must be a full `/chat/completions` URL |

### How the current model is resolved (`provider: "current"`)

The Host resolves the model in this order and uses the first hit:

1. the session named by the request's `sessionId`, via `requestContext()` / `requestHeader()`;
2. `agentDefaultModel.currentSelection()` (the "default model" setting);
3. the most recent live session that yields a provider and model.

If none resolve, the plugin tells you to pick a model in the composer or switch to a custom endpoint.

## Host HTTP API

Prefix `/api/dsh-selection-translate`:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/ping` | Health check |
| `GET` | `/config` | Read config (**without** `apiKey`; only `hasApiKey`) |
| `POST` | `/config` | Patch the config, returns the redacted full config |
| `POST` | `/translate` | `{ text, targetLang?, sessionId? }` → `{ ok, text, provider, model, targetLang, ms }` |

Translation failures come back as `{ ok: false, error }` with HTTP 200 so the UI can show the reason in place.

## Slots used

| Slot | Purpose |
| --- | --- |
| `shell.overlay` | Frame-wide floating layer: the **译** button and the result popover (`replaceRisk: none`, purely additive) |
| `settings.general.item` | The General-settings preference row; **the full configuration lives here**, so it is always reachable |
| `settings.plugin.item` | Optional Plugins-page card; some compositions do not declare this seat, in which case registration only warns and nothing else is affected |

## Tests

Two self-contained verification scripts that need no dependencies (React is not installed on disk, so they ship a minimal React hook runtime and DOM stub):

```bash
node test/host.test.mjs     # 32 checks
node test/client.test.mjs   # 14 checks
```

## License

MIT
