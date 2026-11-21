-- REVIEW SNAPSHOT: keep identical to db/schema.sql (runtime source).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL,
    deck_name TEXT NOT NULL,
    card_count INTEGER NOT NULL CHECK(card_count >= 0),
    include_children INTEGER NOT NULL DEFAULT 1 CHECK(include_children IN (0, 1)),
    exercise_types TEXT NOT NULL CHECK(json_valid(exercise_types)),
    language TEXT NOT NULL,
    learner_level TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    card_id INTEGER,
    note_id INTEGER,
    exercise_type TEXT NOT NULL CHECK(exercise_type IN (
        'fill_blank', 'synonym_antonym', 'word_form', 'nuance', 'writing_free'
    )),
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

CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    user_answer TEXT NOT NULL,
    is_correct INTEGER CHECK(is_correct IN (0, 1) OR is_correct IS NULL),
    score REAL CHECK(score BETWEEN 0 AND 10 OR score IS NULL),
    feedback_payload TEXT NOT NULL CHECK(json_valid(feedback_payload)),
    submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
    mistake_type TEXT NOT NULL CHECK(mistake_type IN (
        'grammar', 'word_choice', 'spelling', 'nuance', 'word_form', 'other'
    )),
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    explanation TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor', 'major')),
    review_count INTEGER NOT NULL DEFAULT 0 CHECK(review_count >= 0),
    mastered INTEGER NOT NULL DEFAULT 0 CHECK(mastered IN (0, 1)),
    linked_anki_note_id INTEGER,
    linked_anki_card_id INTEGER,
    created_at TEXT NOT NULL,
    last_reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_key TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('api_call', 'exercise_generated')),
    status TEXT NOT NULL CHECK(status IN ('reserved', 'succeeded', 'failed', 'cancelled')),
    local_date TEXT NOT NULL,
    week_start TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(request_key, event_type)
);

CREATE TABLE IF NOT EXISTS limit_settings (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL CHECK(value >= 0)
);

INSERT OR IGNORE INTO limit_settings(key, value) VALUES
    ('max_api_calls_per_day', 50),
    ('max_api_calls_per_week', 250),
    ('max_exercises_per_day', 30),
    ('max_exercises_per_week', 150);

CREATE INDEX IF NOT EXISTS idx_exercises_session ON exercises(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exercise ON attempts(exercise_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_attempt ON mistakes(attempt_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_review ON mistakes(mastered, mistake_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_period ON usage_events(event_type, status, local_date, week_start);

PRAGMA user_version = 1;

