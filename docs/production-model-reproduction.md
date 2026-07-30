# 生产验证码模型训练与复现手册

本文记录当前生产模型 `paddle-ctc-v4-decoupled-320k` 的真实训练过程，并给出从数据准备到浏览器发布的可执行步骤。目标有两个：

1. 能理解这个 2.24 MB 离线 OCR 模型是怎样得到的。
2. 后续增加新验证码场景时，能沿用相同的数据隔离、训练、导出和验收方法。

相关文件：

- 模型卡：`training/ppocrv6-captcha/model-cards/paddle-ctc-v4-decoupled-320k.md`
- 基础配置：`training/ppocrv6-captcha/config.yml`
- 最终解析配置：`training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/config.yml`
- 字符集：`training/ppocrv6-captcha/charset.txt`
- 数据清单：`training/ppocrv6-captcha/data/manifest.json`
- CTC-only 训练入口：`training/ppocrv6-captcha/train_paddle_ctc_only.py`
- 生产模型：`public/models/captcha-ctc.onnx`

## 1. 先明确“复现”的边界

本项目有三个不同层次的复现：

### 1.1 数据复现

公开数据集按版本、字节数和 SHA-256 固定；合成数据由固定种子和固定字体包生成。只要 Node 依赖、生成器和源数据不变，应得到相同图片、标签和 manifest 哈希。

### 1.2 训练复现

固定数据、种子、PaddleOCR 版本、PaddlePaddle 版本和超参数后，可以复现训练过程和接近的验证指标。不同 CPU、GPU、BLAS、CUDA 或 cuDNN 环境可能产生浮点差异，因此不能承诺 checkpoint 的 SHA-256 跨机器完全相同。

### 1.3 导出复现

给定相同 Paddle checkpoint 和固定导出工具，可以逐字节复现生产 ONNX。本文中的导出命令已在当前环境重新验证，得到：

```text
ONNX bytes   2,242,324
ONNX SHA-256 bce3e791636f369dd8bbac9b4eee2a0d9515f001b89b422f6d250c33ee6bbc28
```

需要诚实记录一个历史缺口：生产模型最早的探索阶段使用了 `/tmp/captcha-paddle-probe8k-train.txt` 和 `/tmp/captcha-paddle-probe1k-validation.txt`，这些临时标签清单没有保留。因此，全新 clone 无法从第一个 probe 开始逐字节重建同一个最终 checkpoint。当前工作区保留了父 checkpoint，可以重放最终阶段；全新环境则应使用第 10 节的干净重训方案。

## 2. 模型任务和结构

模型只处理常见静态单图验证码：

- 纯数字；
- 大小写英文字母；
- 英数字混合；
- 单步整数算式，支持 `+ - * / x X × ÷` 和 `=?`、`=`、`?`、无后缀。

不处理中文、动画、滑块、点选、行为验证、多步算式、负数结果、非整除除法等场景。

网络来自 PP-OCRv6 tiny recognition：

```text
输入图片
  -> BGR、缩放/补边到 [3, 48, 320]
  -> PPLCNetV4 tiny backbone
  -> MultiHead 中的 CTC encoder/head
  -> [batch, time, 71] 概率
  -> CTC 去 blank、合并连续重复字符
  -> 普通字符串或算式解析结果
```

`charset.txt` 有 70 个可见字符，顺序是数字、小写字母、大写字母和运算符。CTC blank 固定为索引 0，所以输出类别数必须为 71。不要排序或随意修改字符集；字符顺序变化会让已有权重全部失效。

训练配置仍保留 PP-OCRv6 的 NRTR 辅助头，但从 `paddle-probe8k-ctc-only` 开始，实际训练入口冻结 NRTR 分支，只优化 backbone 和 CTC 分支。生产导出也只使用 CTC 输出。对比相邻 checkpoint 可确认 84 个 NRTR 参数完全不变，而 192 个 backbone 参数和 14 个 CTC 参数发生了更新。

## 3. 实际生产环境

生产模型是在 Apple M4 Pro CPU 上训练和导出的：

