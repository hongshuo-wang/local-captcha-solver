# Local CAPTCHA Solver MVP 进度交接

更新时间：2026-07-25

## 2026-07-25 Edge 体验工作流更新

Task 7-8 的浏览器体验工作流已经实现并完成代码级验证：候选图片/字段匹配、精确 hostname 白名单和可选权限、本地 offscreen OCR、图片安全获取和空字段填写、动态验证码刷新、右键入口、popup 当前站点开关均已落地。Task 8 另增加了针对构建产物 `.output/chrome-mv3` 的 Playwright E2E 套件：它启动真实 MV3 扩展，并通过 Playwright route 从本地 fixture server 提供未带端口的测试 hostname，覆盖当前站点启用、自动填充、动态 `src` 刷新、预填字段保护、受控 input、聚焦字段 fallback、零提交、离线识别、storage schema 和 popup unsupported 状态。fixture 使用已跟踪且基准证实可识别的 `digits-002.png`（`14975`）和 `digits-017.png`（`99067`）。

跨源验证码图片只有在页面 canvas 可读取 CORS 响应时才可用；带凭据的后台获取严格限制为与页面同源。扩展 host permission 不会绕过非 CORS 或带凭据的跨源读取限制。

本轮 Task 7-8 的实际实现提交如下：

- `d881cf0`、`b7ce122`、`658e95a`：候选评分、严格字段匹配和非空字段保护。
- `d4fea67`、`9cd6562`、`cf42dc7`、`4d7e69e`、`14b4562`：版本化本地设置、hostname 规范化、URL 校验和串行 mutation。
- `db75ac7`、`41657b5`：offscreen 本地 OCR 与推理资产校验。
- `f38a76b`、`3bf3d55`、`d5b82a9`、`7a5ad87`：图片获取、revision 和安全填写。
- `cce7fb0`、`4a37328`、`9792a92`、`69a0117`、`a0744c8`、`ee56c6d`、`d196356`、`2ab0d0b`：自动工作流和动态验证码刷新。
- `86aa016`、`2b88436`、`f29fc75`、`4927259`、`9ab7635`：右键/popup 路由和 popup 当前站点状态竞争保护。

E2E 运行环境仍必须具备 Playwright Chromium 和 headed 显示；缺失浏览器时测试会硬失败并报告精确前置命令 `npx playwright install chromium`，Linux 无显示时报告 `xvfb-run -a npm run test:e2e`，不会静默跳过。此工作树的受限环境在本次记录时缺少该浏览器二进制，因此尚无实际浏览器填充运行证据；安装后应运行 `npm run build && npm run test:e2e`。

OCR 发布门槛仍然**未通过**：digits 100%，letters 46%，alphanumeric 48%，arithmetic fill 74%。普通三类整串聚合与算术最终填写值都必须达到 90% 才能发布。发布前仍需要：安装 Playwright Chromium 并保存 E2E 通过证据；在真实、获授权页面上做 Edge 手工安装/右键 smoke；以固定语料和固定门槛提升并复跑 OCR 基准；最后执行 Chrome/Edge 构建、完整测试、typecheck 和发布检查。

## 当前状态

- 仓库：`/Users/harrison/Documents/harrison_project/local-captcha-solver`
- 隔离工作树：`/Users/harrison/Documents/harrison_project/local-captcha-solver/.worktrees/edge-experience-workflow`
- 分支：`feature/edge-experience-workflow`
- Task 8 前的实现基线：`9ab7635`
- 设计文档：`docs/superpowers/specs/2026-07-22-local-captcha-solver-design.md`
- 实施计划：`docs/superpowers/plans/2026-07-22-local-captcha-solver-mvp.md`

原始交接时 Tasks 1-6 已完成，Task 6 的 90% OCR 门槛未通过。后续的 Task 7-8 浏览器体验工作流已按本文顶部的 2026-07-25 更新完成；OCR 门槛仍未通过，因此发布仍被阻断。

## 已完成

### Task 1：Chrome/Edge MV3 工程脚手架

