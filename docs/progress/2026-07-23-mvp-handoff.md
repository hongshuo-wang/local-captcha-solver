# Local CAPTCHA Solver MVP 进度交接

更新时间：2026-07-23

## 当前状态

- 仓库：`/Users/harrison/Documents/harrison_project/local-captcha-solver`
- 隔离工作树：`/Users/harrison/Documents/harrison_project/local-captcha-solver/.worktrees/local-captcha-solver-mvp`
- 分支：`feature/local-captcha-solver-mvp`
- 当前实现提交：`34ebdbae70dd00bcc03b2532bd71d2e1484789ee`
- 设计文档：`docs/superpowers/specs/2026-07-22-local-captcha-solver-design.md`
- 实施计划：`docs/superpowers/plans/2026-07-22-local-captcha-solver-mvp.md`

Tasks 1-6 已完成。Task 6 的基准工具和证据已经验收，但 ddddocr 未达到固定的 90% 准确率门槛，因此产品开发在 Task 6 硬门槛处停止。Tasks 7-14 尚未开始。

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

## 最新基准结果

语料数：200。固定门槛：普通三类整串准确率至少 90%，算术最终填写值准确率至少 90%。

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

最新本地报告位于 `benchmark/results/latest.json` 和 `benchmark/results/latest.md`，二者不会提交到 Git。

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

## 未完成

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