| 项目 | 固定值 |
| --- | --- |
| Python | 3.12.11 |
| PaddlePaddle | 3.2.0 |
| PaddleOCR | v3.7.0 / `b03f46425e8ff4442b268ce449e3eef758146cd4` |
| paddle2onnx | 2.1.0 |
| ONNX opset | 17 |
| 随机种子 | 20260728 |
| 设备 | Apple M4 Pro CPU |
| 输入形状 | NCHW `[batch, 3, 48, 320]` |
| batch size | 128，MultiScaleSampler 会按高度调整实际批量 |

环境冻结文件：

```text
training/ppocrv6-captcha/python-environment.txt
SHA-256 e093de4865b6fd85382be69987ca9ae99f097561f8a8d7abd0e3f2b62db56823
```

CPU 完整阶段在该机器上大致耗时：v1 约 74 分钟、v2 约 98 分钟、v3 约 50 分钟、v4 约 50 分钟。GPU 时间会不同，不能把 CPU 日志中的 FPS 当作 GPU 基准。

## 4. 安装基础环境

以下命令都从仓库根目录执行。建议至少准备 5 GB 可用空间；当前下载压缩包约 886 MB，解出的训练图片约 1.8 GB，checkpoint 和中间导出还会继续占用空间。

### 4.1 Node 环境

要求 Node.js 22 或更高版本：

```bash
npm ci
npm test -- tests/training
```

### 4.2 固定 PaddleOCR

示例将 PaddleOCR 放到 `/tmp/PaddleOCR-v3.7.0`。长期训练可换到其他绝对路径，但必须保持 tag 和 commit 不变。

```bash
git clone --branch v3.7.0 --depth 1 \
  https://github.com/PaddlePaddle/PaddleOCR.git \
  /tmp/PaddleOCR-v3.7.0

git -C /tmp/PaddleOCR-v3.7.0 rev-parse HEAD
```

输出必须是：

```text
b03f46425e8ff4442b268ce449e3eef758146cd4
```

### 4.3 Python 环境

复现当前 M4 CPU 环境：

```bash
python3.12 -m venv training/ppocrv6-captcha/.venv
training/ppocrv6-captcha/.venv/bin/python -m pip install --upgrade pip
training/ppocrv6-captcha/.venv/bin/python -m pip install \
  -r training/ppocrv6-captcha/python-environment.txt

training/ppocrv6-captcha/.venv/bin/python -c \
  "import paddle; print(paddle.__version__); paddle.utils.run_check()"
```

应看到 PaddlePaddle `3.2.0` 且检查通过。

NVIDIA GPU 环境不要直接安装 CPU wheel。先使用 PaddlePaddle 官方安装选择器安装与 CUDA 匹配的 `paddlepaddle-gpu==3.2.0`，再安装其余依赖，并把 Python、GPU、驱动、CUDA、cuDNN 和最终 `pip freeze` 写入新的模型卡。GPU 训练使用 `Global.use_gpu=true`；生产模型的历史解析配置则是 `false`。

## 5. 获取并验证官方预训练权重

```bash
npm run training:ppocrv6:fetch
```

目标文件：

```text
training/ppocrv6-captcha/assets/PP-OCRv6_tiny_rec_pretrained.pdparams
bytes      71,528,759
SHA-256    960cb4aa5276e3ac235b7f671fb8c9a7c1c1423617da0f96da66a33d0ed53f84
```

下载脚本会先校验字节数和 SHA-256，再原子写入目标位置。校验失败时不要继续训练，也不要手工改掉期望哈希。

## 6. 重建训练数据

### 6.1 数据组成

生产 manifest 共 255,183 张图片：

| split/source | 数量 | 用途 |
| --- | ---: | --- |
| train/public | 145,183 | 增加真实生成器分布 |
| train/synthetic | 100,000 | 平衡类别、运算符和视觉扰动 |
| validation/synthetic | 10,000 | 独立模板验证，只用于选模型和阈值 |

四个公开训练组：

| 数据集 | 数量 | 许可 | 主要类别 |
| --- | ---: | --- | --- |
| MathCaptcha10k v6 | 10,000 | CC-BY-4.0 | 加减算式 |
| parsasam CAPTCHA v1 | 113,062 | CC0-1.0 | 五位英数字 |
| huthayfahodeb CAPTCHA v2 | 10,000 | CC0-1.0 | 六位数字 |
| daniilnxy math v1 | 12,121 | Apache-2.0 | 非负加减算式 |

