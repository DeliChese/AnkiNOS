"""Review chrome only: Anki still owns card HTML, ratings and scheduling."""
from __future__ import annotations

import html
import json
from typing import Any, Callable

from aqt import gui_hooks, mw
from aqt.reviewer import Reviewer, ReviewerBottomBar
from aqt.qt import QTimer, QObject, QEvent
from pathlib import Path

from .i18n import translate as _tr_text

_enabled: Callable[[], bool]
_settings: Callable[[], dict[str, Any]]


def _t(text: str) -> str:
    try:
        lang = _settings().get("language", "vi") if callable(_settings) else "vi"
    except Exception:
        lang = "vi"
    return _tr_text(text, lang)
_answered = 0
_session_base_reviews: int | None = None
_focus: Any = None
_focus_profile: str | None = None
_focus_timer: QTimer | None = None
_focus_guard: QObject | None = None
_pending_focus: tuple | None = None


def _today_review_count() -> int:
    try:
        if not mw.col:
            return 0
        start_ms = (int(mw.col.sched.day_cutoff) - 86400) * 1000
        return int(mw.col.db.scalar(
            "SELECT count(*) FROM revlog WHERE id >= ? AND ease > 0 AND type < 4",
            start_ms,
        ) or 0)
    except Exception:
        return 0


def _live_review_counts() -> tuple[list[int], int] | None:
    try:
        if not mw.col or mw.state != "review" or not mw.col.conf.get("dueCounts", True):
            return None
        new_c, learn_c, review_c = (int(v) for v in mw.col.sched.counts())
        active_idx = -1
        v3 = getattr(mw.reviewer, "_v3", None)
        if v3 is not None:
            try:
                active_idx = int(v3.counts()[0])
            except Exception:
                active_idx = -1
        if active_idx not in {0, 1, 2} and mw.reviewer.card is not None:
            queue = int(getattr(mw.reviewer.card, "queue", 0))
            active_idx = 0 if queue == 0 else (1 if queue in {1, 3} else 2)
        return ([new_c, learn_c, review_c], active_idx)
    except Exception:
        return None


def _sync_bottom_counts() -> None:
    if not _enabled() or mw.state != "review" or getattr(mw.reviewer, "state", None) != "question":
        return
    live = _live_review_counts()
    if not live:
        return
    counts, active_idx = live
    payload = json.dumps(counts)
    mw.bottomWeb.eval(f"window.NOSRatings && window.NOSRatings.setCounts({payload}, {active_idx});")


def prepare_focus(minutes: int) -> None:
    global _pending_focus
    _pending_focus = (mw.pm.name, str(mw.col.decks.selected()), minutes)


def checkpoint_focus() -> None:
    if _focus is not None:
        _focus.checkpoint()


def reset_focus_store() -> None:
    _profile_close()


def focus_store() -> Any:
    global _focus, _focus_profile
    name = mw.pm.name
    if _focus is None or _focus_profile != name:
        from .focus_store import FocusStore
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
    if mw.state == "review" and _enabled():
        if _focus is not None:
            before = _focus.session_id
            _focus.checkpoint()
            if before != _focus.session_id:
                _emit_focus()
        _sync_bottom_counts()


def _review_content(content: Any, context: Any) -> None:
    if not _enabled() or not isinstance(context, (Reviewer, ReviewerBottomBar)):
        return
    package = mw.addonManager.addonFromModule(__package__)
    base = f"/_addons/{package}/assets"
    current_settings = _settings()
    appearance = {
        key: current_settings[key]
        for key in (
            "theme", "color_theme", "accent", "custom_accent",
            "text_color", "custom_text_color",
            "rating_colors", "rating_color_again", "rating_color_hard", "rating_color_good", "rating_color_easy",
            "reviewer_card_opacity",
            "font_family", "glass_blur", "glass_opacity", "language",
        )
        if key in current_settings
    }
    content.js.append(f"{base}/i18n.js")
    content.js.append(f"{base}/i18n-en.js")
    content.js.append(f"{base}/i18n-zh-cn.js")
    content.js.append(f"{base}/theme.js")
    if isinstance(context, Reviewer):
        deck = mw.col.decks.current()
        selected = current_settings.get("image_review")
        background = next(
            (image.get("wall_url") or image["url"] for image in current_settings.get("images", []) if image["id"] == selected),
            None,
        )
        initial = {"deck": deck["name"], **appearance,
                   "answered": _answered, "focus": focus_store().status(), "background": background,
                   "background_fit": current_settings.get("image_fit_review", "cover"),
                   "wallpaper_dim": current_settings.get("wallpaper_dim", 28),
                   "wallpaper_blur": current_settings.get("wallpaper_blur", 0),
                   "background_position": current_settings.get("image_position_review", "center"),
                   "background_frame": (current_settings.get("image_frames") or {}).get("review", {"x": 50, "y": 50, "zoom": 100}),
                   "ui_scale": current_settings.get("ui_scale", 100),
                   "blur": current_settings.get("blur", True),
                   "lite_mode": bool(current_settings.get("lite_mode", False)),
                   "animations": current_settings.get("animations", True)}
        card_label = html.escape(_t("Nội dung thẻ"), quote=True)
        content.body = (
            '<div id="nos-review-shell"><div class="nos-review-wallpaper" aria-hidden="true"><img class="nos-review-wallpaper-image" alt="" hidden><div class="nos-review-aurora"><i></i><i></i></div></div>'
            '<header id="nos-review-header"></header><main id="nos-review-stage">'
            f'<section id="nos-review-card" data-i18n-skip aria-label="{card_label}">' + content.body + '</section></main></div>'
            '<textarea id="nos-review-bootstrap" hidden>' + html.escape(json.dumps(initial,ensure_ascii=True)) + '</textarea>'
        )
        content.css.append(f"{base}/reviewer.css")
        content.css.append(f"{base}/focus-review.css")
        content.js.append(f"{base}/runtime-guard.js")
        content.js.append(f"{base}/reviewer.js")
    else:
        bottom_appearance = {
            **appearance,
            "animations": current_settings.get("animations", True),
            "lite_mode": bool(current_settings.get("lite_mode", False)),
        }
        content.body += '<textarea id="nos-theme-bootstrap" hidden>' + html.escape(json.dumps(bottom_appearance)) + '</textarea>'
        keys = {str(i): mw.pm.get_answer_key(i) or "" for i in (1,2,3,4)}
        content.body += '<textarea id="nos-rating-keys" hidden>' + html.escape(json.dumps(keys)) + '</textarea>'
        content.css.append(f"{base}/reviewer-bottom.css")
        content.js.append(f"{base}/reviewer-bottom.js")
    content.css.append(f"{base}/theme.css")


