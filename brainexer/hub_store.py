"""Profile-local sessions, mistakes, audio library and game records."""

from __future__ import annotations

import json
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .core.hub import DEFAULT_LISTENING_DIFFICULTY, INTERVALS, listening_grade, local_grade, schedule
from .db.connection import Database, json_text, utc_now


class HubStore:
    def __init__(self, path: Path):
        self.database = Database(path)

    def deck_kinds(self) -> dict[str, str]:
        with closing(self.database.connect()) as connection, connection:
            return {row["deck_name"]: row["kind"] for row in connection.execute("SELECT * FROM deck_kinds")}

    def deck_kind(self, name: str) -> str:
        kinds = self.deck_kinds()
        parts = name.split("::")
        for count in range(len(parts), 0, -1):
            if kind := kinds.get("::".join(parts[:count])):
                return kind
        return ""

    def listening_priority(self, deck_name: str, include_children: bool = False) -> list[int]:
        with closing(self.database.connect()) as connection:
            rows = connection.execute(
                "SELECT source_card_id FROM mistakes WHERE source_card_id IS NOT NULL "
                "AND mastered=0 AND kind IN ('listening','spelling','meaning') "
                "AND (deck_name=? OR (? AND substr(deck_name,1,length(?)+2)=?||'::')) "
                "ORDER BY CASE kind WHEN 'listening' THEN 0 ELSE 1 END,wrong_count DESC,due_date ASC "
                "LIMIT 20", (deck_name, int(include_children), deck_name, deck_name),
            )
            return list(dict.fromkeys(int(row[0]) for row in rows))

    def field_roles(self, name: str) -> dict[str, str]:
        parts = name.split("::")
        with closing(self.database.connect()) as connection:
            for count in range(len(parts), 0, -1):
                row = connection.execute(
                    "SELECT question_field,answer_field FROM deck_kinds WHERE deck_name=?",
                    ("::".join(parts[:count]),),
                ).fetchone()
                if row and row["question_field"] and row["answer_field"]:
                    return {"question_field": row["question_field"],
                            "answer_field": row["answer_field"]}
        return {"question_field": "", "answer_field": ""}

    def set_field_roles(self, name: str, kind: str, question: str, answer: str) -> None:
        if (kind not in ("language", "knowledge") or
                not all(isinstance(value, str) and len(value) <= 160 for value in (question, answer)) or
                bool(question) != bool(answer) or (question and question == answer)):
            raise ValueError("Hãy chọn hai trường khác nhau hoặc để cả hai ở chế độ tự nhận diện.")
        with closing(self.database.connect()) as connection, connection:
            connection.execute(
                "INSERT INTO deck_kinds(deck_name,kind,question_field,answer_field) VALUES(?,?,?,?) "
                "ON CONFLICT(deck_name) DO UPDATE SET kind=excluded.kind,"
                "question_field=excluded.question_field,answer_field=excluded.answer_field",
                (name, kind, question, answer),
            )

    def set_deck_kind(self, name: str, kind: str) -> None:
        if kind not in ("language", "knowledge"):
            raise ValueError("Loại bộ thẻ không hợp lệ.")
        with closing(self.database.connect()) as connection, connection:
            connection.execute("INSERT INTO deck_kinds(deck_name,kind) VALUES(?,?) "
                               "ON CONFLICT(deck_name) DO UPDATE SET kind=excluded.kind", (name, kind))

    def start(self, deck_id: int, deck_name: str, kind: str, mode: str, session_kind: str = "practice") -> int:
        session_id = self.database.create_session(deck_id, deck_name, 0, True, [mode], "", "")
        with closing(self.database.connect()) as connection, connection:
            connection.execute("UPDATE sessions SET kind=?,mode=?,deck_kind=? WHERE id=?",
                               (session_kind, mode, kind, session_id))
        return session_id

    def question(self, session_id: int, payload: dict) -> dict:
        mode = payload["mode"]
        exercise_id = self.database.insert_exercise(
            session_id, mode, payload["prompt"],
            {"card_id": payload.get("source_card_id"), "note_id": payload.get("source_note_id")},
            payload, "local", "card-fields", "hub-1", "",
            card_id=payload.get("source_card_id"), note_id=payload.get("source_note_id"),
        )
        return {"id": exercise_id, **payload}

    def answer(self, exercise_id: int, answer: str, *, confidence: str = "", hint: bool = False,
               response_ms: int = 0, today: date | None = None, ignore_accents: bool = False,
               game_mistakes: bool = True, intervals: tuple[int, ...] = INTERVALS,
               self_score: int | None = None) -> dict:
        today = today or date.today()
        with self.database.immediate() as connection:
            row = connection.execute(
                "SELECT e.*,s.deck_name,s.kind AS session_kind,s.deck_kind FROM exercises e "
                "JOIN sessions s ON s.id=e.session_id WHERE e.id=?", (exercise_id,)
            ).fetchone()
            if row is None:
                raise ValueError("Không tìm thấy câu hỏi.")
            previous = connection.execute("SELECT * FROM attempts WHERE exercise_id=? ORDER BY id DESC LIMIT 1",
                                          (exercise_id,)).fetchone()
            if previous:
                return json.loads(previous["feedback_payload"])
            payload = json.loads(row["exercise_payload"])
            if payload.get("self_check") and self_score is None:
                return {"needs_self_check": True, "answers": payload["answers"],
                        "explanation": payload.get("explanation", "")}
            if self_score is not None and (not payload.get("self_check") or self_score not in (0, 5, 10)):
                raise ValueError("Mức tự đối chiếu không hợp lệ.")
            wrong_pairs = []
            if payload.get("self_check"):
                score = self_score
                correct = score == 10
            elif payload["mode"] == "application" and payload.get("numeric_tolerance") is not None:
                try:
                    entered = float(answer.strip().replace(",", "."))
                    expected = float(payload["answers"][0].strip().replace(",", "."))
                    correct = abs(entered - expected) <= payload["numeric_tolerance"]
                except ValueError:
                    correct = False
                score = 10 if correct else 0
            elif payload["mode"] == "matching":
                try:
                    chosen = json.loads(answer)
                except (ValueError, TypeError) as error:
                    raise ValueError("Lựa chọn ghép cặp không hợp lệ.") from error
                if not isinstance(chosen, list) or len(chosen) != len(payload["pairs"]):
                    raise ValueError("Hãy ghép đủ các cặp trước khi nộp.")
                wrong_pairs = [(pair, choice) for pair, choice in zip(payload["pairs"], chosen)
                               if not isinstance(choice, str) or not local_grade(choice, [pair["right"]])]
                correct = not wrong_pairs
                score = round(10 * (len(chosen) - len(wrong_pairs)) / len(chosen), 1)
            else:
                correct = local_grade(answer, payload["answers"], ignore_accents=ignore_accents)
                score = (8 if hint and payload["mode"] == "unscramble" else 10) if correct else 0
            feedback = {
                "correct": correct, "score": score, "answers": payload["answers"],
                "explanation": payload.get("explanation", ""), "confidence": confidence,
            }
            if payload.get("self_check"):
                feedback["self_assessed"] = True
            if payload["mode"] == "matching":
                feedback["explanation"] = f"Ghép đúng {len(payload['pairs']) - len(wrong_pairs)}/{len(payload['pairs'])} cặp."
            combo_bonus = 0
            if correct and row["session_kind"] == "game":
                previous_results = connection.execute(
                    "SELECT a.is_correct FROM attempts a JOIN exercises e ON e.id=a.exercise_id "
                    "WHERE e.session_id=? ORDER BY a.id DESC LIMIT 5", (row["session_id"],),
                )
                for previous_result in previous_results:
                    if not previous_result["is_correct"]:
                        break
                    combo_bonus += 1
            feedback["combo_bonus"] = combo_bonus
            cursor = connection.execute(
                "INSERT INTO attempts(exercise_id,user_answer,is_correct,score,feedback_payload,submitted_at,"
                "response_ms,confidence,used_hint) VALUES(?,?,?,?,?,?,?,?,?)",
                (exercise_id, answer, int(correct), score, json_text(feedback), utc_now(),
                 min(max(response_ms, 0), 3_600_000), confidence, int(hint)),
            )
            connection.execute("UPDATE exercises SET status='answered' WHERE id=?", (exercise_id,))
            connection.execute("UPDATE sessions SET score=score+? WHERE id=?",
                               (score + combo_bonus, row["session_id"]))
            if not correct and (row["session_kind"] != "game" or game_mistakes):
                if payload["mode"] == "matching":
                    for pair, chosen in wrong_pairs:
                        source = dict(row)
                        source["card_id"] = pair["card_id"]
                        self._mistake(connection, source, {
                            "answers": [pair["right"]], "prompt": pair["left"],
                            "explanation": "Ghép cặp",
                        }, int(cursor.lastrowid), chosen, today, "meaning", intervals)
                else:
                    mistake_kind = ("confidence" if confidence == "sure" else
                                    "concept" if payload["deck_kind"] == "knowledge" else
                                    "spelling" if payload.get("question_style", payload["mode"]) == "fill_blank" else "meaning")
                    self._mistake(connection, row, payload, int(cursor.lastrowid), answer, today,
                                  mistake_kind, intervals)
            return feedback

    def record_ai_result(self, exercise_id: int, score: float, confidence: str = "",
                         response_ms: int = 0, today: date | None = None,
                         intervals: tuple[int, ...] = INTERVALS) -> dict:
        """Attach a graded AI answer to its Hub session exactly once."""
        with self.database.immediate() as connection:
            row = connection.execute(
                "SELECT e.*,s.deck_name,s.kind AS session_kind,s.deck_kind FROM exercises e "
                "JOIN sessions s ON s.id=e.session_id "
                "WHERE e.id=?", (exercise_id,),
            ).fetchone()
            attempt = connection.execute(
                "SELECT * FROM attempts WHERE exercise_id=? ORDER BY id DESC LIMIT 1", (exercise_id,),
            ).fetchone()
            if row is None or attempt is None:
                raise ValueError("Không tìm thấy lượt chấm bài.")
            feedback = json.loads(attempt["feedback_payload"])
            correct = score >= 8
            if not feedback.get("_hub_recorded"):
                feedback["_hub_recorded"] = True
                connection.execute(
                    "UPDATE attempts SET is_correct=?,response_ms=?,confidence=?,feedback_payload=? WHERE id=?",
                    (int(correct), max(0, min(response_ms, 3_600_000)), confidence,
                     json_text(feedback), attempt["id"]),
                )
                connection.execute("UPDATE sessions SET score=score+? WHERE id=?", (score, row["session_id"]))
                connection.execute(
                    "DELETE FROM mistakes WHERE attempt_id=? AND linked_anki_note_id IS NULL",
                    (attempt["id"],),
                )
                if not correct or feedback.get("errors"):
                    payload = json.loads(row["exercise_payload"])
                    error = (feedback.get("errors") or [{}])[0]
                    answer = error.get("original_text") or attempt["user_answer"]
                    corrected = error.get("corrected_text") or (payload.get("correct_answers") or [""])[0]
                    self._mistake(connection, row, {
                        "answers": [corrected], "prompt": row["prompt_shown"],
                        "explanation": error.get("explanation") or feedback.get("summary", ""),
                    }, int(attempt["id"]), answer, today or date.today(),
                                  "confidence" if confidence == "sure" else
                                  "concept" if row["deck_kind"] == "knowledge" else
                                  "spelling" if row["exercise_type"] == "fill_blank" else
                                  "meaning" if row["exercise_type"] in ("multiple_choice", "phrase") else "usage",
                                  intervals)
            feedback.pop("_hub_recorded", None)
            return {"correct": correct, "score": score, "feedback": feedback,
                    "attempt_id": int(attempt["id"]),
                    "answers": json.loads(row["exercise_payload"]).get("correct_answers", [])}

    def manual_ai_result(self, exercise_id: int, answer: str, confidence: str = "",
                         response_ms: int = 0, today: date | None = None,
                         intervals: tuple[int, ...] = INTERVALS,
                         self_score: int | None = None, reason: str = "") -> dict:
        with self.database.immediate() as connection:
            row = connection.execute(
                "SELECT e.*,s.deck_name,s.kind AS session_kind,s.deck_kind FROM exercises e "
                "JOIN sessions s ON s.id=e.session_id WHERE e.id=? AND e.provider!='local'",
                (exercise_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Không tìm thấy bài cần tự đối chiếu.")
            payload = json.loads(row["exercise_payload"])
            answers = payload.get("correct_answers") or payload.get("target_words_to_use") or ["Xem nội dung thẻ nguồn"]
            explanation = (payload.get("explanation") or "Hãy đối chiếu bài làm với nội dung thẻ và đề bài.")
            if self_score is None:
                return {"needs_self_check": True, "answers": answers,
                        "explanation": explanation, "reason": reason}
            if self_score not in (0, 5, 10):
                raise ValueError("Mức tự đối chiếu không hợp lệ.")
            previous = connection.execute(
                "SELECT * FROM attempts WHERE exercise_id=? ORDER BY id DESC LIMIT 1", (exercise_id,),
            ).fetchone()
            if previous:
                feedback = json.loads(previous["feedback_payload"])
                feedback.pop("_hub_recorded", None)
                return {"correct": bool(previous["is_correct"]), "score": previous["score"],
                        "answers": answers, "feedback": feedback,
                        "attempt_id": int(previous["id"])}
            correct = self_score == 10
            feedback = {"summary": "Người học tự đối chiếu sau khi AI không chấm được.",
                        "self_assessed": True, "reason": reason, "_hub_recorded": True}
            cursor = connection.execute(
                "INSERT INTO attempts(exercise_id,user_answer,is_correct,score,feedback_payload,"
                "submitted_at,response_ms,confidence) VALUES(?,?,?,?,?,?,?,?)",
                (exercise_id, answer, int(correct), self_score, json_text(feedback), utc_now(),
                 min(max(response_ms, 0), 3_600_000), confidence),
            )
            connection.execute("UPDATE exercises SET status='answered' WHERE id=?", (exercise_id,))
            connection.execute("UPDATE sessions SET score=score+? WHERE id=?", (self_score, row["session_id"]))
            if not correct:
                self._mistake(connection, row, {
                    "answers": answers, "prompt": row["prompt_shown"], "explanation": explanation,
                }, int(cursor.lastrowid), answer, today or date.today(),
                              "confidence" if confidence == "sure" else
                              "concept" if row["deck_kind"] == "knowledge" else "usage", intervals)
            return {"correct": correct, "score": self_score, "answers": answers,
                    "feedback": {key: value for key, value in feedback.items() if key != "_hub_recorded"},
                    "attempt_id": int(cursor.lastrowid)}

    @staticmethod
    def _mistake(connection, exercise, payload, attempt_id: int, answer: str, today: date,
                 kind: str, intervals: tuple[int, ...] = INTERVALS) -> None:
        deck = exercise["deck_name"]
        card_id = exercise["card_id"]
        source_key = str(card_id) if card_id else "exercise:" + str(exercise["id"])
        if exercise["session_kind"] == "game" and connection.execute(
            "SELECT 1 FROM mistakes m JOIN attempts a ON a.id=m.attempt_id "
            "JOIN exercises e ON e.id=a.exercise_id WHERE e.session_id=? AND m.deck_name=? "
            "AND m.source_key=? AND m.kind=? LIMIT 1",
            (exercise["session_id"], deck, source_key, kind),
        ).fetchone():
            return
        existing = connection.execute(
            "SELECT * FROM mistakes WHERE deck_name=? AND source_key=? AND kind=? AND mastered=0 "
            "ORDER BY id DESC LIMIT 1", (deck, source_key, kind),
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE mistakes SET attempt_id=?,wrong_count=wrong_count+1,review_level=0,due_date=?,"
                "original_text=?,corrected_text=?,prompt=?,last_seen_at=?,severity=? WHERE id=?",
                (attempt_id, (today + timedelta(days=intervals[0])).isoformat(), answer,
                 payload["answers"][0], payload["prompt"], utc_now(),
                 "major" if kind == "confidence" else existing["severity"], existing["id"]),
            )
        else:
            connection.execute(
                "INSERT INTO mistakes(attempt_id,mistake_type,original_text,corrected_text,explanation,severity,"
                "created_at,deck_name,source_card_id,kind,prompt,wrong_count,review_level,due_date,"
                "last_seen_at,source_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (attempt_id, "other", answer, payload["answers"][0], payload.get("explanation", ""),
                 "major" if kind == "confidence" else "minor", utc_now(), deck, card_id, kind,
                 payload["prompt"], 1, 0, (today + timedelta(days=intervals[0])).isoformat(),
                 utc_now(), source_key),
            )

    def mistakes(self, deck_name: str = "", due_only: bool = False, include_mastered: bool = False,
                 today: date | None = None, limit: int = 40, offset: int = 0,
                 kind: str = "", daily_limit: int = 0, day_start_utc: str = "",
                 state: str = "", min_wrong: int = 1, due_before: str = "",
                 include_children: bool = False, source_session_id: int = 0,
                 exclude_reviewed_session_id: int = 0) -> list[dict]:
        if (due_only or source_session_id) and daily_limit and self.review_count_since(day_start_utc) >= daily_limit:
            raise ValueError("Đã đạt giới hạn mục ôn Sổ lỗi hôm nay.")
        clauses, params = ["1=1"], []
        if source_session_id:
            clauses.append(
                "(EXISTS (SELECT 1 FROM attempts sa JOIN exercises se ON se.id=sa.exercise_id "
                "WHERE sa.id=m.attempt_id AND se.session_id=?) OR EXISTS (SELECT 1 FROM exercises re "
                "JOIN attempts ra ON ra.exercise_id=re.id WHERE re.session_id=? AND re.exercise_type='review' "
                "AND CAST(json_extract(re.exercise_payload,'$.mistake_id') AS INTEGER)=m.id))")
            params.extend((source_session_id, source_session_id))
        if exclude_reviewed_session_id:
            clauses.append(
                "NOT EXISTS (SELECT 1 FROM exercises re JOIN attempts ra ON ra.exercise_id=re.id "
                "WHERE re.session_id=? AND re.exercise_type='review' "
                "AND CAST(json_extract(re.exercise_payload,'$.mistake_id') AS INTEGER)=m.id)")
            params.append(exclude_reviewed_session_id)
        if deck_name:
            if include_children:
                clauses.append("(m.deck_name=? OR substr(m.deck_name,1,length(?)+2)=?||'::')")
                params.extend((deck_name, deck_name, deck_name))
            else:
                clauses.append("m.deck_name=?")
                params.append(deck_name)
        if kind:
            clauses.append("m.kind=?")
            params.append(kind)
        if state == "new":
            clauses.append("m.mastered=0 AND m.review_count=0")
        elif state == "reviewing":
            clauses.append("m.mastered=0 AND m.review_count>0")
        elif state == "mastered":
            clauses.append("m.mastered=1")
            include_mastered = True
        if min_wrong > 1:
            clauses.append("m.wrong_count>=?")
            params.append(min_wrong)
        if due_before:
            clauses.append("m.due_date<=? AND m.due_date!=''")
            params.append(due_before)
        if due_only:
            clauses.append("m.due_date<=? AND m.due_date!=''")
            params.append((today or date.today()).isoformat())
        if not include_mastered:
            clauses.append("m.mastered=0")
        query = (
            "SELECT m.id,m.deck_name,m.source_card_id,m.kind,m.prompt,m.original_text,"
            "m.corrected_text,m.explanation,m.wrong_count,m.review_level,m.review_count,m.due_date,m.mastered,"
            "m.correct_at_top,m.linked_anki_note_id,e.exercise_type,e.provider AS exercise_provider,"
            "e.exercise_payload,"
            "(SELECT li.audio_hash FROM listening_items li WHERE li.deck_name=m.deck_name "
            "AND li.sentence=m.corrected_text ORDER BY li.created_at DESC LIMIT 1) AS audio_hash "
            "FROM mistakes m "
            "JOIN attempts a ON a.id=m.attempt_id JOIN exercises e ON e.id=a.exercise_id "
            "WHERE " + " AND ".join(clauses) + " ORDER BY m.mastered,"
            "CASE m.kind WHEN 'confidence' THEN 0 ELSE 1 END,m.due_date,m.id DESC LIMIT ? OFFSET ?"
        )
        with closing(self.database.connect()) as connection, connection:
            result = []
            for row in connection.execute(query, (*params, limit, offset)):
                item = dict(row)
                payload = json.loads(item.pop("exercise_payload"))
                item["options"] = payload.get("options", [])
                item["review_self_check"] = self._requires_self_check(
                    item["exercise_type"], item["exercise_provider"], payload)
                result.append(item)
            return result

    def review(self, mistake_id: int, correct: bool, today: date | None = None,
               intervals: tuple[int, ...] = INTERVALS) -> dict:
        with self.database.immediate() as connection:
            row = connection.execute("SELECT * FROM mistakes WHERE id=?", (mistake_id,)).fetchone()
            if row is None:
                raise ValueError("Không tìm thấy lỗi cần ôn.")
            return self._advance_review(connection, row, correct, today or date.today(), intervals)

    @staticmethod
    def _advance_review(connection, row, correct: bool, today: date,
                        intervals: tuple[int, ...]) -> dict:
        level, due = schedule(row["review_level"], correct, today, intervals)
        top = row["correct_at_top"] + 1 if correct and row["review_level"] == len(intervals) - 1 else 0
        connection.execute(
            "UPDATE mistakes SET review_level=?,due_date=?,correct_at_top=?,"
            "wrong_count=wrong_count+?,review_count=review_count+1,last_reviewed_at=? WHERE id=?",
            (level, due, top, int(not correct), utc_now(), row["id"]),
        )
        return {"level": level, "due_date": due, "suggest_mastered": top >= 2}

    def review_question(self, deck_id: int, deck_name: str, deck_kind: str,
                        session_id: int = 0, *, today: date | None = None,
                        daily_limit: int = 0, day_start_utc: str = "",
                        include_children: bool = False,
                        source_session_id: int = 0) -> dict:
        rows = self.mistakes(deck_name, due_only=not bool(source_session_id), today=today, limit=1,
                             daily_limit=daily_limit, day_start_utc=day_start_utc,
                             include_children=include_children,
                             source_session_id=source_session_id,
                             exclude_reviewed_session_id=session_id if source_session_id else 0)
        if not rows:
            return {"session_id": session_id, "question": None}
        row = rows[0]
        if not session_id:
            session_id = self.start(deck_id, deck_name, deck_kind, "review")
        question = self.question(session_id, {
            "mode": "review", "prompt": row["prompt"], "answers": [row["corrected_text"]],
            "options": row["options"], "explanation": row["explanation"],
            "audio_hash": row["audio_hash"], "mistake_id": row["id"],
            "self_check": row["review_self_check"],
            "source_card_id": row["source_card_id"], "source_note_id": None,
            "deck_kind": deck_kind,
        })
        question["exercise_id"] = question["id"]
        question["id"] = row["id"]
        return {"session_id": session_id, "question": question}

    @staticmethod
    def _requires_self_check(exercise_type: str, provider: str, payload: dict) -> bool:
        return exercise_type in ("explain", "application") and (
            bool(payload.get("self_check")) or provider != "local")

    def review_answer(self, mistake_id: int, answer: str, today: date | None = None,
                      ignore_accents: bool = False, half_spelling: bool = True,
                      daily_limit: int = 0, day_start_utc: str = "",
                      intervals: tuple[int, ...] = INTERVALS,
                      self_score: int | None = None, exercise_id: int = 0,
                      response_ms: int = 0) -> dict:
        if daily_limit and self.review_count_since(day_start_utc) >= daily_limit:
            raise ValueError("Đã đạt giới hạn mục ôn Sổ lỗi hôm nay.")
        with closing(self.database.connect()) as connection:
            row = connection.execute(
                "SELECT m.*,e.exercise_type,e.provider AS exercise_provider,e.exercise_payload "
                "FROM mistakes m JOIN attempts a ON a.id=m.attempt_id "
                "JOIN exercises e ON e.id=a.exercise_id WHERE m.id=?", (mistake_id,),
            ).fetchone()
        if row is None or row["mastered"]:
            raise ValueError("Không tìm thấy lỗi đang ôn.")
        original = json.loads(row["exercise_payload"])
        self_check = self._requires_self_check(row["exercise_type"], row["exercise_provider"], original)
        if self_score is not None and (not self_check or self_score not in (0, 5, 10)):
            raise ValueError("Mức tự đối chiếu không hợp lệ.")
        if row["kind"] == "listening":
            graded = listening_grade(row["corrected_text"], answer, half_spelling=half_spelling)
            correct = graded["accuracy"] == 1
            score = round(10 * graded["accuracy"], 1)
        else:
            graded = {}
            if self_check and self_score is None:
                return {"needs_self_check": True, "answers": [row["corrected_text"]],
                        "explanation": row["explanation"]}
            if self_score is not None:
                correct = self_score == 10
            elif original.get("numeric_tolerance") is not None:
                try:
                    entered = float(answer.strip().replace(",", "."))
                    expected = float(row["corrected_text"].strip().replace(",", "."))
                    correct = abs(entered - expected) <= original["numeric_tolerance"]
                except ValueError:
                    correct = False
            else:
                correct = local_grade(answer, [row["corrected_text"]], ignore_accents=ignore_accents)
            score = self_score if self_score is not None else 10 if correct else 0
        with self.database.immediate() as connection:
            live = connection.execute("SELECT * FROM mistakes WHERE id=?", (mistake_id,)).fetchone()
            if live is None or live["mastered"]:
                raise ValueError("Không tìm thấy lỗi đang ôn.")
            if exercise_id:
                exercise = connection.execute(
                    "SELECT e.exercise_payload,e.session_id,e.status FROM exercises e "
                    "WHERE e.id=? AND e.exercise_type='review'", (exercise_id,),
                ).fetchone()
                if exercise is None or json.loads(exercise["exercise_payload"]).get("mistake_id") != mistake_id:
                    raise ValueError("Câu ôn lỗi không khớp với phiên.")
                previous = connection.execute(
                    "SELECT feedback_payload FROM attempts WHERE exercise_id=? LIMIT 1", (exercise_id,),
                ).fetchone()
                if previous:
                    return json.loads(previous["feedback_payload"])
            schedule_result = self._advance_review(connection, live, correct, today or date.today(), intervals)
            if exercise_id:
                feedback = {"correct": correct, "score": score,
                            "answers": [row["corrected_text"]], **graded, **schedule_result}
                connection.execute(
                    "INSERT INTO attempts(exercise_id,user_answer,is_correct,score,feedback_payload,"
                    "submitted_at,response_ms) VALUES(?,?,?,?,?,?,?)",
                    (exercise_id, answer, int(correct), score, json_text(feedback), utc_now(),
                     min(max(response_ms, 0), 3_600_000)),
                )
                connection.execute("UPDATE exercises SET status='answered' WHERE id=?", (exercise_id,))
                connection.execute("UPDATE sessions SET score=score+? WHERE id=?",
                                   (score, exercise["session_id"]))
        return {"correct": correct, "score": score, "answers": [row["corrected_text"]],
                **graded, **schedule_result}

    def review_count_since(self, start_utc: str) -> int:
        if not start_utc:
            return 0
        with closing(self.database.connect()) as connection:
            return int(connection.execute(
                "SELECT COUNT(*) FROM mistakes WHERE last_reviewed_at>=?", (start_utc,),
            ).fetchone()[0])

    def summary(self, session_id: int) -> dict:
        with closing(self.database.connect()) as connection, connection:
            session = connection.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            if session is None:
                raise ValueError("Không tìm thấy phiên luyện.")
            rows = connection.execute(
                "SELECT COUNT(*) AS count,SUM(a.is_correct) AS correct,SUM(a.response_ms) AS duration "
                "FROM attempts a JOIN exercises e ON e.id=a.exercise_id WHERE e.session_id=?", (session_id,)
            ).fetchone()
            errors = connection.execute(
                "SELECT COUNT(*) FROM mistakes m JOIN attempts a ON a.id=m.attempt_id "
                "JOIN exercises e ON e.id=a.exercise_id WHERE e.session_id=?", (session_id,)
            ).fetchone()[0]
            if session["mode"] == "review":
                errors = rows["count"] - (rows["correct"] or 0)
            return {"count": rows["count"], "correct": rows["correct"] or 0, "duration_ms": rows["duration"] or 0,
                    "mistakes": errors, "score": session["score"], "mode": session["mode"]}

    def finish(self, session_id: int) -> dict:
        self.database.end_session(session_id)
        return self.summary(session_id)

    def highscore(self, deck_name: str, game: str, score: int) -> int:
        with closing(self.database.connect()) as connection, connection:
            connection.execute(
                "INSERT INTO highscores(deck_name,game,score,achieved_at) VALUES(?,?,?,?) "
                "ON CONFLICT(deck_name,game) DO UPDATE SET score=excluded.score,achieved_at=excluded.achieved_at "
                "WHERE excluded.score>highscores.score", (deck_name, game, score, utc_now()),
            )
            row = connection.execute("SELECT score FROM highscores WHERE deck_name=? AND game=?",
                                     (deck_name, game)).fetchone()
            return row[0]

    def highscores(self, deck_name: str) -> dict[str, int]:
        with closing(self.database.connect()) as connection, connection:
            return {row["game"]: row["score"] for row in connection.execute(
                "SELECT game,score FROM highscores WHERE deck_name=?", (deck_name,))}

    def knowledge_progress(self, deck_name: str) -> dict[str, Any]:
        levels = {"remember": {"count": 0, "correct": 0},
                  "understand": {"count": 0, "correct": 0},
                  "apply": {"count": 0, "correct": 0}}
        with closing(self.database.connect()) as connection:
            rows = connection.execute(
                "SELECT e.exercise_type,COUNT(*) AS count,SUM(COALESCE(a.is_correct,0)) AS correct "
                "FROM attempts a JOIN exercises e ON e.id=a.exercise_id "
                "JOIN sessions s ON s.id=e.session_id WHERE s.deck_name=? AND s.deck_kind='knowledge' "
                "AND e.exercise_type IN ('recall','multiple_choice','quick','explain','application') "
                "GROUP BY e.exercise_type", (deck_name,),
            )
            for row in rows:
                level = ("understand" if row["exercise_type"] == "explain" else
                         "apply" if row["exercise_type"] == "application" else "remember")
                levels[level]["count"] += row["count"]
                levels[level]["correct"] += row["correct"] or 0
            confidence = {"sure": {"count": 0, "wrong": 0},
                          "unsure": {"count": 0, "wrong": 0},
                          "guess": {"count": 0, "wrong": 0}}
            for row in connection.execute(
                "SELECT a.confidence,COUNT(*) AS count,SUM(CASE WHEN a.is_correct=0 THEN 1 ELSE 0 END) AS wrong "
                "FROM attempts a JOIN exercises e ON e.id=a.exercise_id "
                "JOIN sessions s ON s.id=e.session_id WHERE s.deck_name=? AND s.deck_kind='knowledge' "
                "AND e.exercise_type IN ('recall','multiple_choice','quick','explain','application') "
                "AND a.confidence IN ('sure','unsure','guess') GROUP BY a.confidence", (deck_name,),
            ):
                confidence[row["confidence"]] = {"count": row["count"], "wrong": row["wrong"] or 0}
            levels["confidence"] = confidence
        return levels

    def override(self, attempt_id: int, score: float, reason: str) -> None:
        if not 0 <= score <= 10 or len(reason) > 1000:
            raise ValueError("Điểm hoặc ghi chú không hợp lệ.")
        with self.database.immediate() as connection:
            attempt = connection.execute(
                "SELECT a.score,e.session_id FROM attempts a JOIN exercises e ON e.id=a.exercise_id "
                "WHERE a.id=?", (attempt_id,),
            ).fetchone()
            if attempt is None:
                raise ValueError("Không tìm thấy lượt trả lời.")
            connection.execute(
                "INSERT INTO overrides(attempt_id,original_score,revised_score,reason,created_at) "
                "VALUES(?,?,?,?,?)", (attempt_id, attempt["score"], score, reason, utc_now()),
            )
            connection.execute("UPDATE attempts SET score=? WHERE id=?", (score, attempt_id))
            connection.execute("UPDATE sessions SET score=score+? WHERE id=?",
                               (score - (attempt["score"] or 0), attempt["session_id"]))
            connection.execute("UPDATE attempts SET is_correct=? WHERE id=?", (int(score >= 8), attempt_id))
            if score >= 8:
                connection.execute("UPDATE mistakes SET mastered=1 WHERE attempt_id=?", (attempt_id,))

    def listening_item(self, deck_name: str, sentence: str, translation: str, targets: list[str],
                       level: str, voice: str, speed: str, audio_hash: str) -> int:
        with closing(self.database.connect()) as connection, connection:
            connection.execute(
                "INSERT INTO listening_items(deck_name,sentence,translation,targets,level,word_count,"
                "voice,speed,audio_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(deck_name,sentence,voice,speed) DO NOTHING",
                (deck_name, sentence, translation, json_text(targets), level, len(sentence.split()),
                 voice, speed, audio_hash, utc_now()),
            )
            return connection.execute(
                "SELECT id FROM listening_items WHERE deck_name=? AND sentence=? AND voice=? AND speed=?",
                (deck_name, sentence, voice, speed),
            ).fetchone()[0]

    def pending_listening(self, deck_name: str, session_id: int = 0,
                          difficulty: str = DEFAULT_LISTENING_DIFFICULTY) -> dict | None:
        with closing(self.database.connect()) as connection:
            row = connection.execute(
                "SELECT e.id,e.session_id,e.exercise_payload FROM exercises e "
                "JOIN sessions s ON s.id=e.session_id WHERE s.deck_name=? "
                "AND (?=0 OR e.session_id=?) "
                "AND e.exercise_type='listening' AND e.provider!='local' AND e.status='generated' "
                "AND COALESCE(json_extract(e.source_context, '$.listening_difficulty'), ?) = ? "
                "ORDER BY e.id ASC LIMIT 1",
                (deck_name, session_id, session_id, DEFAULT_LISTENING_DIFFICULTY, difficulty),
            ).fetchone()
            return dict(row) if row else None

    def listening_queue_state(self, session_id: int) -> tuple[bool, int]:
        with closing(self.database.connect()) as connection:
            row = connection.execute(
                "SELECT s.ended_at,COUNT(e.id) AS waiting FROM sessions s "
                "LEFT JOIN exercises e ON e.session_id=s.id AND e.exercise_type='listening' "
                "AND e.status='generated' WHERE s.id=? GROUP BY s.id", (session_id,),
            ).fetchone()
            return (row["ended_at"] is None, row["waiting"]) if row else (False, 0)

    def skip_exercise(self, exercise_id: int) -> None:
        with closing(self.database.connect()) as connection, connection:
            connection.execute("UPDATE exercises SET status='skipped' WHERE id=? AND status='generated'",
                               (exercise_id,))

    def listening_items(self, deck_name: str = "") -> list[dict]:
        with closing(self.database.connect()) as connection, connection:
            rows = connection.execute(
                "SELECT * FROM listening_items WHERE (?='' OR deck_name=?) "
                "ORDER BY pinned DESC,created_at DESC LIMIT 200", (deck_name, deck_name),
            )
            return [dict(row) for row in rows]

    def listening_result(self, item_id: int, accuracy: float) -> None:
        with closing(self.database.connect()) as connection, connection:
            connection.execute(
                "UPDATE listening_items SET attempts=attempts+1,best_accuracy=MAX(best_accuracy,?),"
                "last_accuracy=? WHERE id=?", (accuracy, accuracy, item_id),
            )

    def listening_attempt(self, exercise_id: int, answer: str, feedback: dict,
                          today: date | None = None,
                          intervals: tuple[int, ...] = INTERVALS,
                          response_ms: int = 0, hint: bool = False, item_id: int = 0) -> dict:
        with self.database.immediate() as connection:
            exercise = connection.execute(
                "SELECT e.*,s.deck_name,s.kind AS session_kind FROM exercises e "
                "JOIN sessions s ON s.id=e.session_id WHERE e.id=?", (exercise_id,),
            ).fetchone()
            if exercise is None:
                raise ValueError("Không tìm thấy câu nghe trong phiên.")
            payload = json.loads(exercise["exercise_payload"])
            expected = payload.get("question_prompt") or (payload.get("answers") or [""])[0]
            if expected != feedback["sentence"]:
                raise ValueError("Câu nghe không khớp với lượt chép.")
            if connection.execute("SELECT 1 FROM attempts WHERE exercise_id=?", (exercise_id,)).fetchone():
                return feedback
            correct = feedback["accuracy"] == 1
            cursor = connection.execute(
                "INSERT INTO attempts(exercise_id,user_answer,is_correct,score,feedback_payload,submitted_at,"
                "response_ms,used_hint) VALUES(?,?,?,?,?,?,?,?)",
                (exercise_id, answer, int(correct), feedback["score"], json_text(feedback), utc_now(),
                 min(max(response_ms, 0), 3_600_000), int(hint)),
            )
            connection.execute("UPDATE exercises SET status='answered' WHERE id=?", (exercise_id,))
            connection.execute("UPDATE sessions SET score=score+? WHERE id=?",
                               (feedback["score"], exercise["session_id"]))
            if item_id:
                updated = connection.execute(
                    "UPDATE listening_items SET attempts=attempts+1,best_accuracy=MAX(best_accuracy,?),"
                    "last_accuracy=? WHERE id=? AND sentence=? AND deck_name=?",
                    (feedback["accuracy"], feedback["accuracy"], item_id, feedback["sentence"],
                     exercise["deck_name"]),
                )
                if updated.rowcount != 1:
                    raise ValueError("Câu nghe không thuộc bộ thẻ của phiên.")
            if not correct:
                self._mistake(connection, exercise, {
                    "answers": [feedback["sentence"]], "prompt": "Nghe và chép lại câu",
                    "explanation": "Đối chiếu từng từ với câu đã nghe.",
                }, int(cursor.lastrowid), answer, today or date.today(), "listening", intervals)
            return feedback

    def replay_listening(self, item_id: int) -> dict:
        with closing(self.database.connect()) as connection:
            item = connection.execute("SELECT * FROM listening_items WHERE id=?", (item_id,)).fetchone()
        if item is None:
            raise ValueError("Không tìm thấy câu nghe.")
        session_id = self.start(0, item["deck_name"], "language", "listening")
        question = self.question(session_id, {
            "mode": "listening", "prompt": "Nghe và chép lại câu", "answers": [item["sentence"]],
            "options": [], "explanation": "", "audio_hash": item["audio_hash"],
            "hint_initials": " ".join(word[:1] + "…" for word in item["sentence"].split()),
            "hint_translation": item["translation"],
            "deck_kind": "language", "source_card_id": None, "source_note_id": None,
        })
        question.pop("answers")
        return {"session_id": session_id, "item_id": item_id, "question": question}

    def pin_listening(self, item_id: int, pinned: bool) -> None:
        with closing(self.database.connect()) as connection, connection:
            connection.execute("UPDATE listening_items SET pinned=? WHERE id=?", (int(pinned), item_id))

    def delete_listening(self, item_id: int, directory: Path) -> None:
        with self.database.immediate() as connection:
            row = connection.execute("SELECT audio_hash FROM listening_items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                return
            connection.execute("DELETE FROM listening_items WHERE id=?", (item_id,))
            digest = row["audio_hash"]
            if connection.execute("SELECT 1 FROM listening_items WHERE audio_hash=? LIMIT 1", (digest,)).fetchone():
                return
            connection.execute("DELETE FROM audio_cache WHERE hash=?", (digest,))
        (directory / f"{digest}.mp3").unlink(missing_ok=True)

    def tts_usage(self) -> int:
        month = datetime.now().astimezone().strftime("%Y-%m")
        with closing(self.database.connect()) as connection, connection:
            row = connection.execute("SELECT chars FROM tts_usage WHERE month=?", (month,)).fetchone()
            return row[0] if row else 0
