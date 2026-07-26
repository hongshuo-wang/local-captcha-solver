# Ppllocr 单引擎替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先用真实问题样本验证 Ppllocr 2.2 的浏览器可行性；通过后用它替换当前 ddddocr 多模式识别，使所有文字验证码走一次识别、一次类型解释和一次填充流程。

**Architecture:** Ppllocr ONNX 在现有 offscreen 文档的 `onnxruntime-web` WASM 环境运行，按官方 Python 实现完成 512 方形填充、YOLO 字符检测、NMS 和横向排序。引擎只返回一个根据字符组成推断了 `mode` 的 `OcrResult`，现有结果解释器负责安全算式计算，工作流不再并行请求四种模式。

**Tech Stack:** TypeScript、Vitest、WXT、ONNX Runtime Web、Ppllocr 2.2 ONNX、原生 Canvas/OffscreenCanvas。

---

### Task 1: 执行 Ppllocr 硬门槛验证

**Files:**
- Temporary only: `/tmp/ppllocr_betav2.2.onnx`
- Temporary only: `/tmp/ppllocr-feasibility.ts`
- Read: `/tmp/local-captcha-screenshot-crop.png`
- Read: `benchmark/fixtures/generated/*.png`

- [ ] **Step 1: 获取并校验固定模型。** 从 `gitpetyr/ppllocr@449af7fbe35378348c34d6c409ca4f2e80ef0878` 获取 `ppllocr/assets/ppllocr_betav2.2.onnx`，要求 Git blob `abb8a97b359c56ddd98f0e0e0502279f6b453c02`、字节数 `80,544,116`、SHA-256 `3410492613965c360260c180e04c46f6afd95caa14cb060535ab042a854af841`。
- [ ] **Step 2: 在临时脚本中移植上游推理算法。** 脚本必须保持与 `ppllocr/inference.py` 一致：RGB、`512 x 512` letterbox、NCHW、`/255`、置信度阈值 `0.25`、IoU 阈值 `0.45`、逐类别最大值、NMS、按 `x1` 排序；不得修改仓库生产代码。
- [ ] **Step 3: 运行真实问题样本。**

  Run: `./node_modules/.bin/tsx /tmp/ppllocr-feasibility.ts /tmp/local-captcha-screenshot-crop.png`

  Expected: WASM 会话创建成功，输出可解析为 `7*3`（允许尾部 `=?`），计算结果为 `21`；记录冷启动和热推理耗时。

- [ ] **Step 4: 运行最小普通验证码冒烟。** 固定使用 `digits-002/017/024/030/036`、`letters-002/016/029/038/049`、`alphanumeric-004/010/025/038/049`，要求 15 张均不被解析为算式。
- [ ] **Step 5: 应用硬门槛。** 如果模型无法用 WASM 运行、真实样本不是 `21`、或普通样本出现算式误判，立即停止，不修改生产代码并汇报证据；全部通过才继续 Task 2，不评估其他 OCR。

### Task 2: 用测试定义 Ppllocr 字符解码和类型解释

**Files:**
- Create: `src/ocr/ppllocr-decoder.ts`
- Create: `tests/ocr/ppllocr-decoder.test.ts`
- Modify: `src/core/arithmetic.ts`
- Modify: `tests/core/arithmetic.test.ts`
- Modify: `src/core/result-interpreter.ts`
- Modify: `tests/core/result-interpreter.test.ts`

- [ ] **Step 1: 写失败的算式后缀测试。** 增加 `7*3=?`、`7×3＝？` 中本项目支持的 ASCII 标准化输入测试，要求解析为 `{ expression: '7*3', value: '21' }`；全角字符若未纳入 OCR 字符集则保持不支持。
- [ ] **Step 2: 运行算式测试确认 RED。**

  Run: `npm test -- tests/core/arithmetic.test.ts tests/core/result-interpreter.test.ts`

  Expected: `7*3=?` 因现有正则只允许一个尾部字符而失败。

- [ ] **Step 3: 最小扩展安全算式语法。** 将尾部语法限制为可选 `=`、可选 `?`，仍只允许两个非负整数和一个受支持运算符，不使用 `eval`。

  ```ts
  const ARITHMETIC_PATTERN =
    /^\s*([0-9]+)\s*([+\-*/xX×÷])\s*([0-9]+)\s*(?:=\s*)?(?:\?\s*)?$/;
  ```

