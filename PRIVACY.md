# Privacy Policy / 隐私政策

Effective date: July 31, 2026

This policy applies to the Captcha Helper browser extension published from this repository.

## Summary

Captcha Helper performs CAPTCHA recognition locally on the user's device. The extension does not transmit CAPTCHA images, recognition results, browsing history, settings, diagnostics, or other user data to the developer or to a third-party service.

Captcha Helper has no account system, advertising, analytics, telemetry, or remote OCR API.

## Data processed locally

The extension may process the following information inside the browser:

- pixels from a user-selected or detected CAPTCHA image;
- recognized text, confidence, image dimensions, and arithmetic results;
- page structure needed to locate a matching input field;
- exact hostnames authorized or disabled by the user;
- extension settings and local model state; and
- up to 20 sanitized diagnostic records.

Diagnostic records may include OCR text, confidence, image dimensions, hostname, field-match outcome, and a bounded error message. They do not include image bytes, data URLs, full page URLs, query strings, passwords, cookies, authentication tokens, arbitrary form contents, or submitted form data.

This information remains in the browser profile and is not sent to the developer.

## Clipboard

Captcha Helper may write a recognition result to the clipboard when the user explicitly chooses **Copy** or enables the optional copy behavior. The extension does not read clipboard contents.

## Website access

Users choose whether to grant access to all HTTP/HTTPS websites or only selected sites. Site access is used to read a CAPTCHA image, run the page helper, and fill a matching input field after a user-authorized workflow. Permissions can be reviewed, disabled, or removed from the extension settings and browser settings.

The slider Beta declares the browser debugger permission to send trusted drag input. It is used only when the user manually requests a slider run or explicitly enables slider automation for the exact current hostname, and the debugger connection is detached after every attempt. Global slider automation is unavailable.

Captcha Helper never clicks a submit button and never submits a form automatically.

## Storage and deletion

Settings, permission state, and diagnostics are stored through the browser's extension storage APIs. Users can clear diagnostics from the settings page and can remove all locally stored extension data by uninstalling the extension or clearing its storage through the browser.

## Network activity and third parties

The recognition model, ONNX runtime, WebAssembly runtime, scripts, and styles are bundled with the extension. Captcha Helper does not download or execute remote code and does not send recognition requests to an external server.

Websites visited by the user remain subject to their own privacy policies. Captcha Helper does not control those websites.

## Changes

Material changes to this policy will be documented in the repository changelog and published with a new extension version. The effective date above will be updated.

## Contact

For privacy questions, open a repository issue that contains no personal or confidential information. For a sensitive privacy or security report, use the private reporting process described in [SECURITY.md](SECURITY.md).

---

## 中文说明

本政策适用于由本仓库发布的 Captcha Helper 浏览器扩展。

Captcha Helper 在用户设备本地处理验证码，不会把验证码图片、识别结果、浏览历史、设置、诊断记录或其他用户数据发送给开发者或第三方服务。扩展不包含账号系统、广告、分析、遥测或远程 OCR 接口。

扩展可能在浏览器本地处理验证码图片像素、识别文本、置信度、图片尺寸、算术结果、用于定位输入框的页面结构、用户授权或禁用的准确主机名、扩展设置、模型状态以及最多 20 条经过清理的诊断记录。滑块 Beta 还会在内存中处理可见挑战截图、缺口坐标、拖动轨迹参数和结果状态；滑块站点授权与静态 OCR 网站授权分开保存。

诊断记录不会包含图片字节、Data URL、完整网页地址、查询参数、密码、Cookie、身份验证令牌、任意表单内容或已提交的表单数据。这些信息只保留在浏览器配置中，不会发送给开发者。

只有在用户明确点击“复制”或启用可选复制行为后，扩展才会把识别结果写入剪贴板；扩展不会读取剪贴板。

用户可以选择授权所有 HTTP/HTTPS 网站，也可以只授权指定网站。网站权限仅用于读取验证码图片、运行网页辅助脚本，并在用户授权的流程中填写匹配输入框。扩展不会点击提交按钮，也不会自动提交表单。滑块 Beta 不支持全局自动开启：扩展声明浏览器调试权限以发送可信拖动，但只有用户手动处理当前滑块或明确为当前网站开启滑块自动处理时才会使用，并在每次操作后立即断开调试连接。

设置、权限状态和诊断记录通过浏览器扩展存储接口保存在本地。用户可以在设置页面清除诊断记录，也可以通过卸载扩展或清除扩展存储删除全部本地数据。

识别模型、ONNX 运行时、WebAssembly 运行时、脚本和样式全部随扩展打包。扩展不会下载或执行远程代码，也不会向外部服务器发送识别请求。

隐私问题可以通过不含个人或机密信息的仓库 Issue 提交。敏感的隐私或安全问题请按照 [SECURITY.md](SECURITY.md) 中的私下报告流程处理。
