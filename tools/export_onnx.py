"""Export the phoneme model to ONNX for the local Rust server.

Runtime does not use this script. `soundkey setup` runs it once.
"""

import argparse
from pathlib import Path

import torch
from transformers import Wav2Vec2ForCTC


MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"


class Logits(torch.nn.Module):
    def __init__(self, model: Wav2Vec2ForCTC) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_values: torch.Tensor) -> torch.Tensor:
        return self.model(input_values).logits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
    model.eval()
    wrapped = Logits(model)
    wrapped.eval()

    dummy = torch.randn(1, 16000)
    onnx_path = out / "model.onnx"
    export_kwargs = dict(
        input_names=["input_values"],
        output_names=["logits"],
        dynamic_axes={"input_values": {1: "length"}, "logits": {1: "time"}},
        opset_version=17,
    )
    try:
        torch.onnx.export(wrapped, dummy, str(onnx_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(wrapped, dummy, str(onnx_path), **export_kwargs)

    print(f"wrote {onnx_path}")


if __name__ == "__main__":
    main()
