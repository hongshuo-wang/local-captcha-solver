# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

暂无未发布变更。

## [1.3.1] - 2026-08-26

### 中文

#### 修复

- 修复奇安信登录页的拼图定位：隐藏的完整背景画布仍包含有效像素，现在按画布实际像素尺寸与缺口背景配对并做差分定位，避免回退到高 DPI 页面截图时的倍率偏差与低置信度。
- 改进 GeeTest v3/v4 挑战生命周期跟踪，同一页面重置、验证失败刷新或登录失效后出现的新挑战可以继续自动处理，并且不会重复拖动已完成或已拒绝的挑战。
- 按定位方法分别校验置信度，仅在证据充足时拖动，减少边缘或形状弱证据造成的错误落点。
- 仅将当前滑块控件内的操作视为用户接管，验证成功后点击页面其他位置不再触发暂停提示。
- 统一 Chromium 的异步扩展消息回传方式，内容脚本、后台和离屏识别现在同时兼容 Promise 与 `sendResponse` 消息通道。

#### 变更

- 当前页面检测到拼图滑块时，打开扩展面板会自动切换到滑块功能页。
- 滑块诊断新增尝试与挑战标识、执行阶段、图像来源、定位方法与门槛、候选结果、计划与实际位移以及验证状态序列。

### English

#### Fixed

- Fixed puzzle localization on the Qianxin sign-in page. The hidden full-background canvas still contains valid pixels, so it is now paired with the gap background by intrinsic canvas dimensions and used for difference localization, avoiding high-DPI screenshot scaling errors and low confidence.
- Improved GeeTest v3/v4 challenge lifecycle tracking so reset, rejected, refreshed, and reappearing challenges on the same page can continue automatically without re-dragging a settled challenge.
- Applied confidence thresholds per localization method and dragged only when the selected evidence is sufficient, reducing incorrect destinations from weak edge or shape evidence.
- Limited user-takeover detection to interaction inside the active slider control, so unrelated page clicks after successful verification no longer show a pause notice.
- Unified asynchronous Chromium extension responses across content, background, and offscreen contexts with support for both Promise and `sendResponse` messaging channels.

#### Changed

- The extension popup now opens the slider view automatically when the current page contains a detected puzzle slider.
- Slider diagnostics now include attempt and challenge identifiers, execution phase, image source, localization method and threshold, alternative candidates, planned and final displacement, and the observed verification sequence.

## [1.3.0] - 2026-08-26

### 中文

#### 新增

- 新增 Firefox Manifest V3 构建，支持本地静态文字验证码识别、自动填入、弹窗、右键菜单和设置管理。
- 发布流程新增 Firefox 扩展包、可审核源码包、SHA-256 校验和清单验证。

#### 变更

- Firefox 在扩展后台页运行内置本地识别模型；Chrome 和 Edge 继续使用离屏文档。
- Firefox 引导页和弹窗明确说明拼图滑块的浏览器支持范围，并推荐使用 Chrome 或 Edge 体验完整功能。

### English

#### Added

- Added a Firefox Manifest V3 build with local static text recognition, automatic filling, popup and context-menu actions, and settings management.
- Added Firefox extension and reviewable source packages, SHA-256 checksums, and manifest verification to the release workflow.

#### Changed

- Firefox runs the bundled local recognition model in its extension background page; Chrome and Edge continue to use an offscreen document.
- Firefox onboarding and popup now explain browser support for puzzle sliders and recommend Chrome or Edge for the complete feature set.

## [1.2.0] - 2026-08-23

### 中文

#### 新增

- 支持按精确主机名设置自动、纯数字、纯英文、英数混合或算术验证码类型，并在设置页集中恢复自动判断。
- 新增授权的 `UDJN` 冻结回归样本，以及多色交叉线和 `0/O` 同图对比的下一候选模型数据配方。
- 新增独立的拼图滑块 Beta，使用 GeeTest 演示页进行验证，支持所有 HTTP/HTTPS 网站或精确网站名单两种运行范围。
- 新增独立 Tab 欢迎页和 `1.2.0` 升级说明页；老用户只会看到一次滑块引导，新用户按静态验证码与滑块验证码分步设置。

#### 变更

- 设置页、欢迎页、弹窗、隐私政策、README 和贡献文档补充滑块能力、运行范围和 `debugger` 权限说明。

### English

#### Added

- Added exact-host CAPTCHA type overrides for automatic, digits, letters, alphanumeric, or arithmetic decoding, with centralized reset controls in Settings.
- Added the authorized `UDJN` frozen regression and a next-candidate data recipe for multicolor crossing lines and paired `0/O` samples.
- Added a separate puzzle-slider Beta validated with the GeeTest demo, with all-site and exact-site scope options.
- Added standalone welcome and `1.2.0` upgrade tabs; existing users see the slider guide once, while new users configure static CAPTCHAs and sliders in separate steps.

#### Changed

- Updated Settings, onboarding, popup, privacy, README, and contributor documentation with slider scope and `debugger` permission guidance.

## [1.1.0] - 2026-08-02

### 中文

#### 新增

- 扩展面板新增“立即识别当前页”主操作，可在不启用网站自动识别的情况下执行一次本地扫描。
- 引导页、扩展面板、设置页和网页内识别反馈统一支持系统浅色与深色模式。

#### 修复

- 扩展旧式验证码图片和输入框语义检测，支持 `validateCode`、`vaildataCode`、`verifyCode`、`checkCode`、`authCode`、`randCode`、`yzm` 等常见标识。
- 识别 `title`、`data-label`、`data-placeholder` 和安全的旧式伪占位值，修复部分政企登录页识别成功但找不到输入框的问题。