公开数据都只进入 train。不能把同一公开生成器随机切一部分作为独立 validation；这样会得到虚高指标。

### 6.2 下载公开数据

```bash
npm run training:public:fetch -- mathcaptcha10k-v6
npm run training:public:fetch -- parsasam-captcha-v1
npm run training:public:fetch -- huthayfahodeb-captcha-v2
npm run training:public:fetch -- daniilnxy-math-problem-captcha-v1
```

下载信息、版本、字节数、SHA-256 和许可证都固定在 `public-datasets.ts`。Kaggle 源版本变化或下载内容变化会直接失败，不能静默接受新版本。

### 6.3 导入公开数据

```bash
npm run training:public:import -- mathcaptcha10k-v6
npm run training:public:import -- parsasam-captcha-v1
npm run training:public:import -- huthayfahodeb-captcha-v2
npm run training:public:import -- daniilnxy-math-problem-captcha-v1
```

导入器会校验标签格式、文件数量、图片魔数、重复项和已知错误标签。每次合并后都会重新生成 `manifest.json`、`licenses.json`、`train.txt` 和 `validation.txt`。

### 6.4 生成合成数据

```bash
npm run training:synthetic:generate
```

默认生成 100,000 张训练图和 10,000 张验证图，每类数量相同。训练和验证使用不同 template group：

```text
train:      dots, lines, outline, shadow
validation: crossline, curves, speckle, wave
```

生成器覆盖字体、颜色、低对比度、旋转、错切、字符间距、波形、描边、阴影、噪点、直线/曲线、模糊、缩放和压缩退化。算式标签独立轮换八种运算符及后缀，减法保证非负，除法保证整除。

### 6.5 生成 320k 平衡训练清单

原始 train 有 245,183 张图，但普通英数字数据占比很大。训练实际读取确定性的 320,000 行平衡清单：

```bash
npm run training:labels:balance -- 80000
```

这会分别抽取/重复采样：

```text
digits       80,000
letters      80,000
alphanumeric 80,000
arithmetic   80,000，其中八种运算符各 10,000
```

清单内部再次按固定种子 `0x4d7a91c3` 打乱。过采样只改变标签行出现次数，不复制图片文件。

### 6.6 数据预检和期望哈希

```bash
npm test -- tests/training

shasum -a 256 \
  training/ppocrv6-captcha/data/manifest.json \
  training/ppocrv6-captcha/charset.txt \
  training/ppocrv6-captcha/generate-synthetic.ts \
  training/ppocrv6-captcha/materialize-balanced-labels.ts

wc -l \
  training/ppocrv6-captcha/data/train.txt \
  training/ppocrv6-captcha/data/train-balanced.txt \
  training/ppocrv6-captcha/data/validation.txt
```

生产数据的期望值：

```text
manifest SHA-256   1aa36d0b16fcc4e7bb3122e1a9ea686937cf6eb45d4dceb2fb755ef43c6d2ac3
charset SHA-256    1933b1e9373a814f1c2a9a12de963b088832e4867eea279add473f9b11ee6961
generator SHA-256  59599f2546e2f12b2182701e8405f08b9f76e4d9f9b57dacc1d2a0db0bb42ebf
balance SHA-256    ec988e343765fb1785f71cc3a7dd74ec74b40f8d0a7bcb4ee3c293296a3bcf95
train.txt          245,183 lines
train-balanced     320,000 lines
validation.txt      10,000 lines
```

manifest 校验会拒绝 group 跨 split、重复图片、非法字符、超过 12 字符的标签、未知许可证，以及任何 frozen benchmark 图片哈希。

## 7. 生产模型实际训练谱系

生产模型不是一次 60 epoch 得到的，而是一次探索性 continuation chain。所有正式全量阶段都使用 Adam、Cosine LR、L2 `3e-5`、batch size 128、seed `20260728`，并从上一阶段 `best_accuracy.pdparams` 作为 pretrained model 启动新的优化器。