def _content(content: Any, context: Any) -> None:
    original = (content.body, list(content.css), list(content.js))
    try:
        _review_content(content, context)
    except Exception as error:
        content.body, content.css, content.js = original
        from .integration import _fallback
        _fallback(error)


def _show(card: Any, side: str) -> None:
    if _enabled() and mw.state == "review":
        value = json.dumps({"side":side,"answered":_answered,"card":str(card.id)})
        mw.web.eval(f"window.NOSReview && window.NOSReview.setState({value});")


def _question(card: Any) -> None:
    _show(card,"question")
    _emit_focus()
    _sync_bottom_counts()


def _answer(card: Any) -> None:
    _show(card,"answer")


def _answered_card(_reviewer: Any, _card: Any, _ease: int) -> None:
    global _answered
    if _session_base_reviews is not None:
        _answered = max(0, _today_review_count() - _session_base_reviews)
    else:
        _answered += 1
    if _focus is not None:
        _focus.answer()


def _op_executed(changes: Any, initiator: Any) -> None:
    global _answered
    if not _enabled() or mw.state != "review":
        return
    if any(getattr(changes, key, False) for key in ("study_queues", "card", "deck_config")):
        if _session_base_reviews is not None:
            _answered = max(0, _today_review_count() - _session_base_reviews)
        if getattr(mw.reviewer, "state", None) == "question":
            QTimer.singleShot(0, _sync_bottom_counts)
            if mw.reviewer.card is not None and initiator is not mw.reviewer:
                QTimer.singleShot(0, lambda c=mw.reviewer.card: _show(c, "question"))


def _state(new: str, old: str) -> None:
    global _answered, _session_base_reviews, _pending_focus
    if old == "review" and new != "review" and _focus is not None:
        _focus.stop("stopped")
    if new != "review":
        _session_base_reviews = None
    if new == "review" and old != "review":
        _answered = 0
        _session_base_reviews = _today_review_count()
        planned, _pending_focus = _pending_focus, None
        if _enabled() and planned and planned[:2] == (mw.pm.name, str(mw.col.decks.selected())):
            focus_store().start(planned[2])


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
    elif action == "notebook":
        from .study_tools_ui import open_notebook
        open_notebook()
    elif action == "native":
        from .integration import _fallback
        _fallback(RuntimeError(_t("Không thể nạp giao diện phiên học.")))
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
            showWarning("Focus Mode: " + _t(str(error)))
    return (True,None)


class _FocusWindowGuard(QObject):
    def eventFilter(self, watched: Any, event: Any) -> bool:
        # Inactive Anki is not focused study time. Require manual resume.
        if (event.type() == QEvent.Type.WindowDeactivate and mw.state == "review"
                and _focus is not None and _focus.running_since is not None):
            _focus.pause()
            _emit_focus()
        return False


def _profile_close() -> None:
    global _focus, _focus_profile, _pending_focus
    if _focus is not None:
        _focus.stop("stopped")
    _focus = None
    _focus_profile = None
    _pending_focus = None


def install(enabled: Callable[[],bool], settings: Callable[[],dict[str,Any]]) -> None:
    global _enabled, _settings, _focus_timer, _focus_guard
    _enabled, _settings = enabled, settings
    _focus_guard = _FocusWindowGuard(mw)
    mw.installEventFilter(_focus_guard)
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
    gui_hooks.operation_did_execute.append(_op_executed)