#### 变更

- 重新设计三步引导、扩展面板、设置页与网页内识别反馈，统一信息层级、控件状态和视觉令牌。
- 新安装默认使用“仅指定网站”模式，但引导页不会预选任何选项，用户明确选择后才能继续。
- 成功与复制结果改为短暂通知；歧义、权限、已有输入值等状态使用持久面板，并尽量避开登录、提交和验证码刷新控件。
- 普通界面不再显示原始置信度百分比，置信度仅保留在本地诊断中。
- 入门引导的最终操作改为“完成设置并关闭”。
- 重绘 Chrome Web Store 截图和宣传图，使素材直接反映真实扩展界面与本地识别流程。
- 重写中英文 README，聚焦项目介绍、使用方式、模型结构、训练数据和可复现的重新训练流程。
- 将维护者内部资料移出公开仓库，并清理过时的计划与交接文档。
- 将依赖更新检查收敛为每月分组更新，减少自动 Pull Request 数量。
- GitHub Release 说明改为中文在前、英文在后的双语格式。

### English

#### Added

- Added a primary “Recognize this page now” popup action for one-time local scanning without enabling automatic recognition for the site.
- Added system light and dark mode support across onboarding, popup, settings, and in-page recognition feedback.

#### Fixed

- Expanded legacy CAPTCHA image and field semantics for common identifiers including `validateCode`, `vaildataCode`, `verifyCode`, `checkCode`, `authCode`, `randCode`, and `yzm`.
- Recognized `title`, `data-label`, `data-placeholder`, and safe legacy placeholder values, fixing pages where OCR succeeded but the matching input was not found.

#### Changed

- Redesigned onboarding, popup, settings, and in-page feedback around one consistent hierarchy, state model, and visual token set.
- Made selected-site access the new-install default while leaving onboarding choices visually unselected until the user makes an explicit choice.
- Moved successful fill and copy results to transient notifications, while ambiguity, permission, and existing-value decisions use persistent panels positioned away from form controls.
- Removed raw confidence percentages from normal UI while retaining them in local diagnostics.
- Changed the final onboarding action to “Finish setup and close.”
- Redrew Chrome Web Store screenshots and promotional artwork from the real extension UI and local recognition flow.
- Reworked both READMEs around the project, usage, model architecture, training data, and reproducible retraining.
- Moved maintainer-only material out of the public repository and removed obsolete plans and handoffs.
- Consolidated dependency checks into monthly grouped updates to reduce automated pull request volume.
- Made GitHub Release notes bilingual with Chinese followed by English.

## [1.0.0] - 2026-07-31

### 中文

#### 新增

- 完全在本地识别常见的数字、英文字母、英数字组合和一步整数算术验证码。
- 按类别设置置信度阈值，可靠结果才允许自动填入，不确定结果明确拒绝填写。
- 支持所有网站或指定网站授权，并可管理已授权和已禁用的网站。
- 提供独立的首次安装引导和完整设置页面。
- 支持扩展面板、图片右键菜单、可配置鼠标快捷操作和可选结果复制。
- 提供本地模型状态、重试控制以及最多 20 条可清除、可复制的清理后诊断记录。
- 扩展界面支持英文和简体中文。
- 提供使用内置 ONNX/WebAssembly 资源的 Chrome Manifest V3 与 Microsoft Edge 构建。
- 提供公开项目文档、贡献模板和自动化语义化版本发布流程。

#### 隐私

- 验证码图片和识别结果始终留在用户设备上。
- 不包含账号、广告、分析、遥测、远程 OCR、远程代码或自动表单提交。

#### 模型

- 生产环境使用 2.24 MB CAPTCHA CTC 模型；在隔离的 10,000 张验证集上，自动填入精确率为 99.587%，覆盖率为 82.38%。
- 冻结的 201 张基准集达到 98.01% 整串/填入准确率和 100% 算术答案准确率。
- 已记录数据来源、许可证、分组隔离、Paddle/ONNX 一致性以及 Chrome/Edge 离线验证结果。

### English

#### Added

- Fully local recognition for common digit, English-letter, alphanumeric, and one-step integer arithmetic CAPTCHAs.
- Conservative automatic filling with per-category confidence thresholds and explicit abstention for uncertain results.
- User-controlled global or selected-site permissions with authorized and disabled site management.
- A standalone first-install onboarding experience and a full-tab settings page.
- Popup controls, image context-menu recognition, configurable mouse shortcuts, and optional result copying.
- Local model status, retry controls, and up to 20 sanitized diagnostic records with clear and copy actions.
- English and Simplified Chinese extension localization.
- Chrome Manifest V3 and Microsoft Edge production builds using bundled ONNX/WebAssembly assets.
- Public project documentation, contribution templates, and automated SemVer release infrastructure.

#### Privacy

- CAPTCHA images and recognition results remain on the device.
- No account, advertising, analytics, telemetry, remote OCR, remote code, or automatic form submission.

#### Model

- Production 2.24 MB CAPTCHA CTC model approved at 99.587% automatic-fill precision and 82.38% coverage on the isolated 10,000-image validation set.
- Frozen 201-image benchmark at 98.01% whole-string/fill accuracy and 100% arithmetic-answer accuracy.
- Documented data provenance, licenses, split-group isolation, Paddle/ONNX parity, and offline Chrome/Edge verification.

[Unreleased]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hongshuo-wang/local-captcha-solver/releases/tag/v1.0.0
