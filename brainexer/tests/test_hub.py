from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import pytest

from brainexer.audio import cached_audio, cleanup_audio
from brainexer.core.answering import answer_is_correct
from brainexer.core.field_mapper import map_fields
from brainexer.core.hub import calculation_question, listening_grade, local_question, schedule
from brainexer.core.models import CardSource
from brainexer.db.connection import Database, validate_database
from brainexer.hub_store import HubStore


def sources():
    result = []
    for index, (front, back) in enumerate(
        [("synthesis", "quang hợp"), ("mitosis", "nguyên phân"),
         ("osmosis", "thẩm thấu"), ("gravity", "trọng lực")], 1
    ):
        target, context, pos, fields = map_fields({"Khái niệm": front, "Nghĩa riêng": back})
        result.append(CardSource(index, index, 1, target, context, pos, fields))
    return result


def test_local_matching_and_game_mistakes_are_profile_only(tmp_path):
    path = tmp_path / "brainexer.sqlite3"
    store = HubStore(path)
    store.set_deck_kind("Science", "knowledge")
    store.set_field_roles("Science", "knowledge", "Khái niệm", "Nghĩa riêng")
    assert store.field_roles("Science::Chapter") == {
        "question_field": "Khái niệm", "answer_field": "Nghĩa riêng"}
    question = local_question("matching", sources(), "knowledge")
    session = store.start(1, "Science", "knowledge", "matching", "game")
    item = store.question(session, question)
    chosen = [pair["right"] for pair in question["pairs"]]
    chosen[0] = "wrong"
    result = store.answer(item["id"], json.dumps(chosen), today=date(2026, 11, 22))
    assert result["score"] == 7.5
    assert not result["correct"]
    assert store.summary(session)["count"] == 1
    assert len(store.mistakes("Science")) == 1
    assert store.mistakes("Science", due_only=True, today=date(2026, 11, 22)) == []
    assert len(store.mistakes("Science", due_only=True, today=date(2026, 11, 23))) == 1
    assert validate_database(path)["mistakes"] == 1


def test_review_schedule_and_listening_alignment(tmp_path):
    assert schedule(0, True, date(2026, 11, 22)) == (1, "2026-11-25")
    assert schedule(4, False, date(2026, 11, 22)) == (0, "2026-11-23")
    assert listening_grade("Hello, world!", "hello world")["accuracy"] == 1
    missing = listening_grade("Hello there world", "hello world")
    assert any(part["kind"] == "missing" for part in missing["alignment"])
    extra = listening_grade("Hello world", "hello there world")
    assert any(part["kind"] == "extra" for part in extra["alignment"])
    typo = listening_grade("Hello world", "Helo world")
    assert typo["accuracy"] == .75
    assert listening_grade("你好世界", "你好世")["accuracy"] == .75
    assert listening_grade("Học tập", "học tập")["accuracy"] == 1
    assert answer_is_correct("hoc tap", ["học tập"], ignore_accents=True)
    assert not answer_is_correct("hoc tap", ["học tập"])


def test_cached_audio_is_reused_and_listening_replay_is_scored(tmp_path, monkeypatch):
    database = Database(tmp_path / "brainexer.sqlite3")
    calls = []
    monkeypatch.setattr("brainexer.audio.synthesize", lambda *args: calls.append(args) or b"ID3abc")
    directory = tmp_path / "brainexer_audio"
    digest = cached_audio(database, directory, "Hello world", "en-US-JennyNeural", "1",
                          "southeastasia", "key", 100)
    again = cached_audio(database, directory, "Hello world", "en-US-JennyNeural", "1",
                         "southeastasia", "key", 100)
    assert digest == again and len(calls) == 1
    store = HubStore(database.path)
    item = store.listening_item("English", "Hello world", "Xin chào", ["Hello"],
                                "A1", "en-US-JennyNeural", "1", digest)
    replay = store.replay_listening(item)
    feedback = listening_grade("Hello world", "hello")
    feedback.update(sentence="Hello world", score=5)
    store.listening_result(item, feedback["accuracy"])
    store.listening_attempt(replay["question"]["id"], "hello", feedback, date(2026, 11, 22))
    assert store.summary(replay["session_id"])["count"] == 1
    assert store.mistakes("English")[0]["kind"] == "listening"
    assert store.listening_items("English")[0]["attempts"] == 1
    assert validate_database(database.path)["mistakes"] == 1


