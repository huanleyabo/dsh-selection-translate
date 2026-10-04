# dsh-selection-translate · DSH 划词翻译

在 DSH 客户端里**选中任意文字**，旁边就会浮出一个「**译**」按钮；点一下，模型就地翻译并在选区旁弹出结果，可一键复制。

默认直接复用**当前会话正在使用的模型**（走 Host 端 `llm` 服务），因此**不需要另外配置 API Key**；也支持切到任意 **OpenAI 兼容端点**。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 划词触发 | 鼠标选中文字（输入框、文本域、聊天记录、工具输出）后，选区旁浮出「译」按钮 |
| 一键翻译 | 点击后调用模型，结果在选区旁的浮层内展示 |
| 就近弹出 | 浮层自动避开屏幕边缘，超出视口时自动上翻 / 收进可视区 |
| 指定语言 | 浮层底部一排语言胶囊可即时切换目标语言并重译 |
| 智能中英互译 | 默认「智能」模式：中文→英文，其他语言→简体中文 |
| 复制译文 | 一键复制，兼容非安全上下文（回退 `execCommand`） |
| 双模型来源 | ① 当前会话模型（默认，零配置）② 自定义 OpenAI 兼容端点 |
| 设置界面 | 「设置 → 通用」新增一行：**开关 + 默认目标语言 + 「模型与端点设置」展开区**（提供商切换 / Base URL / 模型 / API Key / 测试翻译）。若该 profile 声明了 `settings.plugin.item`，插件页还会额外出现一张同样的卡片 |
| 隐私 | API Key 只存在 Host 端，**永不下发到浏览器**；浏览器只发 `{text, targetLang, sessionId}` |

## 交互

1. 用鼠标选中一段文字 → 选区右上角出现「**译**」按钮。
2. 点「**译**」→ 浮层出现，显示原文并开始翻译。
3. 需要换语言 → 点浮层底部的语言胶囊（`智能 / 简中 / 繁中 / EN / 日 / 韩 …`）。
4. 「**复制译文**」复制结果，「**重译**」重新请求，`Esc` 或点击空白处关闭。

> 键盘选择文字（`Shift + 方向键`）同样会触发按钮。

## 安装

本插件是一个标准的 DSH bundle 包，把整个目录作为一个本地包安装进 profile 即可：

```bash
# 在 DSH 检出目录下，使用桌面 profile
dsh plugin --profile desktop add link:<本目录绝对路径>/dsh-selection-translate
```

或者在该 profile 的 `package.json` 中把本包加进 `dependencies` 与 `dsh.profile.bundles`，然后重新加载 profile。

`cordis.patch.yml` 会把插件行插入 profile 的加载树：

```yaml
- insert:
    - id: dsh-selection-translate
      name: dsh-selection-translate
```

装好后重启 DSH（或让 profile 热加载），选任意文字即可看到「译」按钮。

## 配置

配置文件落在 `~/.dsh/selection-translate.json`（`0600` 权限）：

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

| 字段 | 说明 |
| --- | --- |
| `enabled` | 划词翻译总开关 |
| `targetLang` | 默认目标语言，`auto` 为智能中英互译 |
| `maxChars` | 单次可翻译的最大字符数（超出会报错提示，避免误选超长内容） |
| `temperature` | 采样温度，翻译建议保持低值 |
| `timeoutMs` | 单次翻译超时（默认 60s） |
| `provider` | `current` 用当前会话模型；`external` 用下面的自定义端点 |
| `endpoint` / `model` / `apiKey` | `provider: "external"` 时使用，`endpoint` 需是 `/chat/completions` 完整地址 |

### 模型来源如何解析（`provider: "current"`）

Host 端按以下顺序取模型，取到即用：

1. 请求里带的 `sessionId` 对应会话的 `requestContext()/requestHeader()`；
2. `agentDefaultModel.currentSelection()`（即"默认模型"设置）；
3. 所有活动会话中最近一个可解析出模型的会话。

若都取不到，会提示你去输入框下方选择模型，或改用自定义端点。

## 内部接口（Host 端 HTTP 路由）

前缀 `/api/dsh-selection-translate`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/ping` | 健康检查 |
| `GET` | `/config` | 读取配置（**不含** `apiKey`，只回 `hasApiKey`） |
| `POST` | `/config` | 局部更新配置，返回脱敏后的完整配置 |
| `POST` | `/translate` | `{ text, targetLang?, sessionId? }` → `{ ok, text, provider, model, targetLang, ms }` |

翻译错误以 `{ ok: false, error }` 返回（HTTP 200），便于前端就地展示失败原因。

## 结构

```
dsh-selection-translate/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 把插件行插入 profile
├── lib/
│   ├── index.js          # Host：配置持久化、模型调用、HTTP 路由
│   └── client.js         # 浏览器：选区监听、浮层、设置界面
├── test/
│   ├── host.test.mjs     # Host 端 32 项：配置、prompt、路由解析、模型流、HTTP 面
│   └── client.test.mjs   # 浏览器端 14 项：选区→按钮→浮层→翻译→复制→设置
└── README.md
```

### 挂载的 Slot

| Slot | 用途 |
| --- | --- |
| `shell.overlay` | 全框浮动层：选区旁的「译」按钮 + 结果浮层（`replaceRisk: none`，纯追加） |
| `settings.general.item` | 通用设置里的偏好行；**完整配置都在这里**，因此必然可见 |
| `settings.plugin.item` | 可选的插件页卡片；某些组合（如本机 desktop profile）未声明该 seat，注册失败只告警、不影响其余功能 |

## 测试

两个自包含的校验脚本，不需要安装任何依赖（React 未落盘，脚本自带一个最小 React Hook 运行时 + DOM 桩）：

```bash
node test/host.test.mjs     # 32 checks
node test/client.test.mjs   # 14 checks
```

Host 端覆盖：配置读写与钳位、密钥不下发、损坏配置降级、prompt 组装、译文清洗、四级模型解析回退、流式分片收集、finish 错误/超时/空输出、外部端点请求体与错误透传、路由注册与释放、HTTP ping/config/translate。
浏览器端覆盖：三处 slot 注册、样式注入、无 slot 时不崩、**选区→按钮出现→点击→加载态→译文**、错误态、语言胶囊重译、复制、Esc 关闭、通用设置与插件卡片的读写、关闭时不渲染、选插件自身 UI 不自我触发。

## 已知边界

- **不覆盖 iframe 内的文字。** 文档预览里的 HTML 页（`iframe[data-html-preview]`）、侧栏浏览器页等位于独立文档，父页面的 `getSelection()` 取不到其中的选区，因此这些区域划词不会弹出按钮。本插件的选区监听只挂在主文档上。
- 选区监听基于 `selectionchange` + `mouseup`/`keyup`；`contenteditable`（如 Composer 输入框）走标准 `window.getSelection()` 路径，原生 `INPUT`/`TEXTAREA` 走 `selectionStart/End` 路径。
- `provider: "current"` 依赖 Host 端 `llm` 与 `sessions` 服务在场；缺失时会给出明确报错而不是静默失败。
- 自定义端点必须是 OpenAI 兼容的 `chat/completions` 协议。

## License

MIT
