#!/usr/bin/env python3
import argparse
import json
import math
import os
import random
import re
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
from PIL import Image, ImageOps
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler


ROOT = Path(__file__).resolve().parents[2]
TRAINING_ROOT = ROOT / "training" / "ppocrv6-captcha"
ARITHMETIC = re.compile(r"^[0-9]+([+\-*/xX×÷])[0-9]+(?:=\?|=|\?)?$")
DIGITS = re.compile(r"^[0-9]+$")
LETTERS = re.compile(r"^[A-Za-z]+$")


def category(label: str) -> str:
    if ARITHMETIC.fullmatch(label):
        return "arithmetic"
    if DIGITS.fullmatch(label):
        return "digits"
    if LETTERS.fullmatch(label):
        return "letters"
    return "alphanumeric"


def sampling_bucket(label: str) -> str:
    arithmetic = ARITHMETIC.fullmatch(label)
    return f"arithmetic:{arithmetic.group(1)}" if arithmetic else category(label)


class CaptchaDataset(Dataset):
    def __init__(self, samples, charset):
        self.samples = samples
        self.class_by_character = {character: index + 1 for index, character in enumerate(charset)}
        self.categories = [category(sample["label"]) for sample in samples]

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        image_path = TRAINING_ROOT / sample["image"]
        with Image.open(image_path) as source:
            source = ImageOps.exif_transpose(source).convert("RGBA")
            background = Image.new("RGBA", source.size, "white")
            image = Image.alpha_composite(background, source).convert("RGB")
        resized_width = min(320, max(1, math.ceil(48 * image.width / image.height)))
        image = image.resize((resized_width, 48), Image.Resampling.BILINEAR)
        rgb = np.asarray(image, dtype=np.float32)
        tensor = np.zeros((3, 48, 320), dtype=np.float32)
        tensor[:, :, :resized_width] = np.transpose(rgb[:, :, ::-1] / 127.5 - 1.0, (2, 0, 1))
        target = torch.tensor(
            [self.class_by_character[character] for character in sample["label"]],
            dtype=torch.long,
        )
        return torch.from_numpy(tensor), target, sample["label"], self.categories[index]


def collate(batch):
    images, targets, labels, categories = zip(*batch)
    lengths = torch.tensor([target.numel() for target in targets], dtype=torch.long)
    return torch.stack(images), torch.cat(targets), lengths, labels, categories


class DepthwiseBlock(nn.Module):
    def __init__(self, in_channels, out_channels, stride):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(in_channels, in_channels, 3, stride=stride, padding=1, groups=in_channels, bias=False),
            nn.BatchNorm2d(in_channels),
            nn.SiLU(inplace=True),
            nn.Conv2d(in_channels, out_channels, 1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.SiLU(inplace=True),
        )

    def forward(self, inputs):
        return self.layers(inputs)


class ContextBlock(nn.Module):
    def __init__(self, channels, dilation, expansion=2):
        super().__init__()
        hidden = channels * expansion
        self.layers = nn.Sequential(
            nn.Conv1d(channels, channels, 3, padding=dilation, dilation=dilation, groups=channels, bias=False),
            nn.BatchNorm1d(channels),
            nn.SiLU(inplace=True),
            nn.Conv1d(channels, hidden, 1, bias=False),
            nn.BatchNorm1d(hidden),
            nn.SiLU(inplace=True),
            nn.Conv1d(hidden, channels, 1, bias=False),
            nn.BatchNorm1d(channels),
        )
        self.activation = nn.SiLU(inplace=True)

    def forward(self, inputs):
        return self.activation(inputs + self.layers(inputs))


class CaptchaCtc(nn.Module):
    def __init__(self, classes=71):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 48, 3, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(48),
            nn.SiLU(inplace=True),
            DepthwiseBlock(48, 96, 2),
            DepthwiseBlock(96, 160, (2, 1)),
            DepthwiseBlock(160, 256, (2, 1)),
            nn.Conv2d(256, 320, (3, 1), bias=False),
            nn.BatchNorm2d(320),
            nn.SiLU(inplace=True),
        )
        self.context = nn.Sequential(
            ContextBlock(320, 1),
            ContextBlock(320, 2),
            ContextBlock(320, 4),
            ContextBlock(320, 8),
        )
        self.head = nn.Conv1d(320, classes, 1)

    def forward(self, inputs):
        features = self.features(inputs).squeeze(2)
        return self.head(self.context(features)).transpose(1, 2)


class InferenceModel(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, inputs):
        return torch.softmax(self.model(inputs), dim=-1)