- WXT 0.20.7、TypeScript、Vitest、Playwright 基础工程。
- Node.js 要求为 22 或更高版本。
- Chrome MV3 构建可生成本地解压目录。
- 提交：`716b623 chore: scaffold chromium extension`

### Task 2：本地 OCR 资产与许可证

- 固定并跟踪 ddddocr `common_old.onnx`、字符表和选定的 ONNX Runtime WASM/MJS。
- 资产同步包含 Git blob、尺寸、Base64、SHA-1 校验和事务回滚。
- 不依赖运行时服务器、CDN 或远程 OCR API。
- 提交：`07ade7a`、`b1167d6`、`1c0436e`、`ba9fb5f`

### Task 3：核心类型与算术解释

- 支持数字、区分大小写的字母、字母数字混合和单次加减乘除。
- 算术解析使用锚定语法和 `BigInt`，不使用 `eval`。
- 非整除结果不自动填写；OCR 结果集合保持只读。
- 提交：`243708f`、`64758fb`、`287e9a6`

### Task 4：受字符集约束的 CTC 解码

- 支持 `[1,time,classes]` 和 `[time,1,classes]` 输出布局。
- 使用完整类别 softmax 计算置信度，并正确处理 blank、重复字符和稳定 tie-break。
- 提交：`2146999 feat: decode constrained OCR logits`

### Task 5：图像预处理与 ddddocr 引擎

- 浏览器预处理使用 `createImageBitmap` 和 `OffscreenCanvas`。
- 透明像素合成到白色，保持宽高比缩放到高度 64，并归一化为单通道灰度张量。
- 一个图片只预处理和推理一次，同一 logits 可按多个识别 profile 解码。
- session 并发复用，创建失败后允许重试；同步和异步失败都包装为 `model_unavailable`。
- 提交：`a855c1e`、`2119471`

### Task 6：本地 OCR 可行性基准

- 固定种子生成并跟踪 200 张 PNG：digits、letters、alphanumeric、arithmetic 各 50 张。
- 使用锁定的 DejaVu 字体，覆盖完整易混字符、四档对比度、1-2 条干扰线和正负 2 度内旋转。
- 生成器验证字节确定性并原子替换语料，清理陈旧文件。
- runner 真实复用生产 `DdddOcrEngine`、本地 `common_old.onnx`、字符表和 ONNX Runtime。
- Tesseract 仅作本地基准对照，使用受控子进程和单 worker；worker/core/lang 均来自本地依赖。
- 真实样本导入器验证图片、分类标签、算术答案、来源和许可，并进行 SHA-256 去重、并发锁和失败回滚。
- JSON 与 Markdown 报告原子配对写入 `benchmark/results/`，该目录被 Git 忽略。
- 提交：`73f3ad2`、`34ebdba`

## 历史基准结果（OCR accuracy v1 前）

以下保留 Task 6 当时的 pre-accuracy-v1 基准证据。语料数：200。固定门槛：普通三类整串准确率至少 90%，算术最终填写值准确率至少 90%。

| 指标 | ddddocr | Tesseract |
| --- | ---: | ---: |
| 全部类别整串准确率 | 65.50% | 53.00% |
| 普通三类整串准确率 | 70.67% | - |
| 算术最终填写值准确率 | 52.00% | 40.00% |
| 字符准确率 | 89.73% | 78.11% |
| 高置信错误率 | 10.50% | 2.00% |
| 冷启动 | 153.60 ms | 185.92 ms |
| warm 中位数 | 11.38 ms | 8.62 ms |
| warm P95 | 12.98 ms | 17.67 ms |
| 对称安装占用口径 | 128,510,707 B | 45,893,063 B |

ddddocr 分项整串准确率：

- digits：100%
- letters：56%
- alphanumeric：56%
- arithmetic source：50%

结论：`passed: false`。`npm run benchmark` 完整处理两套引擎后会返回退出码 2，表示准确率硬门槛阻断，不是 benchmark runner 崩溃。