def test_calculation_uses_saved_numeric_answer_or_manual_comparison(tmp_path):
    store = HubStore(tmp_path / "math.sqlite3")
    numeric = CardSource(1, 1, 1, "2 + 2 = ?", "Bốn", "",
                         {"Front": "2 + 2 = ?", "Lời giải": "Cộng hai số hai.",
                          "Đáp án cuối": "4", "Dung sai": "0.1"})
    payload = calculation_question([numeric])
    assert payload["numeric_tolerance"] == .1 and not payload["self_check"]
    session = store.start(1, "Math", "knowledge", "application")
    item = store.question(session, payload)
    assert store.answer(item["id"], "4.05")["correct"]
    reasoning = CardSource(2, 2, 1, "Giải thích chứng minh", "Dựa vào định lý", "",
                           {"Front": "Giải thích chứng minh", "Lời giải": "Dựa vào định lý"})
    payload = calculation_question([reasoning])
    item = store.question(session, payload)
    assert store.answer(item["id"], "Bài làm của tôi")["needs_self_check"]
    partial = store.answer(item["id"], "Bài làm của tôi", self_score=5)
    assert partial["score"] == 5 and partial["self_assessed"]
    assert store.summary(session)["count"] == 2
    unnamed = CardSource(3, 3, 1, "2 + 2 = ?", "4", "", {"Prompt": "2 + 2 = ?", "Result": "4"})
    assert calculation_question([unnamed])["answers"] == ["4"]
    assert calculation_question([unnamed])["self_check"] is False


def test_ai_objective_result_is_counted_once_and_uses_one_ledger_entry(tmp_path):
    store = HubStore(tmp_path / "ai.sqlite3")
    session = store.start(1, "English", "language", "multiple_choice")
    exercise = store.database.insert_exercise(
        session, "multiple_choice", "Chọn nghĩa", {},
        {"question_prompt": "Chọn nghĩa", "correct_answers": ["A"]},
        "openai", "fake", "test", "", card_id=5,
    )
    store.database.insert_attempt(exercise, "B", {"summary": "Sai nghĩa"},
                                  is_correct=False, score=5, mistakes=[{
                                      "mistake_type": "other", "original_text": "B",
                                      "corrected_text": "A", "explanation": "Sai nghĩa",
                                  }])
    first = store.record_ai_result(exercise, 5, today=date(2026, 11, 22))
    second = store.record_ai_result(exercise, 5, today=date(2026, 11, 22))
    assert first["score"] == second["score"] == store.summary(session)["score"] == 5
    assert len(store.mistakes("English")) == 1


def test_quick_alternates_choices_and_fill_when_examples_exist():
    cards = [CardSource(card.card_id, card.note_id, card.deck_id, card.target,
                        card.context, card.part_of_speech,
                        {**card.fields, "Example": f"We study {card.target} today."})
             for card in sources()]
    first = local_question("quick", cards, "language", 0)
    second = local_question("quick", cards, "language", 1)
    assert first["question_style"] == "multiple_choice" and len(first["options"]) == 4
    assert second["question_style"] == "fill_blank" and "___" in second["prompt"]


def test_review_session_records_attempt_and_summary(tmp_path):
    store = HubStore(tmp_path / "review.sqlite3")
    session = store.start(1, "Science", "knowledge", "recall")
    item = store.question(session, local_question("recall", sources(), "knowledge"))
    store.answer(item["id"], "wrong", confidence="sure", today=date(2026, 11, 22))
    assert store.knowledge_progress("Science")["confidence"]["sure"] == {"count": 1, "wrong": 1}
    due = store.review_question(1, "Science", "knowledge", today=date(2026, 11, 23))
    question = due["question"]
    assert question["exercise_id"] != question["id"]
    feedback = store.review_answer(question["id"], question["answers"][0],
                                   date(2026, 11, 23),
                                   exercise_id=question["exercise_id"])
    assert feedback["correct"]
    assert store.summary(due["session_id"])["count"] == 1
    assert store.review_question(1, "Science", "knowledge", due["session_id"],
                                 today=date(2026, 11, 23))["question"] is None


def test_listening_prefers_cards_from_the_mistake_ledger(tmp_path):
    store = HubStore(tmp_path / "priority.sqlite3")
    session = store.start(1, "English", "language", "multiple_choice")
    question = local_question("multiple_choice", sources(), "language")
    item = store.question(session, question)
    store.answer(item["id"], "wrong", today=date(2026, 11, 22))
    assert store.listening_priority("English") == [question["source_card_id"]]
    assert store.listening_priority("Other") == []


def test_parent_deck_can_review_child_mistakes(tmp_path):
    store = HubStore(tmp_path / "children.sqlite3")
    session = store.start(2, "Science::Chapter", "knowledge", "recall")
    item = store.question(session, local_question("recall", sources(), "knowledge"))
    store.answer(item["id"], "wrong", today=date(2026, 11, 22))
    assert store.review_question(1, "Science", "knowledge", today=date(2026, 11, 23))["question"] is None
    assert store.review_question(1, "Science", "knowledge", today=date(2026, 11, 23),
                                 include_children=True)["question"]["id"] > 0


