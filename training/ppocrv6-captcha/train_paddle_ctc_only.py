#!/usr/bin/env python3
"""PaddleOCR training entry point that skips the inference-unused NRTR guide head."""

import os
import sys


PADDLEOCR_ROOT = os.environ.get("PADDLEOCR_ROOT")
if not PADDLEOCR_ROOT or not os.path.isabs(PADDLEOCR_ROOT):
    raise RuntimeError("PADDLEOCR_ROOT must be an absolute PaddleOCR v3.7.0 checkout")
sys.path.insert(0, PADDLEOCR_ROOT)

import paddle  # noqa: E402
import tools.program as program  # noqa: E402
import tools.train as paddle_train  # noqa: E402
from ppocr.modeling.architectures import build_model as official_build_model  # noqa: E402
from ppocr.utils.utility import set_seed  # noqa: E402


class MultiLabelCtcLoss(paddle.nn.Layer):
    def __init__(self):
        super().__init__()
        self.loss = paddle.nn.CTCLoss(blank=0, reduction="none")

    def forward(self, predictions, batch):
        predictions = predictions.transpose((1, 0, 2))
        time_steps, batch_size, _ = predictions.shape
        prediction_lengths = paddle.to_tensor(
            [time_steps] * batch_size,
            dtype="int64",
            place=paddle.CPUPlace(),
        )
        labels = batch[1].astype("int32")
        label_lengths = batch[3].astype("int64")
        return {
            "loss": self.loss(
                predictions,
                labels,
                prediction_lengths,
                label_lengths,
            ).mean()
        }


def ctc_only_forward(head, inputs, targets=None):
    if head.use_pool:
        inputs = head.pool(
            inputs.reshape([0, 3, -1, head.in_channels]).transpose([0, 3, 1, 2])
        )
    encoded = head.ctc_encoder(inputs)
    return head.ctc_head(encoded, targets)


def build_ctc_only_model(config):
    model = official_build_model(config)
    if not hasattr(model, "backbone") or not hasattr(model, "head"):
        raise RuntimeError("PP-OCRv6 CTC-only training requires model.backbone and model.head")
    if not hasattr(model.head, "ctc_encoder") or not hasattr(model.head, "ctc_head"):
        raise RuntimeError("PP-OCRv6 CTC-only training requires the official MultiHead CTC branch")

    model.head.forward = lambda inputs, targets=None: ctc_only_forward(
        model.head,
        inputs,
        targets,
    )
    for name in ("before_gtc", "gtc_head"):
        layer = getattr(model.head, name, None)
        if layer is not None:
            for parameter in layer.parameters():
                parameter.stop_gradient = True
    if os.environ.get("CAPTCHA_FREEZE_BACKBONE") == "1":
        for parameter in model.backbone.parameters():
            parameter.stop_gradient = True

    trainable = sum(parameter.numel() for parameter in model.parameters() if not parameter.stop_gradient)
    frozen = sum(parameter.numel() for parameter in model.parameters() if parameter.stop_gradient)
    print(f"CTC-only contract: trainable={trainable}, frozen={frozen}")
    return model


def main():
    paddle_train.build_model = build_ctc_only_model
    paddle_train.build_loss = lambda _: MultiLabelCtcLoss()
    config, device, logger, vdl_writer = program.preprocess(is_train=True)
    config["Global"]["cal_metric_during_train"] = False
    set_seed(config["Global"].get("seed", 20260728))
    paddle_train.main(config, device, logger, vdl_writer)


if __name__ == "__main__":
    main()