- [ ] **Step 4: 写失败的 Ppllocr 解码测试。** 构造 `[1, 4 + 69, candidateCount]` Float32 输出，覆盖阈值过滤、`xywh -> xyxy`、同类框 NMS、从左到右排序、平均置信度、非有限数据和错误维度。
- [ ] **Step 5: 运行解码测试确认 RED。**

  Run: `npm test -- tests/ocr/ppllocr-decoder.test.ts`

  Expected: FAIL，因为 `decodePpllocrOutput` 尚不存在。

- [ ] **Step 6: 实现纯解码器和类型推断。**

  ```ts
  export interface PpllocrDecoded {
    text: string;
    confidence: number;
  }

  export function decodePpllocrOutput(
    output: Float32Array,
    dims: readonly number[],
    confidenceThreshold = 0.25,
    iouThreshold = 0.45,
  ): PpllocrDecoded;

  export function modeForPpllocrText(text: string): RecognitionMode | undefined;
  ```

  字符集固定为上游 2.2 的 69 个字符；先判断安全算式，再依次判断纯数字、纯字母和字母数字。
- [ ] **Step 7: 运行 Task 2 测试确认 GREEN。**

  Run: `npm test -- tests/ocr/ppllocr-decoder.test.ts tests/core/arithmetic.test.ts tests/core/result-interpreter.test.ts`

  Expected: PASS。

### Task 3: 实现单次 Ppllocr 浏览器推理

**Files:**
- Create: `src/ocr/ppllocr-engine.ts`
- Create: `tests/ocr/ppllocr-engine.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/ocr/protocol.ts`
- Modify: `tests/ocr/protocol.test.ts`

- [ ] **Step 1: 写失败的引擎测试。** 使用可注入图片原语和会话工厂，断言一次图片预处理、一次模型推理、RGB/NCHW `[1,3,512,512]` 张量、单个推断模式结果、会话复用和错误映射。
- [ ] **Step 2: 运行引擎测试确认 RED。**

  Run: `npm test -- tests/ocr/ppllocr-engine.test.ts`

  Expected: FAIL，因为 `PpllocrEngine` 尚不存在。

- [ ] **Step 3: 实现单引擎边界。**

  ```ts
  export class PpllocrEngine {
    constructor(
      sessionFactory: PpllocrSessionFactory,
      modelUrl: string,
      imagePreprocessor?: PpllocrImagePreprocessor,
    );

    recognize(image: ImagePayload): Promise<readonly OcrResult[]>;
  }
  ```

  `recognize` 只执行一次模型推理；可归类时返回单元素数组，不可归类或空文本返回空数组。
- [ ] **Step 4: 写失败的单流程协议测试。** 从 `InferenceRequest` 移除 `modes`，请求仅包含类型、请求 ID、图片修订和 data URL；响应仍为 `OcrResult[]`，但最多一个结果。
- [ ] **Step 5: 运行协议测试确认 RED。**

  Run: `npm test -- tests/ocr/protocol.test.ts`

  Expected: 新的无 `modes` 请求与当前校验器不兼容。

- [ ] **Step 6: 更新类型和协议。** `OcrEngine.recognize`、推理请求及校验器改为单次识别合同；保留 `RecognitionMode` 仅用于结果类型，不作为模型输入模式。
- [ ] **Step 7: 运行 Task 3 测试确认 GREEN。**

  Run: `npm test -- tests/ocr/ppllocr-engine.test.ts tests/ocr/protocol.test.ts`

  Expected: PASS。

### Task 4: 替换正式 offscreen 与工作流链路

**Files:**
- Modify: `entrypoints/offscreen.ts`
- Modify: `src/background/inference-host.ts`
- Modify: `src/background/runtime-router.ts`
- Modify: `entrypoints/content.ts`
- Modify: `src/content/workflow.ts`
- Modify: `tests/entrypoints/offscreen.test.ts`
- Modify: `tests/background/inference-host.test.ts`
- Modify: `tests/background/runtime-router.test.ts`
- Modify: `tests/entrypoints/content.test.ts`
- Modify: `tests/content/workflow.test.ts`