| 阶段 | 数据行 | epoch | 初始 LR | parent | Paddle greedy exact |
| --- | ---: | ---: | ---: | --- | ---: |
| `paddle-probe8k-ctc-only` | 临时 8k | 2 | 1e-4 | 8k full-head probe | 84.77% probe |
| `paddle-ctc-v1-160k` | 当时 160k | 3 | 2e-4 | probe CTC-only | 88.31% |
| `paddle-ctc-v2-320k` | 320k | 2 | 1e-4 | v1 | 89.71% |
| `paddle-ctc-v3-fitted-320k` | 320k | 1 | 5e-5 | v2 | 91.94% |
| `paddle-ctc-v4-decoupled-320k` | 320k | 1 | 5e-5 | v3 | 94.66% |

v3 修正了合成图片画布按真实渲染文字宽度扩展的问题，避免长算式被裁切。v4 又将算式运算符、样式和内容的轮换解耦，避免某些运算符只看到少数视觉风格。

v1 当时使用的 160k 清单和最早 8k probe 清单未保留，所以不要把上表误解为全新 clone 可逐字节重放的脚本。它是生产 checkpoint 的真实实验谱系，也是以后必须保留每个阶段输入清单哈希的原因。

## 8. 重放最终 v4 阶段

当前工作区若仍保留 v3 父 checkpoint，可重放最终阶段。先确认父权重：

```text
training/ppocrv6-captcha/output/paddle-ctc-v3-fitted-320k/best_accuracy.pdparams
SHA-256 a3223fd155ef7ef4837594bc633850ddeec6f83a2e1c4f7b58355f99c8186260
```

运行到新的输出目录，避免覆盖生产 checkpoint：

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  training/ppocrv6-captcha/train_paddle_ctc_only.py \
  -c training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/config.yml \
  -o \
  Global.pretrained_model=./training/ppocrv6-captcha/output/paddle-ctc-v3-fitted-320k/best_accuracy.pdparams \
  Global.save_model_dir=./training/ppocrv6-captcha/output/replay-v4
```

`pretrained_model` 表示加载权重并创建新优化器。若同一个阶段意外中断，需要连优化器一起恢复，应改为：

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  training/ppocrv6-captcha/train_paddle_ctc_only.py \
  -c training/ppocrv6-captcha/output/replay-v4/config.yml \
  -o Global.checkpoints=./training/ppocrv6-captcha/output/replay-v4/latest
```

不要同时设置 `pretrained_model` 和 `checkpoints`。前者是开始新阶段，后者是恢复同一阶段。

## 9. 评估 Paddle checkpoint

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  /tmp/PaddleOCR-v3.7.0/tools/eval.py \
  -c training/ppocrv6-captcha/output/replay-v4/config.yml \
  -o Global.checkpoints=./training/ppocrv6-captcha/output/replay-v4/best_accuracy.pdparams
```

Paddle 的 `RecMetric.acc` 使用 greedy CTC whole-string exact，只用于训练期选 checkpoint。最终浏览器策略还包含按模式解码、算式求值和拒识阈值，所以发布结论必须以第 12 节的 Node/WASM 和浏览器评估为准。

## 10. 全新环境的推荐重训方案

没有历史父 checkpoint 时，使用仓库已实现的两阶段方案：

### 10.1 阶段 A：冻结 backbone，训练新 head

官方预训练模型的字符集和本项目不同，因此先冻结 backbone，只让新 head 适应 71 类输出：

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  training/ppocrv6-captcha/train_head_warmup.py \
  -c training/ppocrv6-captcha/config.yml \
  -o \
  Global.use_gpu=false \
  Global.epoch_num=3 \
  Global.save_model_dir=./training/ppocrv6-captcha/output/clean-warmup
```

日志必须出现非零 `frozen_backbone` 和 `trainable_head`，并确认官方 checkpoint 大部分 backbone 参数加载成功。

### 10.2 阶段 B：全模型微调

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  /tmp/PaddleOCR-v3.7.0/tools/train.py \
  -c training/ppocrv6-captcha/config.yml \
  -o \
  Global.use_gpu=false \
  Global.epoch_num=60 \
  Global.pretrained_model=./training/ppocrv6-captcha/output/clean-warmup/latest.pdparams \
  Global.save_model_dir=./training/ppocrv6-captcha/output/clean-full