def decode_batch(probabilities, charset):
    decoded = []
    confidences = []
    for rows in probabilities:
        indices = rows.argmax(dim=1).tolist()
        values = rows.max(dim=1).values.tolist()
        previous = 0
        text = []
        selected = []
        for index, confidence in zip(indices, values):
            if index == 0:
                previous = 0
            elif index == previous:
                selected[-1] = max(selected[-1], confidence)
            else:
                text.append(charset[index - 1])
                selected.append(confidence)
                previous = index
        decoded.append("".join(text))
        confidences.append(sum(selected) / len(selected) if selected else 0.0)
    return decoded, confidences


def evaluate(model, loader, charset, device):
    model.eval()
    totals = Counter()
    correct = Counter()
    accepted = Counter()
    accepted_correct = Counter()
    with torch.inference_mode():
        for images, _, _, labels, categories in loader:
            probabilities = torch.softmax(model(images.to(device)), dim=-1).cpu()
            predictions, confidences = decode_batch(probabilities, charset)
            for label, predicted, confidence, sample_category in zip(labels, predictions, confidences, categories):
                totals[sample_category] += 1
                exact = label == predicted
                correct[sample_category] += int(exact)
                if confidence >= 0.9:
                    accepted[sample_category] += 1
                    accepted_correct[sample_category] += int(exact)
    metrics = {}
    for sample_category in ["digits", "letters", "alphanumeric", "arithmetic"]:
        count = totals[sample_category]
        metrics[sample_category] = {
            "samples": count,
            "exact": correct[sample_category] / count if count else 0.0,
            "coverageAt90": accepted[sample_category] / count if count else 0.0,
            "precisionAt90": accepted_correct[sample_category] / accepted[sample_category] if accepted[sample_category] else 0.0,
        }
    return metrics


