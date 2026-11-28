"""Small collection adapters. Called inside QueryOp, never changes card data."""
from __future__ import annotations
from .workspace_store import folded

COLLECTION_KEY = "ankinos_learning_collection_uuid"


COMMANDS = [
    ("study", "Học bộ thẻ hiện tại", "học tiếp ôn tập study review learn current deck 学习 复习 当前牌组"),
    ("daily", "Lịch ôn theo ngày", "lịch ôn theo ngày thông minh due schedule daily memory 每日复习 计划 日程"),
    ("focus", "Bắt đầu Focus", "tập trung thời gian focus timer session 专注 计时器"),
    ("notebook", "Sổ tay của bộ thẻ", "ghi chú sổ tay notes notebook 笔记 笔记本"),
    ("add", "Thêm thẻ Anki", "tạo thẻ note add cards 添加卡片 新建"),
    ("browse", "Duyệt thẻ", "tìm kiếm browser browse cards 浏览卡片 搜索"),
    ("stats", "Thống kê AnkiNOS", "thống kê số liệu lịch sử stats statistics analytics graphs 统计 数据 图表"),
    ("sync", "Đồng bộ Anki", "đồng bộ ankiweb sync 同步"),
    ("backup", "Tạo gói sao lưu AnkiNOS", "sao lưu dữ liệu backup archive export 备份 导出"),
    ("toggle_nos", "Bật / tắt giao diện AnkiNOS", "quay lại ankinos giao diện gốc native default switch ui enable 返回 ankinos 原生界面 切换界面"),
]


def palette_results(col, query: str, resources: list[dict], workspace=None) -> list[dict]:
    query = folded(query.strip()[:200])
    def matches(text):
        return all(word in folded(text) for word in query.split())
    result = [{"kind": "action", "id": key, "title": title, "detail": "Lệnh"}
              for key, title, keywords in COMMANDS if matches(title+" "+keywords)][:8]
    decks = col.decks.all_names_and_ids()
    matches_decks = sorted((d for d in decks if matches(d.name)), key=lambda d: (len(d.name),d.name.casefold()))[:8]
    result += [{"kind": "deck", "id": str(d.id), "title": d.name, "detail": "Bộ thẻ · mở chuẩn bị học"} for d in matches_decks]
    result += [{"kind": "resource", "id": r["id"], "title": r["name"], "detail": "Tài nguyên · "+r.get("kind","")}
               for r in resources if matches(r["name"])][:8]
    key = col.get_config(COLLECTION_KEY)
    if workspace and isinstance(key,str):
        result += [{"kind":"note","id":r["id"],"deck":r["deck_id"],"title":r["title"] or r["body"][:60],"detail":"Ghi chú · "+r["deck_name"]}
                   for r in workspace.list(key,query=query)[:6]]
    return result
