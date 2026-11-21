"""Run dashboard BrainExer requests on the appropriate Anki executor."""

from __future__ import annotations

from typing import Any, Callable

from aqt import mw
from aqt.operations import CollectionOp, QueryOp

from .brainexer.core.exceptions import BrainExerError
from .brainexer_api import BrainExer, EXERCISES, PROVIDERS, clean_config, error_message, positive_id

_pending: set[str] = set()


def busy(profile: str) -> bool:
    return profile in _pending


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

    if backup_busy or busy(profile):
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
        elif method == "settings":
            updated = clean_config(command.get("values"), strict=True)
            provider = updated["provider"]
            key = command.get("api_key", "")
            def saved(_result: None) -> None:
                save(updated)
                background(BrainExer(profile, updated).status)

            background(lambda: api.save_key(provider, key), saved)
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