这些历史数字对应的报告当时写入 `benchmark/results/latest.json` 和 `benchmark/results/latest.md`。该目录被 Git 忽略，因此两个 `latest` 路径现已由后续运行覆盖，当前保存的是下方 OCR accuracy v1 章节记录的结构化解码报告；同一 version 2 语料上的贪心基线另存为 `benchmark/results/baseline-v2-greedy.json` 和 `benchmark/results/baseline-v2-greedy.md`。这些报告均不会提交到 Git。

## OCR accuracy v1（2026-07-24）

本轮在同一份 schema version 2 生成语料上比较贪心基线与算术结构化解码。语料身份为 `benchmark/corpus.generated.json`、seed `1279480653`、SHA-256 `6b887ebd6e19170c9ce24379079c64fb812c6d0cef7ae13878c105cc207d04dc`；共 200 个样本，digits、letters、alphanumeric、arithmetic 各 50 个。基线与优化报告中的 sample id、category、expected source 和 expected fill 已逐项确认一致。

语料的答案/运算符、字体家族、字号、对比度档位、干扰线数量和旋转角度来自相互独立的确定性序列，不共享同一个 `index % N` 绑定。四种运算符各有 12 或 13 个样本；每种运算符覆盖至少三种字体、全部四档对比度（`18:1`、`12:1`、`7:1`、`4.5:1`）和 1/2 条干扰线。旋转角度独立分配并限制在 `-2` 到 `2` 度。由此避免把某个运算符固定绑定到特定字体、对比度、干扰线或旋转序列。

硬门槛对比（括号内为报告中的原始 JSON 值）：

| 门槛指标 | 贪心基线 | 结构化解码 |
| --- | ---: | ---: |
| 普通三类整串准确率 | 97/150，64.66666666666666%（`0.6466666666666666`） | 97/150，64.66666666666666%（`0.6466666666666666`） |
| 算术最终填写值准确率 | 26/50，52%（`0.52`） | 37/50，74%（`0.74`） |

ddddocr 分类指标的精确前后值：

| 类别（各 50 个） | 基线整串 | 优化整串 | 基线字符 | 优化字符 | 基线 fill | 优化 fill |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digits | `1` | `1` | `1` | `1` | - | - |
| letters | `0.46` | `0.46` | `0.7951807228915663` | `0.7951807228915663` | - | - |
| alphanumeric | `0.48` | `0.48` | `0.8313253012048193` | `0.8313253012048193` | - | - |
| arithmetic | `0.52` | `0.74` | `0.8904109589041096` | `0.9406392694063928` | `0.52` | `0.74` |

算术按 expected operator 分组；source 与 fill 的前后值如下：

| 运算符 | 样本 | 基线 source / fill | 优化 source / fill |
| --- | ---: | ---: | ---: |
| addition | 12 | 12/12（`1`）/ 12/12（`1`） | 12/12（`1`）/ 12/12（`1`） |
| subtraction | 12 | 1/12（`0.08333333333333333`）/ 1/12（`0.08333333333333333`） | 12/12（`1`）/ 12/12（`1`） |
| multiplication | 13 | 13/13（`1`）/ 13/13（`1`） | 13/13（`1`）/ 13/13（`1`） |
| division | 13 | 0/13（`0`）/ 0/13（`0`） | 0/13（`0`）/ 0/13（`0`） |

confidence `>= 0.90` 的选择性指标不替代全量硬门槛：

| 范围 | 贪心基线 accepted / coverage / precision | 结构化解码 accepted / coverage / precision |
| --- | ---: | ---: |
| ordinary | 97 / `0.6466666666666666` / `0.845360824742268` | 97 / `0.6466666666666666` / `0.845360824742268` |
| arithmetic | 35 / `0.7` / `0.5428571428571428` | 23 / `0.46` / `0.8260869565217391` |

本机 ddddocr 延迟来自两份实际报告的 `engines.ddddocr.metrics`：

| 运行 | cold init | median warm | warm P95 |
| --- | ---: | ---: | ---: |
| 贪心基线 | `153.08995800000002 ms` | `11.357416499999886 ms` | `12.698542000000089 ms` |
| 结构化解码 | `144.385792 ms` | `12.902416500000072 ms` | `22.660542000000078 ms` |

