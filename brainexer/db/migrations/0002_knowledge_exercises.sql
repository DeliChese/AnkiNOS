PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE exercises_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    card_id INTEGER,
    note_id INTEGER,
    exercise_type TEXT NOT NULL CHECK(exercise_type IN (
        'fill_blank', 'synonym_antonym', 'word_form', 'nuance', 'writing_free',
        'recall', 'multiple_choice', 'application'
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

INSERT INTO exercises_new SELECT * FROM exercises;
DROP TABLE exercises;
ALTER TABLE exercises_new RENAME TO exercises;
CREATE INDEX idx_exercises_session ON exercises(session_id);

PRAGMA user_version = 2;
COMMIT;
PRAGMA foreign_keys = ON;
