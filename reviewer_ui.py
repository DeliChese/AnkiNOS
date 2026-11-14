"""Review chrome only: Anki still owns card HTML, ratings and scheduling."""
from __future__ import annotations

import html
import json
from typing import Any, Callable

from aqt import gui_hooks, mw
from aqt.reviewer import Reviewer, ReviewerBottomBar
from aqt.qt import QTimer
from pathlib import Path
from .focus_store import FocusStore

_enabled: Callable[[], bool]
_settings: Callable[[], dict[str, Any]]
_answered = 0
_focus: FocusStore | None = None
_focus_profile: str | None = None
_focus_timer: QTimer | None = None


def focus_store() -> FocusStore:
    global _focus, _focus_profile
    name = mw.pm.name
    if _focus is None or _focus_profile != name:
        if _focus is not None:
            _focus.stop("interrupted")
        _focus = FocusStore(Path(__file__).resolve().parent, name)
        _focus_profile = name
    return _focus


def focus_history() -> dict:
    return focus_store().history()


def _emit_focus() -> None:
    if mw.state == "review" and _enabled():
        import json as _json
        status = _json.dumps(focus_store().status(), ensure_ascii=True)
        mw.web.eval("window.NOSReview && window.NOSReview.setFocus(" + status + ");")


def _focus_tick() -> None:
    if _focus is not None and mw.state == "review":
        before = _focus.session_id
        _focus.checkpoint()
        if before != _focus.session_id:
            _emit_focus()


def _content(content: Any, context: Any) -> None:
    if not _enabled() or not isinstance(context, (Reviewer, ReviewerBottomBar)):
        return
    package = mw.addonManager.addonFromModule(__package__)
    base = f"/_addons/{package}/assets"
    if isinstance(context, Reviewer):
        deck = mw.col.decks.current()
        current_settings = _settings()
        selected = current_settings.get("image_review")
        background = next(
            (image["url"] for image in current_settings.get("images", []) if image["id"] == selected),
            None,
        )
        initial = {"deck": deck["name"], "theme": current_settings.get("theme", "dusk"),
                   "answered": _answered, "focus": focus_store().status(), "background": background,
                   "background_fit": current_settings.get("image_fit_review", "contain"),
                   "background_position": current_settings.get("image_position_review", "center")}
        content.body = (
            '<div id="nos-review-shell"><div class="nos-review-wallpaper" aria-hidden="true"><img class="nos-review-wallpaper-image" alt="" hidden></div>'
            '<header id="nos-review-header"></header><main id="nos-review-stage">'
            '<section id="nos-review-card" aria-label="Nội dung thẻ">' + content.body + '</section></main></div>'
            '<textarea id="nos-review-bootstrap" hidden>' + html.escape(json.dumps(initial,ensure_ascii=True)) + '</textarea>'
        )
        content.css.append(f"{base}/reviewer.css")
        content.css.append(f"{base}/focus-review.css")
        content.js.append(f"{base}/reviewer.js")
    else:
        keys = {str(i): mw.pm.get_answer_key(i) or "" for i in (1,2,3,4)}
        content.body += '<textarea id="nos-rating-keys" hidden>' + html.escape(json.dumps(keys)) + '</textarea>'
        content.css.append(f"{base}/reviewer-bottom.css")
        content.js.append(f"{base}/reviewer-bottom.js")


def _show(card: Any, side: str) -> None:
    if _enabled() and mw.state == "review":
        value = json.dumps({"side":side,"answered":_answered,"card":str(card.id)})
        mw.web.eval(f"window.NOSReview && window.NOSReview.setState({value});")


def _question(card: Any) -> None:
    _show(card,"question")
    _emit_focus()


def _answer(card: Any) -> None:
    _show(card,"answer")


def _answered_card(_reviewer: Any, _card: Any, _ease: int) -> None:
    global _answered
    _answered += 1
    if _focus is not None:
        _focus.answer()


def _state(new: str, old: str) -> None:
    global _answered
    if old == "review" and new != "review" and _focus is not None:
        _focus.stop("stopped")
    if new == "review" and old != "review":
        _answered = 0


def _bridge(handled: tuple[bool,Any], message: str, context: Any) -> tuple[bool,Any]:
    if handled[0] or not isinstance(context,Reviewer) or not message.startswith("nos-review:"):
        return handled
    if not _enabled() or mw.state != "review":
        return (True,None)
    action = message.partition(":")[2]
    if action == "back":
        mw.moveToState("deckBrowser")
    elif action == "more":
        mw.reviewer.showContextMenu()
    elif action.startswith("focus:"):
        part = action.split(":")
        operation = part[1] if len(part) > 1 else ""
        try:
            store = focus_store()
            if operation == "start" and len(part) == 3:
                store.start(int(part[2]))
            elif operation == "pause":
                store.pause()
            elif operation == "resume":
                store.resume()
            elif operation == "stop":
                store.stop()
            elif operation == "complete":
                store.checkpoint()
            _emit_focus()
        except (ValueError, OSError) as error:
            from aqt.utils import showWarning
            showWarning("Focus Mode: " + str(error))
    return (True,None)


def _profile_close() -> None:
    global _focus, _focus_profile
    if _focus is not None:
        _focus.stop("stopped")
    _focus = None
    _focus_profile = None


def install(enabled: Callable[[],bool], settings: Callable[[],dict[str,Any]]) -> None:
    global _enabled, _settings, _focus_timer
    _enabled, _settings = enabled, settings
    _focus_timer = QTimer(mw)
    _focus_timer.setInterval(10000)
    _focus_timer.timeout.connect(_focus_tick)
    _focus_timer.start()
    gui_hooks.profile_will_close.append(_profile_close)
    gui_hooks.webview_will_set_content.append(_content)
    gui_hooks.webview_did_receive_js_message.append(_bridge)
    gui_hooks.state_will_change.append(_state)
    gui_hooks.reviewer_did_show_question.append(_question)
    gui_hooks.reviewer_did_show_answer.append(_answer)
    gui_hooks.reviewer_did_answer_card.append(_answered_card)
