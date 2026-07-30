"""PaddleOCR entry point for the three-epoch output-head warmup stage."""

import os
import sys


PADDLEOCR_ROOT = os.environ.get("PADDLEOCR_ROOT")
if not PADDLEOCR_ROOT or not os.path.isabs(PADDLEOCR_ROOT):
    raise RuntimeError("PADDLEOCR_ROOT must be an absolute PaddleOCR v3.7.0 checkout")
sys.path.insert(0, PADDLEOCR_ROOT)

import tools.program as program  # noqa: E402
import tools.train as paddle_train  # noqa: E402
from ppocr.modeling.architectures import build_model as official_build_model  # noqa: E402
from ppocr.utils.utility import set_seed  # noqa: E402


def build_model_with_frozen_backbone(config):
    model = official_build_model(config)
    if not hasattr(model, "backbone") or not hasattr(model, "head"):
        raise RuntimeError("PP-OCRv6 warmup requires model.backbone and model.head")

    frozen = 0
    for parameter in model.backbone.parameters():
        parameter.stop_gradient = True
        frozen += parameter.numel()
    trainable_head = sum(
        parameter.numel()
        for parameter in model.head.parameters()
        if not parameter.stop_gradient
    )
    if frozen == 0:
        raise RuntimeError("No backbone parameters were frozen")
    if trainable_head == 0:
        raise RuntimeError("No trainable head parameters remain")
    print(f"Warmup contract: frozen_backbone={frozen}, trainable_head={trainable_head}")
    return model


def main():
    paddle_train.build_model = build_model_with_frozen_backbone
    config, device, logger, vdl_writer = program.preprocess(is_train=True)
    set_seed(config["Global"].get("seed", 20260728))
    paddle_train.main(config, device, logger, vdl_writer)


if __name__ == '__main__':
    main()