`npm run benchmark` 已让 ddddocr 和 Tesseract 两套本地引擎各完成 200/200 个预测，并写出新的 `latest.json` 与 `latest.md`；退出码为 `2`。优化报告的 `report.gates.passed` 为 `false`。除非后续实际报告的 `report.gates.passed` 为 `true`，否则准确率硬门槛仍然阻断；Task 7 及之后的浏览器自动化继续暂停，直到现有普通整串和算术 fill 两个 90% 门槛同时通过。

当前影响最大的剩余错误类是普通 letters：27/50 整串错误，整串准确率只有 46%；alphanumeric 也有 26/50 整串错误。算术中则仍有系统性的 division 错误，13/13 的 source 与 fill 均失败。下一轮建议先对这 53 个普通样本做完全本地的字符混淆和生成属性分层，随后在固定模型、固定 v2 语料和固定门槛下比较确定性的本地预处理变体或普通 CTC 约束解码；同时把 division 运算符作为独立的算术诊断切片。不得引入远程 OCR、API、CDN、遥测或运行时下载。本段只记录同一语料上的观测值，不声明统计显著性或语料外泛化提升。

## 验证证据

在提交 `34ebdba` 上已验证：

```text
npm test             -> 15 files, 203/203 tests passed
npm run typecheck    -> passed
npm run build        -> passed, Chrome MV3 output 25.62 MB
git diff --check     -> passed
npm ls --depth=0     -> passed
```

Task 5 和 Task 6 均依次通过独立规格审查和代码质量审查。Task 6 最终复审没有剩余 Critical、Important 或 Minor 问题。

已知非阻断警告：ONNX 模型元数据声明输出 `{1,-1}`，实际输出为 `{23,1,8210}`。生产 decoder 已覆盖实际的 `[time,1,classes]` 布局，200 个样本均能完成推理。

## 历史未完成清单（2026-07-24，已由上方更新替代）

- Task 7：候选图片评分和字段匹配。
- Task 8：本地设置、精确 hostname 白名单和 Chromium 可选权限。
- Task 9：类型化推理消息和 offscreen 推理宿主。
- Task 10：图片获取、安全填写和页面编排。
- Task 11：白名单自动注册和验证码刷新观察。
- Task 12：图片右键菜单和 popup 扫描工作流。
- Task 13：端到端、离线、零提交和非空字段保护验证。
- Task 14：README、真实网站验证、Chrome/Edge 候选构建和完整发布前验证。

这些任务不是普通待办，而是被 Task 6 的准确率硬门槛主动阻断。没有新的 OCR 方案决策前，不应开始 Task 7。

## 新对话的第一步

先重新评估本地 OCR 方案，再决定是否修改实施计划。建议保持当前 200 张语料和 90% 门槛不变，避免针对基准重新降低难度。

可评估方向：

1. 测试 ddddocr 较大的 `common.onnx` 模型，记录准确率、冷启动、warm 延迟和扩展包体影响。
2. 评估其他可在浏览器 WASM/WebGPU 中完全本地运行的 OCR 模型。
3. 在不针对标签过拟合的前提下，评估通用预处理变体，例如自适应阈值、对比度增强和去干扰线。
4. 加入有合法授权和来源记录的真实验证码样本，单独报告生成语料与真实语料结果。

只有新方案同时达到：

- digits、letters、alphanumeric 聚合整串准确率至少 90%；
- arithmetic 最终填写值准确率至少 90%；

才恢复 Task 7 及之后的插件工作流开发。

## 接续约束

- 完全本地处理，不依赖服务器、API、CDN 或遥测。
- Chrome 和 Edge 优先，共享 core/OCR，浏览器 API 保持适配器边界以便后续 Firefox 复用。
- 三个入口仍为：精确 hostname 白名单自动识别、验证码图片右键、popup 页面扫描。
- 永远不提交表单。
- 自动模式永远不覆盖非空字段；覆盖只能来自用户明确操作。
- 保持字母大小写；支持数字、字母、字母数字混合和单次算术。
