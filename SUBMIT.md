# 投稿凭条 — dsh-selection-translate

> 这份文件是给你自己用的操作清单，**不要**把它提交到上游仓库。
> 上游只需要 `data/plugins/huanleyabo__dsh-selection-translate.yml` 一个文件。

## 一、现在（今天）要做的一件事

给仓库加 `dsh-plugin` topic —— 这是上游 CI 的检查项，不加会被拦。

👉 https://github.com/huanleyabo/dsh-selection-translate

点 About 右侧的 ⚙️ 齿轮 → **Topics** 填 `dsh-plugin` → Save

## 二、等满 24 小时后投稿

仓库创建于 `2026-10-04 13:11 UTC`，**达标时间：本地 2026-10-05 21:11**。

> 上游 CI 的年龄门槛由时间自动满足，且 `regate.yml` 每 6 小时自动重跑。
> 也就是说：**即使你提前提了 PR，这个检查也会自己变绿**，不需要关闭重开、不需要补提交。
> 但等到达标再提要干净些。

## 三、投稿步骤

上游要求一个 PR **只加一个文件**：

```
data/plugins/huanleyabo__dsh-selection-translate.yml
```

**内容**：直接复制本仓库根目录的 `huanleyabo__dsh-selection-translate.yml`。

**方式**（网页即可，不用命令行）：

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
2. 点 **Fork**（这会创建 `huanleyabo/awesome-dsh-plugin`）
3. 在你的 fork 里进入 `data/plugins/` → **Add file** → **Create new file**
4. 文件名填 `huanleyabo__dsh-selection-translate.yml`
5. 内容粘贴本仓库那个同名文件的内容
6. 提交时选 **Create a new branch for this commit and start a pull request**
7. 发起 PR 到上游 `main`

## 四、PR 说明（建议直接粘贴）

````markdown
## What this adds

`huanleyabo/dsh-selection-translate` — select-to-translate for the DSH web client.

Select text in the transcript (or in an input / textarea) and a small translate
button appears at the end of the selection. Clicking it translates that text in
place through the host `llm` service, so it reuses the model the current session
already has selected — no separate API key. An OpenAI-compatible endpoint can be
configured instead. Results open in a popover that stays inside the viewport,
with one-click copy, a row of language buttons for instant retranslation, and
smart Chinese-to-English / other-to-Chinese as the default.

## How it differs from the select-to-translate entries already listed

There are already entries in this space (`dsh-selection-explain`,
`dsh-selection-toolbar`, `dsh-selection-tools`), so here is the difference
plainly, for the reviewer:

- **Instant target-language switching.** The result popover carries a row of
  language buttons; switching retranslates the same selection without
  re-selecting. The listed alternatives target one language.
- **Two model sources.** Default is the current session model via the host
  `llm` service (zero config); the alternative is any OpenAI-compatible
  endpoint.
- **Small capability surface.** It mounts only `shell.overlay` and settings
  rows and requests nothing beyond the host `llm`/`sessions` services — it does
  not take `shell`, `fs`, `credentials`, or `env`.

## Verification

- `dsh.bundle` manifest present; `cordis.patch.yml` at the repo root.
- 46 self-contained checks pass (`node test/host.test.mjs` → 32,
  `node test/client.test.mjs` → 14); they need no dependencies.
- Verified working against a live DSH instance before submitting.

## Known boundary (stated so the description is not read as more than it is)

Text inside iframes is not covered: HTML document previews render in
`iframe[data-html-preview]`, a separate document the parent page's
`getSelection()` cannot see. `contenteditable` (the Composer) and native
`INPUT`/`TEXTAREA` are covered.
````

## 五、CI 会查什么（我已本地复现核对）

上游 `scripts/check-submission.mjs` 的判定，我用自己的脚本复现了一遍：

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | `package.json` 声明 `dsh.bundle` | ✅ `./cordis.patch.yml` |
| 2 | 仓库年龄 ≥ 1 天 | ❌ 时间未到（会自动重跑变绿） |
| 3 | 仓库存在且未归档 | ✅ |
| 4 | 不是 DSH 本体 | ✅ |
| — | 每 PR ≤ 3 条 | ✅ 1 条 |

另外用**上游自己的 `readEntries()`** 校验过我的 YAML：解析通过、文件名 slug 与 url 匹配、category 合法、`description.en` 存在、无未知字段。

## 六、评审会看什么（指南原文摘录）

> **描述必须属实。** 它会被当作对你插件的声明，并与代码核对……夸大是让一个本来不错的插件被打回的主要原因。

所以描述里我**没有**写任何夸大项，并主动在 PR 说明里交代了 iframe 边界——主动说明比被查出来好。

> 两个插件做同一件事时，先来者保留位置……**规则不是先来后到，规则是谁更好。**

所以上面第四节的差异化陈述很重要，建议保留。

## 七、失败时怎么改

CI 失败会在 PR 里逐条说明要改什么。**在同一分支上推送修复即可，不用重开 PR。**
