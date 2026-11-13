"""Review chrome only: Anki still owns card HTML, ratings and scheduling."""
from __future__ import annotations

import html
import json
from typing import Any, Callable

from aqt import gui_hooks, mw
from aqt.reviewer import Reviewer, ReviewerBottomBar

_enabled: Callable[[], bool]
_settings: Callable[[], dict[str, Any]]
_answered = 0


def _content(content: Any, context: Any) -> None:
    if not _enabled() or not isinstance(context, (Reviewer, ReviewerBottomBar)):
        return
    package = mw.addonManager.addonFromModule(__package__)
    base = f"/_addons/{package}/assets"
    if isinstance(context, Reviewer):
        deck = mw.col.decks.current()
        initial = {"deck": deck["name"], "theme": _settings().get("theme", "dusk"), "answered": _answered}
        content.body = (
            '<div id="nos-review-shell"><div class="nos-review-wallpaper" aria-hidden="true"></div>'
            '<header id="nos-review-header"></header><main id="nos-review-stage">'
            '<section id="nos-review-card" aria-label="Nội dung thẻ">' + content.body + '</section></main></div>'
            '<textarea id="nos-review-bootstrap" hidden>' + html.escape(json.dumps(initial,ensure_ascii=True)) + '</textarea>'
        )
        content.css.append(f"{base}/reviewer.css")
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


def _answer(card: Any) -> None:
    _show(card,"answer")


def _answered_card(_reviewer: Any, _card: Any, _ease: int) -> None:
    global _answered
    _answered += 1


def _state(new: str, old: str) -> None:
    global _answered
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
    return (True,None)


def install(enabled: Callable[[],bool], settings: Callable[[],dict[str,Any]]) -> None:
    global _enabled, _settings
    _enabled, _settings = enabled, settings
    gui_hooks.webview_will_set_content.append(_content)
    gui_hooks.webview_did_receive_js_message.append(_bridge)
    gui_hooks.state_will_change.append(_state)
    gui_hooks.reviewer_did_show_question.append(_question)
    gui_hooks.reviewer_did_show_answer.append(_answer)
    gui_hooks.reviewer_did_answer_card.append(_answered_card)