- [ ] **Step 1: 写失败的链路测试。** 断言内容脚本、后台、offscreen 和工作流不再发送模式数组；offscreen 只创建 `PpllocrEngine`；单个算式结果 `7*3=?` 最终填入 `21`。
- [ ] **Step 2: 运行链路测试确认 RED。**

  Run: `npm test -- tests/entrypoints/offscreen.test.ts tests/background/inference-host.test.ts tests/background/runtime-router.test.ts tests/entrypoints/content.test.ts tests/content/workflow.test.ts`

  Expected: FAIL，因为当前链路仍传递四种模式并创建 ddddocr 引擎。

- [ ] **Step 3: 替换 offscreen 引擎。** 使用 `models/ppllocr_betav2.2.onnx` 创建唯一 Ppllocr 引擎；会话工厂继续拒绝非 Float32 模型输出。
- [ ] **Step 4: 简化消息链路。** `InferenceHost.recognize`、后台 `captcha:recognize`、内容脚本 `recognize` 和工作流选项全部移除 `modes` 参数；工作流解释单个结果，不再做跨模式置信度排序。
- [ ] **Step 5: 保留现有安全状态。** 空结果进入确认/识别失败状态；模型创建或推理失败映射到现有中文状态；过期请求、字段匹配、复制和快捷键行为保持不变。
- [ ] **Step 6: 运行链路测试确认 GREEN。**

  Run: `npm test -- tests/entrypoints/offscreen.test.ts tests/background/inference-host.test.ts tests/background/runtime-router.test.ts tests/entrypoints/content.test.ts tests/content/workflow.test.ts`

  Expected: PASS。

### Task 5: 固定模型资产和许可

**Files:**
- Modify: `scripts/sync-third-party-assets.mjs`
- Modify: `tests/ocr/assets.test.ts`
- Modify: `tests/ocr/asset-sync.test.ts`
- Modify: `tests/ocr/asset-file-set.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create by asset sync: `public/models/ppllocr_betav2.2.onnx`
- Remove by asset sync: `public/models/common_old.onnx`
- Remove by asset sync: `public/models/common_old.json`

- [ ] **Step 1: 写失败的资产测试。** 要求 Ppllocr 模型路径、大小和 SHA-256 精确匹配固定版本，正式资产集合不再包含 `common_old` 模型与字符集。
- [ ] **Step 2: 运行资产测试确认 RED。**

  Run: `npm test -- tests/ocr/assets.test.ts tests/ocr/asset-sync.test.ts tests/ocr/asset-file-set.test.ts`

  Expected: FAIL，因为 Ppllocr 尚未进入固定资产集合。

- [ ] **Step 3: 更新同步清单。** 固定仓库、提交、Git blob、字节数和输出路径；同步脚本验证 Git blob SHA-1，并让资产测试验证 SHA-256。
- [ ] **Step 4: 同步资产。**

  Run: `GH_TOKEN="$(gh auth token)" npm run assets:sync`

  Expected: `public/models/ppllocr_betav2.2.onnx` 为 `80,544,116` 字节，旧 ddddocr 资产从正式集合移除。

- [ ] **Step 5: 更新第三方声明。** 将正式扩展中的 ddddocr/ddddocr-node 条目替换为固定版本 Ppllocr 2.2 MIT 模型条目；ONNX Runtime 声明保持不变。
- [ ] **Step 6: 运行资产测试确认 GREEN。**

  Run: `npm test -- tests/ocr/assets.test.ts tests/ocr/asset-sync.test.ts tests/ocr/asset-file-set.test.ts`

  Expected: PASS。

### Task 6: 完整验证

**Files:**
- Modify only files required to resolve failures caused by the single-engine contract.

- [ ] **Step 1: 运行完整单元测试。**

  Run: `npm test`

  Expected: 0 个失败测试。

- [ ] **Step 2: 运行类型检查。**

  Run: `npm run typecheck`

  Expected: exit code 0。

- [ ] **Step 3: 构建 Chrome 和 Edge。**

  Run: `npm run build && npm run build:edge`

  Expected: 两个生产构建 exit code 0，构建产物包含 Ppllocr 模型且不包含 `common_old`。

- [ ] **Step 4: 复跑真实问题样本。** 使用正式 `PpllocrEngine` 对截图裁剪推理，记录原始文本、类型、最终 `21` 和耗时，确认不是只由构造测试通过。
- [ ] **Step 5: 检查范围与工作区。**

  Run: `git diff --check && git status --short && git diff --stat`

  Expected: 保留用户已有未提交修改；本次实现只有 Ppllocr 单引擎、协议简化、资产、许可和对应测试，没有第二模型或分类器。
