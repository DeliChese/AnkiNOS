"""Read-only archive compatibility for the removed learning feature."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3


def validate_database(path: Path) -> dict:
    required={
        "mappings":{"collection_key","deck_id","model_id","config"},
        "sources":{"source_key","revision","snapshot","active"},
        "sessions":{"id","collection_key","started_at","ended_at","status","planned"},
        "presentations":{"id","session_id","source_key","revision","mode","prior_exposure"},
        "exposures":{"id","session_id","source_key","revision","presentation_id","kind","at"},
        "attempts":{"id","session_id","presentation_id","request","result","at"},
    }
    with closing(sqlite3.connect(path.resolve().as_uri()+"?mode=ro",uri=True)) as db:
        if db.execute("PRAGMA quick_check").fetchone()[0]!="ok" or db.execute("PRAGMA user_version").fetchone()[0] not in {1,2,3}:
            raise ValueError("Dữ liệu học cũ không hợp lệ hoặc phiên bản chưa hỗ trợ.")
        objects=db.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if {name for kind,name in objects if kind=="table"}!=set(required) or any(kind not in {"table","index"} for kind,_ in objects):
            raise ValueError("Cấu trúc dữ liệu học cũ không hợp lệ.")
        for table,columns in required.items():
            if not columns.issubset({row[1] for row in db.execute(f"PRAGMA table_info({table})")}):
                raise ValueError("Thiếu cột trong dữ liệu học cũ.")
        for table,column,kind,limit in (("sources","snapshot",dict,100000),("mappings","config",dict,10000),
                ("attempts","request",dict,50000),("attempts","result",dict,50000),("sessions","planned",(list,dict),100000)):
            for (raw,) in db.execute(f"SELECT {column} FROM {table}"):
                if not isinstance(raw,str) or len(raw)>limit or not isinstance(json.loads(raw),kind):
                    raise ValueError("Nội dung dữ liệu học cũ không hợp lệ.")
        return {"sessions":db.execute("SELECT count(*) FROM sessions").fetchone()[0],
                "attempts":db.execute("SELECT count(*) FROM attempts").fetchone()[0]}
