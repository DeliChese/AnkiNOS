# AnkiNOS (`v1.0.0 Beta`)

**An offline, zero-dependency frosted-glass workspace for desktop Anki (`>= 25.02`).**  
*Không gian học tập kính mờ ngoại tuyến, không phụ thuộc thư viện ngoài dành cho Anki máy tính (`>= 25.02`).*

AnkiNOS redesigns Anki's desktop dashboard, deck overview, statistics, and study chrome for visual calm and daily focus — while preserving 100% of Anki's native FSRS scheduling, flashcard templates (`#qa`), and offline privacy.

> **Status:** Public Beta (`v1.0.0 Beta`) · Built and maintained as an independent solo project · Tested primarily on Windows (Anki 25.02–26.05) with cross-platform safeguards for macOS and Linux.

---

## Key Features / Tính năng nổi bật

- **6 Dashboard Layouts** (`Alt + Shift + L` to cycle): *Aurora, Bento, Floating Dock, Workspace Sidebar, Zen,* and *4 Edges (Wallpaper)* with auto-hiding macOS-style edge docks and pure wallpaper peek mode.
- **12 WCAG-Checked Color Palettes & 8 Offline Fonts**: *NOS Glass, Tokyo, Mononoke, Catppuccin, Rosé Pine, Nord, Solarized, Dracula, Gruvbox, Everforest, Kanagawa,* and *Sakura* across 5 display modes (*Dusk, Dark Glass, OLED, Light, System*), custom accent colors, and live isolated preview before applying.
- **ANOS Scheduler (Smart Daily Memory Schedule)**: Organize overdue review backlogs safely via **Smart Catch-up** (virtual filtered session) or **Real Reschedule** (shifts only `card.due` on overdue review cards while keeping FSRS state/intervals intact, backed by Anki Undo and an offline SQLite rollback ledger). Future days remain locked to protect natural spacing.
- **Inline Native Anki Statistics & PDF Export**: All 13 native Anki graph sections rendered directly from `col._backend.graphs()` with deck/collection & period filtering, Focus Mode history, Worth Noticing insights, and clean A4 PDF export.
- **Media Studio, Profile Cover & Lightbox**: Profile-local wallpaper library with non-destructive interactive framing (drag X/Y, 100–250% zoom, toggleable 3×3 grid, per-slot aspect ratio previews), Facebook-style Profile Cover (`3:1`), Avatar, and full-size Lightbox viewer.
- **Focus Mode & Compact Reviewer Chrome**: Minimal reviewer header and auto-fitted card box that lets your wallpaper breathe, paired with a Focus timer (auto-pauses when Anki loses focus) and 30-day personal pace estimates.
- **Quick Commands (`Ctrl+K`) & Contextual Notebook**: Accent-insensitive search across decks, notes, resources, and Anki actions; floating rounded Markdown notebook with pins, 6 color labels, tags, quick templates, split preview, checklists, `.md` export, and trash/restore.
- **Full `.nosbackup` Archive**: One-click export/restore of profile settings, local wallpapers, Notebook, Focus history, and Schedule ledger with SHA-256 verification and automatic pre-restore recovery backups.
- **Extensible Auto-Detect i18n (Tiếng Việt / English / 简体中文)**: Automatically follows Anki's interface language on first run (`vi*` → Vietnamese, `zh*` → Simplified Chinese, other locales → English, and automatically supports future language packs once registered).

---

## Respect for Native Anki / Tôn trọng Anki gốc

AnkiNOS is designed around strict safety guarantees:

1. **Never modifies your flashcards:** `#qa`, card template HTML/CSS/JS, MathJax, audio, and native Editor/Browser windows stay untouched.
2. **Never modifies FSRS or grading:** Rating buttons (*Again / Hard / Good / Easy*), intervals, and scheduler math come directly from Anki.
3. **100% offline & local-only:** Zero CDN calls, zero telemetry, zero external packages. Local wallpapers and SQLite stores live strictly in `user_files/<profile-hash>/` and are never written to `collection.media` or synced to AnkiWeb.
4. **One-click escape hatch:** Switch back to native Anki anytime via **Profile → Use native Anki** or **About → Native Anki** (or automatic fallback if any hook encounters an error).

