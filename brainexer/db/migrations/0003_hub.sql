PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;
CREATE TABLE exercises_hub (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    card_id INTEGER,
    note_id INTEGER,
    exercise_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated', 'answered', 'skipped')),
    prompt_shown TEXT NOT NULL,
    source_context TEXT NOT NULL CHECK(json_valid(source_context)),
    exercise_payload TEXT NOT NULL CHECK(json_valid(exercise_payload)),
    ai_raw_response TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    response_request_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
INSERT INTO exercises_hub SELECT * FROM exercises;
DROP TABLE exercises;
ALTER TABLE exercises_hub RENAME TO exercises;
CREATE INDEX idx_exercises_session ON exercises(session_id);
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN deck_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN score REAL NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN response_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN confidence TEXT NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN used_hint INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mistakes ADD COLUMN deck_name TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN source_card_id INTEGER;
ALTER TABLE mistakes ADD COLUMN kind TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN wrong_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mistakes ADD COLUMN review_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mistakes ADD COLUMN due_date TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN correct_at_top INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mistakes ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN source_key TEXT NOT NULL DEFAULT '';

UPDATE mistakes SET deck_name=(
    SELECT s.deck_name FROM attempts a
    JOIN exercises e ON e.id=a.exercise_id
    JOIN sessions s ON s.id=e.session_id WHERE a.id=mistakes.attempt_id
), source_card_id=(
    SELECT e.card_id FROM attempts a JOIN exercises e ON e.id=a.exercise_id
    WHERE a.id=mistakes.attempt_id
), prompt=(
    SELECT e.prompt_shown FROM attempts a JOIN exercises e ON e.id=a.exercise_id
    WHERE a.id=mistakes.attempt_id
), kind=CASE mistake_type WHEN 'spelling' THEN 'spelling' WHEN 'other' THEN 'concept'
    WHEN 'nuance' THEN 'meaning' ELSE 'usage' END,
    due_date=date(created_at, '+1 day'),
    source_key=CASE WHEN (
        SELECT e.card_id FROM attempts a JOIN exercises e ON e.id=a.exercise_id
        WHERE a.id=mistakes.attempt_id) IS NOT NULL THEN CAST((
        SELECT e.card_id FROM attempts a JOIN exercises e ON e.id=a.exercise_id
        WHERE a.id=mistakes.attempt_id) AS TEXT) ELSE 'legacy:' || id END,
    last_seen_at=created_at
WHERE deck_name='';

CREATE TABLE deck_kinds (
    deck_name TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('language','knowledge'))
);
CREATE TABLE listening_items (
    id INTEGER PRIMARY KEY,
    deck_name TEXT NOT NULL,
    sentence TEXT NOT NULL,
    translation TEXT NOT NULL DEFAULT '',
    targets TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(targets)),
    level TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    voice TEXT NOT NULL,
    speed TEXT NOT NULL,
    audio_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_accuracy REAL NOT NULL DEFAULT 0,
    last_accuracy REAL NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE audio_cache (
    hash TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    voice TEXT NOT NULL,
    speed TEXT NOT NULL,
    chars INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE highscores (
    deck_name TEXT NOT NULL,
    game TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    achieved_at TEXT NOT NULL,
    PRIMARY KEY(deck_name,game)
);
CREATE TABLE overrides (
    id INTEGER PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES attempts(id),
    original_score REAL,
    revised_score REAL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE tts_usage (
    month TEXT PRIMARY KEY,
    chars INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_hub_attempts_session ON attempts(exercise_id);
CREATE INDEX idx_hub_mistakes_due ON mistakes(deck_name, mastered, due_date);
CREATE INDEX idx_hub_mistakes_source ON mistakes(deck_name, source_card_id, kind);
CREATE INDEX idx_listening_deck ON listening_items(deck_name, created_at);
CREATE UNIQUE INDEX idx_listening_audio ON listening_items(deck_name, sentence, voice, speed);
PRAGMA user_version = 3;
COMMIT;
PRAGMA foreign_keys = ON;
