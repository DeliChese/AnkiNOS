"""AnkiNOS — a glass dashboard for Anki's deck browser."""

from .integration import install

try:
    install()
except Exception as error:
    # Optional UI integration must not prevent Anki itself from starting.
    from .integration import _fallback
    _fallback(error)
