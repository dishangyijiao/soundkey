"""Build the tiny ONNX model used by the Rust tests (tests/fixtures/*.onnx).

It has the same interface as the real phoneme model (`input_values` [1, N] ->
`logits` [1, N, V]) but is made of two operators: a positive sample votes for
the token `θ`, a negative one for `ɪ`, and silence for the blank (id 0).
Run with any Python that has the `onnx` package; the output is committed.
"""

import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

ROOT = Path(__file__).resolve().parent.parent
vocab = json.loads((ROOT / "assets" / "vocab.json").read_text(encoding="utf-8"))
size = max(vocab.values()) + 1

weights = np.zeros((1, size), dtype=np.float32)
weights[0, vocab["θ"]] = 1.0
weights[0, vocab["ɪ"]] = -1.0



def build(name, length):
    graph = helper.make_graph(
        [
            helper.make_node("Unsqueeze", ["input_values", "axes"], ["column"]),
            helper.make_node("MatMul", ["column", "weights"], ["logits"]),
        ],
        name,
        [helper.make_tensor_value_info("input_values", TensorProto.FLOAT, [1, length])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, length, size])],
        initializer=[
            numpy_helper.from_array(np.array([2], dtype=np.int64), "axes"),
            numpy_helper.from_array(weights, "weights"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests" / "fixtures"
out_dir.mkdir(parents=True, exist_ok=True)
# `fixed_phoneme.onnx` only accepts 4 samples: any other length makes inference fail.
for file, length in [("tiny_phoneme.onnx", "length"), ("fixed_phoneme.onnx", 4)]:
    path = out_dir / file
    onnx.save(build(file, length), path)
    print(f"wrote {path} ({path.stat().st_size} bytes)")