```

这是干净、完整、可执行的重训路线，但它不是生产模型当时的探索链，因此必须作为新 candidate 重新做所有评估，不能直接沿用生产指标或阈值。实际训练时可先跑 1 epoch smoke，确认 loss、显存/内存和输出类别数正确，再开始长任务。

对只关心浏览器 CTC 分支的后续实验，可在 warmup 后改用 `train_paddle_ctc_only.py`，但这属于新的训练配方，必须用独立 candidate id 对比验证，不能与 full MultiHead 结果混记。

## 11. 导出 Paddle inference 和 ONNX

下面用生产 checkpoint 演示。换成新 checkpoint 时只修改输入和输出目录。

### 11.1 导出 Paddle inference

```bash
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  /tmp/PaddleOCR-v3.7.0/tools/export_model.py \
  -c training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/config.yml \
  -o \
  Global.pretrained_model=./training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/best_accuracy.pdparams \
  Global.save_inference_dir=./training/ppocrv6-captcha/output/reexport-v4
```

已验证的生产输出：

```text
inference.json
  bytes      108,937
  SHA-256    cbf6b9e89468ce400fe0c846ec5982baa3b7702dfc36481808cbc7fbc4f7405b

inference.pdiparams
  bytes      2,205,868
  SHA-256    e093a9241b10ffc5ee2799156168c0a7fbcbeab5d668d1fd6a889cfce37e672a
```

### 11.2 转换为 ONNX

```bash
training/ppocrv6-captcha/.venv/bin/paddle2onnx \
  --model_dir training/ppocrv6-captcha/output/reexport-v4 \
  --model_filename inference.json \
  --params_filename inference.pdiparams \
  --save_file training/ppocrv6-captcha/output/reexport-v4/captcha-ctc.onnx \
  --opset_version 17 \
  --enable_onnx_checker True \
  --optimize_tool onnxoptimizer
```

当前环境未安装可选的 `onnxoptimizer`，转换器会记录 warning 并跳过该优化；生产 ONNX 正是这个未额外优化的输出。不要为了消除 warning 临时安装不同版本的优化器，否则会产生新的候选模型和哈希。

同一生产 inference 文件重新转换已得到完全相同的 ONNX 哈希。检查方法：

```bash
shasum -a 256 training/ppocrv6-captcha/output/reexport-v4/captcha-ctc.onnx
wc -c training/ppocrv6-captcha/output/reexport-v4/captcha-ctc.onnx
```

### 11.3 运行时配置

`captcha-ctc.json` 不是权重，而是浏览器预处理和解码契约。字符集和输入形状不变时，可从生产配置开始：

```bash
cp public/models/captcha-ctc.json \
  training/ppocrv6-captcha/output/reexport-v4/captcha-ctc.json
```

它必须满足：blank 在索引 0、总类别数 71、输入 `[3,48,320]`。新字符集不能只改 JSON；必须重建 head 并重新训练。

## 12. ONNX、阈值和冻结基准评估

把候选文件放在以下结构：

假设候选 id 为 `captcha-ctc-next`，文件结构应为：

```text
training/ppocrv6-captcha/output/captcha-ctc-next/exported/captcha-ctc.onnx
training/ppocrv6-captcha/output/captcha-ctc-next/exported/captcha-ctc.json
```

运行浏览器等价的 Node/WASM 评估：

```bash
export CAPTCHA_CANDIDATE_ID=captcha-ctc-next
CAPTCHA_CTC_CANDIDATE="$CAPTCHA_CANDIDATE_ID" npm run benchmark:captcha-ctc \
  > "training/ppocrv6-captcha/output/$CAPTCHA_CANDIDATE_ID/benchmark-report.json"