def export_onnx(model, charset, output_directory):
    import onnx
    import onnxruntime as ort

    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / "captcha-ctc.onnx"
    inference = InferenceModel(model.cpu().eval()).eval()
    example = torch.randn(1, 3, 48, 320)
    torch.onnx.export(
        inference,
        example,
        output_path,
        input_names=["x"],
        output_names=["probabilities"],
        dynamic_axes={"x": {0: "batch", 3: "width"}, "probabilities": {0: "batch", 1: "time"}},
        opset_version=17,
        dynamo=False,
    )
    graph = onnx.load(output_path)
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
    with torch.inference_mode():
        expected = inference(example).numpy()
    actual = session.run(None, {"x": example.numpy()})[0]
    maximum_error = float(np.max(np.abs(expected - actual)))
    if maximum_error > 1e-5:
        raise RuntimeError(f"ONNX parity failed: maximum absolute error {maximum_error}")
    config = {
        "schemaVersion": 1,
        "modelName": "captcha_ctc_tiny_71",
        "imageShape": [3, 48, 320],
        "charset": ["", *charset],
    }
    (output_directory / "captcha-ctc.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"onnx": str(output_path), "bytes": output_path.stat().st_size, "maximumAbsoluteError": maximum_error}))


def load_manifest():
    value = json.loads((TRAINING_ROOT / "data" / "manifest.json").read_text())
    return value["samples"]


def smoke_test():
    model = CaptchaCtc()
    inputs = torch.randn(2, 3, 48, 320)
    logits = model(inputs)
    targets = torch.tensor([1, 2, 3, 4, 5, 6], dtype=torch.long)
    lengths = torch.tensor([3, 3], dtype=torch.long)
    input_lengths = torch.full((2,), logits.shape[1], dtype=torch.long)
    loss = nn.CTCLoss(blank=0, zero_infinity=True)(logits.log_softmax(-1).transpose(0, 1), targets, input_lengths, lengths)
    loss.backward()
    parameters = sum(parameter.numel() for parameter in model.parameters())
    print(json.dumps({"shape": list(logits.shape), "loss": float(loss.detach()), "parameters": parameters}))


def stratified_limit(samples, limit, seed):
    if limit is None or limit >= len(samples):
        return samples
    if limit <= 0:
        raise ValueError("Dataset limits must be positive")
    randomizer = random.Random(seed)
    buckets = {name: [] for name in ["digits", "letters", "alphanumeric", "arithmetic"]}
    for sample in samples:
        buckets[category(sample["label"])].append(sample)
    for values in buckets.values():
        randomizer.shuffle(values)
    limited = []
    names = list(buckets)
    while len(limited) < limit:
        progressed = False
        for name in names:
            if buckets[name] and len(limited) < limit:
                limited.append(buckets[name].pop())
                progressed = True
        if not progressed:
            break
    return limited


def train(args):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    charset = [line for line in (TRAINING_ROOT / "charset.txt").read_text().splitlines() if line]
    samples = load_manifest()
    training = stratified_limit(
        [sample for sample in samples if sample["split"] == "train"],
        args.training_limit,
        args.seed,
    )
    validation = stratified_limit(
        [sample for sample in samples if sample["split"] == "validation"],
        args.validation_limit,
        args.seed + 1,
    )
    training_dataset = CaptchaDataset(training, charset)
    validation_dataset = CaptchaDataset(validation, charset)
    category_counts = Counter(training_dataset.categories)
    sampling_buckets = [sampling_bucket(sample["label"]) for sample in training]
    bucket_counts = Counter(sampling_buckets)
    weights = torch.tensor([
        1.0 / ((8 if bucket.startswith("arithmetic:") else 1) * bucket_counts[bucket])
        for bucket in sampling_buckets
    ], dtype=torch.double)
    sampler = WeightedRandomSampler(weights, num_samples=len(training_dataset), replacement=True, generator=torch.Generator().manual_seed(args.seed))
    workers = min(args.workers, os.cpu_count() or 1)
    training_loader = DataLoader(
        training_dataset,
        batch_size=args.batch_size,
        sampler=sampler,
        num_workers=workers,
        persistent_workers=workers > 0,
        collate_fn=collate,
    )
    validation_loader = DataLoader(
        validation_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=workers,
        persistent_workers=workers > 0,
        collate_fn=collate,
    )
    device = torch.device("mps" if torch.backends.mps.is_available() and not args.cpu else "cpu")
    model = CaptchaCtc(classes=len(charset) + 1).to(device)
    resumed_checkpoint = None
    if args.resume:
        resumed_checkpoint = torch.load(args.resume, map_location="cpu", weights_only=True)
        if resumed_checkpoint["charset"] != charset:
            raise ValueError("Resume checkpoint charset does not match the current training charset")
        model.load_state_dict(resumed_checkpoint["model"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=args.learning_rate / 20)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)
    output = TRAINING_ROOT / "output" / args.output_name
    output.mkdir(parents=True, exist_ok=True)
    best_score = -1.0 if resumed_checkpoint is None or args.reset_best else sum(
        value["exact"] for value in resumed_checkpoint["metrics"].values()
    ) / len(resumed_checkpoint["metrics"])
    stale_epochs = 0
    print(json.dumps({"device": str(device), "training": len(training), "validation": len(validation), "categoryCounts": category_counts, "samplingBucketCounts": bucket_counts, "parameters": sum(p.numel() for p in model.parameters())}, default=dict))
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        started = time.perf_counter()
        for step, (images, targets, target_lengths, _, _) in enumerate(training_loader, 1):
            images = images.to(device)
            targets = targets.to(device)
            logits = model(images)
            input_lengths = torch.full((images.shape[0],), logits.shape[1], dtype=torch.long, device=device)
            loss = criterion(logits.log_softmax(-1).transpose(0, 1), targets, input_lengths, target_lengths.to(device))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            total_loss += float(loss.detach().cpu())
            if step % args.log_every == 0:
                print(json.dumps({"epoch": epoch, "step": step, "steps": len(training_loader), "loss": total_loss / step, "seconds": time.perf_counter() - started}), flush=True)
        scheduler.step()
        metrics = evaluate(model, validation_loader, charset, device)
        score = sum(value["exact"] for value in metrics.values()) / len(metrics)
        record = {"epoch": epoch, "loss": total_loss / len(training_loader), "score": score, "metrics": metrics, "seconds": time.perf_counter() - started}
        print(json.dumps(record), flush=True)
        (output / "latest-metrics.json").write_text(json.dumps(record, indent=2) + "\n")
        torch.save({"model": model.state_dict(), "charset": charset, "epoch": epoch, "metrics": metrics}, output / "latest.pt")
        if score > best_score:
            best_score = score
            stale_epochs = 0
            torch.save({"model": model.state_dict(), "charset": charset, "epoch": epoch, "metrics": metrics}, output / "best.pt")
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                break
    checkpoint = torch.load(output / "best.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["model"])
    export_onnx(model, charset, output / "exported")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20260728)
    parser.add_argument("--training-limit", type=int)
    parser.add_argument("--validation-limit", type=int)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--reset-best", action="store_true")
    parser.add_argument("--output-name", default="ctc-v2")
    args = parser.parse_args()
    if args.smoke:
        smoke_test()
    else:
        train(args)


if __name__ == "__main__":
    main()
