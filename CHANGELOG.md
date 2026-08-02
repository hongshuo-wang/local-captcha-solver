# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/hongshuo-wang/local-captcha-solver/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hongshuo-wang/local-captcha-solver/releases/tag/v1.0.0
