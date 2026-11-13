"""Read Anki's native statistics graph data without recreating its scheduler logic.

Anki's Svelte graphs dialog and this add-on use the same Rust graphs backend.
This adapter is deliberately read-only and can run in a QueryOp worker.
"""
from __future__ import annotations

from typing import Any


def collect_native_graphs(col: Any, scope: str = "deck", days: int = 365) -> dict[str, Any]:
    """Return all native graph categories as regular JSON-compatible values.

    GraphsRequest.days=0 requests all history in Anki.  The browser never
    supplies search syntax, only a bounded choice of scope and period.
    """
    if scope not in {"deck", "collection"}:
        raise ValueError("Phạm vi thống kê không hợp lệ.")
    if type(days) is not int or days not in {0, 365}:
        raise ValueError("Khoảng thời gian thống kê không hợp lệ.")
    from google.protobuf.json_format import MessageToDict

    if not hasattr(col._backend, "graphs"):
        raise RuntimeError("Phiên bản Anki này chưa hỗ trợ dữ liệu đồ thị gốc.")
    response = col._backend.graphs(
        search="deck:current" if scope == "deck" else "",
        days=days,
    )
    return {
        "scope": scope,
        "days": days,
        "data": MessageToDict(response, preserving_proto_field_name=True),
    }