```

该报告同时覆盖：

- 10,000 张 isolated validation；
- 200 张 frozen generated benchmark；
- 已授权的 frozen real 样本；
- digits、letters、alphanumeric、arithmetic 分类；
- 数据 source 和 scenario group；
- 八种算术运算符；
- 99.5% 目标精度下的阈值和 coverage；
- 高置信度错误明细。

阈值只能用 validation 调整，不能看 frozen benchmark 后反向调参。当前生产阈值为：

```text
digits       0.860
letters      0.984
alphanumeric 0.994
arithmetic   0.620
```

最终固定阈值达到 99.587% precision、82.38% coverage。算式结构不完整或运算符证据模糊时必须拒识，不能回退成纯数字自动填写。

Paddle/ONNX 数值 parity 需要固定随机张量和真实图片张量，要求：

- 输出形状一致且最后一维为 71；
- 最大绝对概率差不超过 `1e-5`；
- 每个样本 argmax CTC decode 完全一致。

生产模型实测最大差异 `6.23e-6`，decode 全部一致。当前 parity 操作还没有封装成独立 npm 命令；新模型发布前必须把 parity 输入、输出和脚本随模型卡保留，不能只写“肉眼一致”。这是现有流程仍需补齐的自动化项。

## 13. 浏览器离线验收

先构建候选或把已批准模型放入 `public/models`，然后执行：

```bash
npm test
npm run typecheck
npm run build
npm run build:edge
npm run test:e2e:recognition:chrome
npm run test:e2e:recognition:edge
```

浏览器验收必须确认：

- 启动时断网；
- 识别期间零 HTTP(S) 请求；
- 模型只从扩展包加载；
- Chrome/Edge 都能识别 digits 和真实算式样本；
- cold start 不超过 3 秒；
- warm P95 不超过 500 ms，当前内部目标为 100 ms；
- 最终扩展仍不自动提交表单。

生产实测：Chrome warm P95 `11.70 ms`，Edge warm P95 `12.50 ms`，Edge 模型 warmup `266 ms`。

## 14. 新场景继续训练的正确方式

以后遇到某类验证码识别差，不要把一张 issue 截图直接塞进 train：

1. 收集多张有授权的图片和精确标签。
2. 给该网站/生成器版本分配新的稳定 `group`。
3. 先把一部分完全隔离的样本加入 frozen real benchmark。
4. 其余可训练样本记录 source、license、SHA-256 和 group 后进入 train。
5. 若视觉机制可通用化，优先扩展合成生成器，例如镂空字、粘连、透视、弧线遮挡，而不是写 hostname 特判。
6. 从当前生产 Paddle checkpoint 以较小 LR 创建新 candidate，保留旧模型做基线。
7. 重新校准阈值并跑全部 validation、frozen、Chrome 和 Edge 门槛。
8. 更新模型卡后才能替换 `public/models`。

建议 continuation 起点：

下面示例使用候选 id `captcha-ctc-next`：

```bash
export CAPTCHA_CANDIDATE_ID=captcha-ctc-next
PADDLEOCR_ROOT=/tmp/PaddleOCR-v3.7.0 \
  training/ppocrv6-captcha/.venv/bin/python \
  training/ppocrv6-captcha/train_paddle_ctc_only.py \
  -c training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/config.yml \
  -o \
  Global.epoch_num=1 \
  Optimizer.lr.learning_rate=0.00002 \
  Global.pretrained_model=./training/ppocrv6-captcha/output/paddle-ctc-v4-decoupled-320k/best_accuracy.pdparams \
  Global.save_model_dir="./training/ppocrv6-captcha/output/$CAPTCHA_CANDIDATE_ID"
```

`0.00002` 只是保守的初始实验值，不是已批准的新配方。必须与至少一个更低/更高 LR 对照，并以隔离 benchmark 决策，不能因为训练 loss 更低就发布。

## 15. 每次训练必须保存的材料

每个 candidate 至少保存：

- 仓库 commit 和 dirty diff；
- PaddleOCR commit；
- Python/Paddle/CUDA/驱动环境；
- manifest、charset、label list、生成器和 balance 脚本哈希；
- 完整解析后的 `config.yml`；
- 启动命令和 stdout/stderr 日志；
- parent checkpoint 和 selected checkpoint 哈希；
- Paddle inference、ONNX、runtime config 哈希；
- Paddle/ONNX parity 报告；
- validation、frozen、分类、group、运算符、阈值报告；
- Chrome/Edge 离线延迟和网络请求证据；
- 已知失败场景和明确不支持范围。

只有这些材料完整，后续的人才能判断指标变化来自数据、代码、依赖、训练参数、阈值还是浏览器运行时，而不是靠猜测。