---

## Installation & Quick Start / Cài đặt & Bắt đầu nhanh

- **Requirements:** Desktop Anki `>= 25.02` (Qt6 / Python 3.12+).
- **Manual / Beta install:** Place the add-on folder inside your Anki `addons21/` directory (e.g. `Anki2/addons21/NOS`) and restart Anki.
- **First launch:** AnkiNOS greets you with a quick welcome screen and an offline **User Guide** (click the `i` icon in the top bar anytime, or click the **AnkiNOS logo** for **About**).
- **Useful shortcuts:**
  - `Ctrl+K` (`Cmd+K`): Quick Commands
  - `Ctrl+Shift+K`: Search Deck Library popup
  - `Ctrl+,`: Open AnkiNOS Settings
  - `Alt+Shift+L`: Cycle Dashboard Layouts

---

## Bug Reports, Feedback & Translations / Báo lỗi & Đóng góp

AnkiNOS is maintained solo without a heavy community chat server — **GitHub Issues** is the best place to reach out:

- **Found a bug?** Click the **AnkiNOS logo → Copy diagnostics** (*Sao chép chẩn đoán*) and paste it into a [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml). The diagnostic snippet only includes Anki/OS/UI versions — never your decks, cards, or profile name.
- **Want to help translate AnkiNOS into another language?** Adding a language only requires a single dictionary file (see [docs/I18N-GUIDE.md](docs/I18N-GUIDE.md)) and automatically hooks into auto-detection! Open a Translation issue to coordinate.

---

## Acknowledgements / Lời cảm ơn

AnkiNOS would not exist without the open-source ecosystem and community around Anki:

- **[Anki](https://apps.ankiweb.net/) & Damien Elmes** — for building the spaced-repetition engine that powers everything underneath.
- **[FSRS](https://github.com/open-spaced-repetition/fsrs4anki) (Jarrett Ye & open-spaced-repetition contributors)** — for modern memory modeling and Retrievability metrics.
- **[Onigiri](https://github.com/thepeacemonk/Onigiri)** — for inspiring AnkiNOS's semantic light/dark palette architecture and welcoming polish (independent implementation; no Onigiri code or assets are bundled — see [THEME-NOTES.md](THEME-NOTES.md)).
- **Open-source color palette creators** — [Catppuccin](https://github.com/catppuccin/catppuccin), [Rosé Pine](https://rosepinetheme.com/palette/), [Nord](https://www.nordtheme.com/), [Solarized](https://ethanschoonover.com/solarized/), [Dracula](https://draculatheme.com/), [Gruvbox](https://github.com/morhetz/gruvbox), [Everforest](https://github.com/sainnhe/everforest), [Kanagawa](https://github.com/rebelot/kanagawa.nvim), and [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme).

---

## Technical Docs & Verification / Tài liệu kỹ thuật & Kiểm thử

- Working guide & invariants: [AGENTS.md](AGENTS.md)
- Deep-dive reference docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/FILE-MAP.md](docs/FILE-MAP.md), [docs/BRIDGE-AND-DATA.md](docs/BRIDGE-AND-DATA.md), [docs/UI-THEMES-LAYOUTS.md](docs/UI-THEMES-LAYOUTS.md), [docs/I18N-GUIDE.md](docs/I18N-GUIDE.md), [docs/TESTING-AND-CI.md](docs/TESTING-AND-CI.md)
- Theme credits & contrast methodology: [THEME-NOTES.md](THEME-NOTES.md)

```powershell
# Fast checks (i18n parity, Python bytecode, unit tests)
node tests/i18n-check.mjs
python -m compileall -q .
python tests/run-unit.py

# Chromium UI & contrast suites (Node 22+ & local Chrome)
node tests/theme-check.mjs
node tests/tools-ui.mjs
node tests/ui-check.mjs

# Real Anki offscreen smoke test
python tests/anki-smoke.py

# Inspect clean release file list without writing an archive
python scripts/build-addon.py --dry-run
```

## License

Released under the [MIT License](LICENSE).