def test_game_combo_is_saved_in_session_score(tmp_path):
    store = HubStore(tmp_path / "combo.sqlite3")
    session = store.start(1, "English", "language", "word_hunter", "game")
    for expected_bonus in (0, 1, 2):
        item = store.question(session, local_question("word_hunter", sources(), "language"))
        result = store.answer(item["id"], item["answers"][0])
        assert result["combo_bonus"] == expected_bonus
    assert store.summary(session)["score"] == 33


def test_retry_wrong_answers_immediately_without_waiting_for_due_date(tmp_path):
    store = HubStore(tmp_path / "retry.sqlite3")
    practice = store.start(1, "Science", "knowledge", "recall")
    item = store.question(practice, local_question("recall", sources(), "knowledge"))
    store.answer(item["id"], "wrong", today=date(2026, 11, 22))
    store.finish(practice)
    assert store.mistakes("Science", due_only=True, today=date(2026, 11, 22)) == []
    retry = store.review_question(1, "Science", "knowledge", today=date(2026, 11, 22),
                                  source_session_id=practice)
    assert retry["question"] is not None
    question = retry["question"]
    store.review_answer(question["id"], question["answers"][0], date(2026, 11, 22),
                        exercise_id=question["exercise_id"])
    assert store.review_question(1, "Science", "knowledge", retry["session_id"],
                                 today=date(2026, 11, 22),
                                 source_session_id=practice)["question"] is None


def test_audio_cleanup_keeps_pinned_sentences(tmp_path, monkeypatch):
    database = Database(tmp_path / "audio.sqlite3")
    monkeypatch.setattr("brainexer.audio.synthesize", lambda *args: b"ID3abc")
    directory = tmp_path / "brainexer_audio"
    store = HubStore(database.path)
    for sentence, pinned in [("Pinned sentence", True), ("Old sentence", False)]:
        digest = cached_audio(database, directory, sentence, "en-US-JennyNeural", "1",
                              "southeastasia", "key", 100)
        item = store.listening_item("English", sentence, "", [], "A1",
                                    "en-US-JennyNeural", "1", digest)
        store.pin_listening(item, pinned)
    result = cleanup_audio(database, directory, 0)
    assert result["removed"] == 1
    assert [item["sentence"] for item in store.listening_items()] == ["Pinned sentence"]


def test_slow_then_normal_speech_counts_both_readings(tmp_path, monkeypatch):
    database = Database(tmp_path / "quota.sqlite3")
    calls = []
    monkeypatch.setattr("brainexer.audio.synthesize", lambda *args: calls.append(1) or b"ID3abc")
    with pytest.raises(ValueError, match="giới hạn"):
        cached_audio(database, tmp_path / "brainexer_audio", "Hello", "en-US-JennyNeural",
                     "slow-normal", "southeastasia", "key", 9)
    assert calls == []


def test_parallel_requests_for_same_audio_only_call_azure_once(tmp_path, monkeypatch):
    database = Database(tmp_path / "parallel.sqlite3")
    calls = []
    monkeypatch.setattr("brainexer.audio.synthesize", lambda *args: calls.append(1) or b"ID3abc")
    directory = tmp_path / "brainexer_audio"
    def request():
        return cached_audio(database, directory, "Same sentence", "en-US-JennyNeural", "1",
                            "southeastasia", "key", 100)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: request(), range(2)))
    assert results[0] == results[1]
    assert len(calls) == 1


def test_failed_ai_grading_can_be_scored_by_learner_once(tmp_path):
    store = HubStore(tmp_path / "manual.sqlite3")
    session = store.start(1, "Science", "knowledge", "explain")
    exercise = store.database.insert_exercise(
        session, "explain", "Explain gravity", {},
        {"question_prompt": "Explain gravity", "correct_answers": ["Attraction"],
         "explanation": "Objects attract one another."},
        "openai", "fake", "test", "", card_id=7,
    )
    requested = store.manual_ai_result(exercise, "My explanation", reason="AI unavailable")
    assert requested["needs_self_check"] and requested["answers"] == ["Attraction"]
    graded = store.manual_ai_result(exercise, "My explanation", self_score=5,
                                     today=date(2026, 11, 22))
    repeated = store.manual_ai_result(exercise, "My explanation", self_score=5,
                                       today=date(2026, 11, 22))
    assert graded["score"] == repeated["score"] == store.summary(session)["score"] == 5
    assert store.summary(session)["count"] == 1
    assert len(store.mistakes("Science")) == 1
    review = store.review_question(1, "Science", "knowledge", today=date(2026, 11, 23))
    assert store.review_answer(review["question"]["id"], "Revised explanation",
                               date(2026, 11, 23),
                               exercise_id=review["question"]["exercise_id"])["needs_self_check"]
