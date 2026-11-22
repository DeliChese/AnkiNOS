"""Run dashboard BrainExer requests on the appropriate Anki executor."""

from __future__ import annotations

from typing import Any, Callable
from datetime import date, datetime, timedelta, timezone

from aqt import mw
from aqt.operations import CollectionOp, QueryOp

from .brainexer.core.exceptions import BrainExerError
from .brainexer.core.hub import LOCAL_MODES, MODE_DECK_KIND
from .brainexer.hub_store import HubStore
from .brainexer_api import BrainExer, EXERCISES, PROVIDERS, clean_config, error_message, positive_id

_pending: set[str] = set()
_listening_prefetch: set[str] = set()


def anki_today() -> date:
    """Use Anki's next rollover as the boundary for the Hub's separate calendar."""
    try:
        return datetime.fromtimestamp(int(mw.col.sched.day_cutoff)).date() - timedelta(days=1)
    except (AttributeError, TypeError, ValueError):
        return date.today()


def anki_day_start_utc() -> str:
    try:
        cutoff = int(mw.col.sched.day_cutoff) - 86400
        return datetime.fromtimestamp(cutoff, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (AttributeError, TypeError, ValueError):
        local_start = datetime.combine(date.today(), datetime.min.time()).astimezone()
        return local_start.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def busy(profile: str) -> bool:
    return profile in _pending or profile in _listening_prefetch


def handle(
    command: dict, profile: str, config: dict, save: Callable[[dict], None],
    current: Callable[[], bool], reply: Callable[[dict], None], backup_busy: bool,
) -> None:
    request_id = command.get("request_id")
    if type(request_id) is not int or not 0 < request_id < 2**31:
        return
    method = command.get("method")

    def respond(data: Any = None, error: str = "") -> None:
        if current():
            reply({"request_id": request_id, "data": data, "error": error})

    if method == "hub_session_end":
        try:
            session_id = positive_id(command.get("session_id"))
            path = BrainExer(profile, config).path
            def ended(future: Any) -> None:
                try:
                    respond(future.result())
                except Exception as error:
                    respond(error=error_message(error))
            mw.taskman.run_in_background(lambda: HubStore(path).finish(session_id), ended,
                                         uses_collection=False)
        except Exception as error:
            respond(error=error_message(error))
        return

    if backup_busy or profile in _pending:
        respond(error="Đang xử lý một yêu cầu. Hãy thử lại sau khi hoàn tất.")
        return
    _pending.add(profile)

    def success(data: Any = None, error: str = "") -> None:
        _pending.discard(profile)
        respond(data, error)

    def failure(error: Exception) -> None:
        _pending.discard(profile)
        respond(error=error_message(error))

    def background(task: Callable, done: Callable = success) -> None:
        def finished(future: Any) -> None:
            try:
                done(future.result())
            except Exception as error:
                failure(error)
        mw.taskman.run_in_background(task, finished, uses_collection=False)

    def query(task: Callable, done: Callable = success) -> None:
        QueryOp(parent=mw, op=task, success=done).failure(failure).run_in_background()

    def exercise_job(api: BrainExer, result_key: str, task: Callable) -> None:
        def run() -> tuple[dict, str]:
            try:
                result = task()
            except BrainExerError as error:
                return {"usage": api.usage()}, error_message(error)
            return {result_key: result, "usage": api.usage()}, ""

        background(run, lambda result: success(*result))

    try:
        api = BrainExer(profile, config)
        if method == "status":
            background(api.status)
        elif method == "decks":
            query(api.decks)
        elif method == "deck_kind":
            name = command.get("deck_name")
            kind = command.get("kind")
            if not isinstance(name, str) or not 0 < len(name) <= 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            background(lambda: api.hub_kind(name, kind))
        elif method == "hub_fields":
            deck_id = positive_id(command.get("deck_id"))
            query(lambda col: api.hub_field_names(col, deck_id,
                                                  command.get("include_children") is True))
        elif method == "hub_set_fields":
            name = command.get("deck_name")
            kind = command.get("kind")
            question = command.get("question_field")
            answer = command.get("answer_field")
            if not isinstance(name, str) or not 0 < len(name) <= 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            background(lambda: api.hub_set_fields(name, kind, question, answer))
        elif method == "hub_next":
            mode = command.get("mode")
            if mode not in MODE_DECK_KIND:
                raise ValueError("Dạng bài không hợp lệ.")
            deck_id = positive_id(command.get("deck_id"))
            kind = command.get("kind")
            session_id = positive_id(command["session_id"]) if command.get("session_id") else 0
            raw_card_ids = command.get("card_ids", []) if mode == "listening_reflex" else []
            if not isinstance(raw_card_ids, list) or len(raw_card_ids) > 12:
                raise ValueError("Nguồn âm thanh game không hợp lệ.")
            preferred_card_ids = [positive_id(value) for value in raw_card_ids]

            def prepared(sources: tuple) -> None:
                if not current():
                    success()
                    return

                def generate() -> dict:
                    if mode in LOCAL_MODES:
                        result = api.hub_next(sources, mode, kind, session_id,
                                              command.get("voice", ""))
                    else:
                        result = api.hub_ai_next(sources, mode, kind, session_id)
                    result["question"].pop("answers", None)
                    if mode == "matching":
                        result["question"]["pairs"] = [
                            {"left": pair["left"]} for pair in result["question"]["pairs"]]
                    return result

                background(generate)

            query(lambda col: api.prepare(col, deck_id, command.get("include_children") is True,
                                          mode, preferred_card_ids), prepared)
        elif method == "hub_reflex_prepare":
            deck_id = positive_id(command.get("deck_id"))
            voice = command.get("voice")
            query(lambda col: api.prepare(col, deck_id, command.get("include_children") is True,
                                          "listening_reflex"),
                  lambda prepared: background(lambda: api.reflex_prepare(prepared, voice)))
        elif method == "hub_answer":
            today = anki_today()
            exercise_id = positive_id(command.get("exercise_id"))
            answer = command.get("answer")
            if not isinstance(answer, str) or not 0 < len(answer) <= 6000:
                raise ValueError("Hãy nhập câu trả lời.")
            confidence = command.get("confidence", "")
            if confidence not in ("", "sure", "unsure", "guess"):
                raise ValueError("Mức tự tin không hợp lệ.")
            response_ms = command.get("response_ms", 0)
            if type(response_ms) is not int or not 0 <= response_ms <= 3_600_000:
                raise ValueError("Thời gian trả lời không hợp lệ.")
            self_score = command.get("self_score")
            if self_score is not None and (type(self_score) is not int or self_score not in (0, 5, 10)):
                raise ValueError("Mức tự đối chiếu không hợp lệ.")
            background(lambda: api.hub_answer(exercise_id, answer, confidence,
                                              command.get("hint") is True, response_ms, today, self_score))
        elif method == "hub_summary":
            session_id = positive_id(command.get("session_id"))
            background(lambda: api.hub_summary(session_id, command.get("finish") is True))
        elif method == "hub_mistakes":
            today = anki_today()
            day_start = anki_day_start_utc()
            deck_name = command.get("deck_name", "")
            if not isinstance(deck_name, str) or len(deck_name) > 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            kind_filter = command.get("kind", "")
            if kind_filter not in ("", "meaning", "spelling", "listening", "usage", "concept", "confidence"):
                raise ValueError("Loại lỗi không hợp lệ.")
            offset = command.get("offset", 0)
            if type(offset) is not int or not 0 <= offset < 2**31:
                raise ValueError("Trang sổ lỗi không hợp lệ.")
            state = command.get("state", "")
            min_wrong = command.get("min_wrong", 1)
            due_before = command.get("due_before", "")
            if state not in ("", "new", "reviewing", "mastered") or type(min_wrong) is not int or not 1 <= min_wrong <= 1000:
                raise ValueError("Bộ lọc Sổ lỗi không hợp lệ.")
            if not isinstance(due_before, str) or (due_before and (len(due_before) != 10 or
                    not due_before[:4].isdigit() or due_before[4] != '-' or due_before[7] != '-')):
                raise ValueError("Ngày đến hạn không hợp lệ.")
            background(lambda: HubStore(api.path).mistakes(
                deck_name, command.get("due_only") is True,
                command.get("include_mastered") is True,
                today=today, limit=41, offset=offset, kind=kind_filter,
                daily_limit=api.config["review_daily_limit"], day_start_utc=day_start,
                state=state, min_wrong=min_wrong, due_before=due_before))
        elif method == "hub_review":
            mistake_id = positive_id(command.get("mistake_id"))
            exercise_id = positive_id(command["exercise_id"]) if command.get("exercise_id") else 0
            answer = command.get("answer")
            if not isinstance(answer, str) or not 0 < len(answer) <= 6000:
                raise ValueError("Câu trả lời không hợp lệ.")
            self_score = command.get("self_score")
            if self_score is not None and (type(self_score) is not int or self_score not in (0, 5, 10)):
                raise ValueError("Mức tự đối chiếu không hợp lệ.")
            today = anki_today()
            day_start = anki_day_start_utc()
            response_ms = command.get("response_ms", 0)
            if type(response_ms) is not int or not 0 <= response_ms <= 3_600_000:
                raise ValueError("Thời gian trả lời không hợp lệ.")
            background(lambda: HubStore(api.path).review_answer(
                mistake_id, answer, today, api.config["ignore_accents"], api.config["half_spelling"],
                api.config["review_daily_limit"], day_start, api.review_intervals(),
                self_score, exercise_id, response_ms))
        elif method == "hub_review_next":
            deck_id = positive_id(command.get("deck_id"))
            deck_name = command.get("deck_name")
            kind = command.get("kind")
            session_id = positive_id(command["session_id"]) if command.get("session_id") else 0
            source_session_id = (positive_id(command["source_session_id"])
                                 if command.get("source_session_id") else 0)
            if not isinstance(deck_name, str) or not 0 < len(deck_name) <= 500 or kind not in ("language", "knowledge"):
                raise ValueError("Bộ thẻ ôn lỗi không hợp lệ.")
            today = anki_today()
            day_start = anki_day_start_utc()
            def next_review() -> dict:
                result = HubStore(api.path).review_question(
                    deck_id, deck_name, kind, session_id, today=today,
                    daily_limit=api.config["review_daily_limit"], day_start_utc=day_start,
                    include_children=command.get("include_children") is True,
                    source_session_id=source_session_id)
                if result["question"]:
                    result["question"].pop("answers", None)
                return result
            background(next_review)
        elif method == "hub_highscores":
            name = command.get("deck_name")
            if not isinstance(name, str) or len(name) > 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            background(lambda: HubStore(api.path).highscores(name))
        elif method == "hub_progress":
            name = command.get("deck_name")
            if not isinstance(name, str) or not 0 < len(name) <= 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            background(lambda: HubStore(api.path).knowledge_progress(name))
        elif method == "hub_score":
            name = command.get("deck_name")
            game = command.get("game")
            score = command.get("score")
            if not isinstance(name, str) or len(name) > 500 or game not in MODE_DECK_KIND or type(score) is not int or score < 0:
                raise ValueError("Điểm game không hợp lệ.")
            background(lambda: HubStore(api.path).highscore(name, game, score))
        elif method == "hub_override":
            attempt_id = positive_id(command.get("attempt_id"))
            score = command.get("score")
            reason = command.get("reason", "")
            if type(score) not in (int, float) or not isinstance(reason, str):
                raise ValueError("Điểm hoặc ghi chú không hợp lệ.")
            background(lambda: HubStore(api.path).override(attempt_id, score, reason))
        elif method == "listening_generate":
            deck_id = positive_id(command.get("deck_id"))
            voice = command.get("voice")
            speed = command.get("speed")
            session_id = positive_id(command["session_id"]) if command.get("session_id") else 0
            def prepared_listening(prepared: tuple) -> None:
                def generated(result: dict) -> None:
                    success(result)
                    if not api.config["listening_prefetch"] or profile in _listening_prefetch or not current():
                        return
                    _listening_prefetch.add(profile)

                    def prefetch() -> None:
                        try:
                            for _ in range(api.config["listening_prefetch"]):
                                open_session, waiting = HubStore(api.path).listening_queue_state(result["session_id"])
                                if not open_session or waiting >= 1 + api.config["listening_prefetch"]:
                                    break
                                api.listening_generate(prepared, voice, speed, result["session_id"],
                                                       force_new=True)
                        except Exception:
                            # Foreground requests report service errors; background preparation is optional.
                            pass

                    def prefetched(future: Any) -> None:
                        _listening_prefetch.discard(profile)
                        future.result()

                    mw.taskman.run_in_background(prefetch, prefetched, uses_collection=False)

                background(lambda: api.listening_generate(prepared, voice, speed, session_id), generated)

            query(lambda col: api.prepare(col, deck_id, command.get("include_children") is True, "listening"),
                  prepared_listening)
        elif method == "listening_library":
            name = command.get("deck_name", "")
            if not isinstance(name, str) or len(name) > 500:
                raise ValueError("Tên bộ thẻ không hợp lệ.")
            background(lambda: api.listening_library(name))
        elif method == "listening_cleanup":
            background(api.listening_cleanup)
        elif method == "listening_answer":
            item_id = positive_id(command.get("item_id"))
            exercise_id = positive_id(command["exercise_id"]) if command.get("exercise_id") else 0
            response_ms = command.get("response_ms", 0)
            if type(response_ms) is not int or not 0 <= response_ms <= 3_600_000:
                raise ValueError("Thời gian trả lời không hợp lệ.")
            today = anki_today()
            background(lambda: api.listening_answer(item_id, command.get("answer", ""),
                                                     command.get("hint") is True, exercise_id, today,
                                                     response_ms))
        elif method == "listening_replay":
            item_id = positive_id(command.get("item_id"))
            background(lambda: HubStore(api.path).replay_listening(item_id))
        elif method == "listening_respeed":
            item_id = positive_id(command.get("item_id"))
            speed = command.get("speed")
            background(lambda: api.listening_respeed(item_id, speed))
        elif method == "listening_pin":
            item_id = positive_id(command.get("item_id"))
            background(lambda: HubStore(api.path).pin_listening(item_id, command.get("pinned") is True))
        elif method == "listening_delete":
            item_id = positive_id(command.get("item_id"))
            background(lambda: HubStore(api.path).delete_listening(item_id, api.path.parent / "brainexer_audio"))
        elif method == "settings":
            updated = clean_config(command.get("values"), strict=True)
            provider = updated["provider"]
            key = command.get("api_key", "")
            azure_key = command.get("azure_key", "")
            def saved(_result: None) -> None:
                save(updated)
                background(BrainExer(profile, updated).status)

            def persist_keys() -> None:
                api.save_key(provider, key)
                api.save_key("azure", azure_key)

            background(persist_keys, saved)
        elif method == "delete_key":
            provider = command.get("provider")
            if provider not in PROVIDERS:
                raise ValueError("Nhà cung cấp AI không hợp lệ.")

            def removed(_result: None) -> None:
                background(api.status)

            background(lambda: api.save_key(provider, "", delete=True), removed)
        elif method == "generate":
            exercise_type = command.get("exercise_type")
            if not isinstance(exercise_type, str) or exercise_type not in EXERCISES:
                raise ValueError("Dạng bài BrainExer không hợp lệ.")
            deck_id = positive_id(command.get("deck_id"))
            include_children = command.get("include_children") is True

            def prepared(sources: tuple) -> None:
                if not current():
                    success()
                    return
                try:
                    exercise_job(api, "exercise", lambda: api.generate(exercise_type, include_children, sources))
                except Exception as error:
                    failure(error)

            query(lambda col: api.prepare(col, deck_id, include_children, exercise_type), prepared)
        elif method == "submit":
            exercise_id = positive_id(command.get("exercise_id"))
            answer = command.get("answer")
            exercise_job(api, "result", lambda: api.submit(exercise_id, answer))
        elif method == "mistakes":
            offset = command.get("offset", 0)
            if type(offset) is not int or not 0 <= offset < 2**31:
                raise ValueError("Trang sổ lỗi không hợp lệ.")
            background(lambda: api.mistakes(command.get("include_mastered") is True, offset))
        elif method == "mastered":
            mistake_id = positive_id(command.get("mistake_id"))
            background(lambda: api.set_mastered(mistake_id, command.get("mastered") is True))
        elif method == "add_mistake":
            if not api.config["allow_anki_mistake_export"]:
                raise ValueError("Hãy bật tùy chọn tạo thẻ Anki từ Sổ lỗi trong Cài đặt AI.")
            mistake_id = positive_id(command.get("mistake_id"))
            CollectionOp(parent=mw, op=lambda col: api.add_mistake(col, mistake_id)).success(
                lambda result: success({"note_id": str(result.note_id)})
            ).failure(failure).run_in_background()
        elif method == "import_legacy":
            background(api.import_legacy)
        else:
            raise ValueError("Yêu cầu BrainExer không hợp lệ.")
    except Exception as error:
        failure(error)
