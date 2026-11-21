from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "brainexer",
    ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)],
)
if spec is None or spec.loader is None:
    raise RuntimeError("Không thể nạp package BrainExer cho tests.")
module = importlib.util.module_from_spec(spec)
sys.modules.setdefault("brainexer", module)
spec.loader.exec_module(module)
