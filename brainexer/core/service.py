from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, List

from ..ai.base import StructuredAIClient
from ..ai.prompt_loader import PROMPT_VERSION, load_system_prompt, load_task_prompt
from ..ai.schemas import APPLICATION_GRADING_RESPONSE_SCHEMA, EXERCISE_RESPONSE_SCHEMA, GRADING_RESPONSE_SCHEMA, validate_envelope
from ..db.connection import Database
from .answering import deterministic_mistake, local_feedback, normalize_answer
from .exceptions import InsufficientDataError, ResponseValidationError
from .field_mapper import prompt_cards
from .hub import DEFAULT_LISTENING_DIFFICULTY
from .models import AI_GRADED_TYPES, KNOWLEDGE_TYPES, AttemptResult, CardSource, GeneratedExercise
from .rate_limiter import RateLimiter


@dataclass(frozen=True)
class ServiceConfig:
    provider: str
    model: str
    language: str
    feedback_language: str
    learner_level: str
    store_raw_responses: bool


class BrainExerService:
    def __init__(
        self,
        database: Database,
        limiter: RateLimiter,
        client: StructuredAIClient,
        config: ServiceConfig,
    ) -> None:
        self.database = database
        self.limiter = limiter
        self.client = client
        self.config = config

    def generate_exercise(
        self,
        session_id: int,
        exercise_type: str,
        sources: List[CardSource],
        *,
        knowledge_override: bool | None = None,
        listening_difficulty: str = DEFAULT_LISTENING_DIFFICULTY,
    ) -> GeneratedExercise:
        knowledge = (exercise_type in KNOWLEDGE_TYPES or exercise_type == "explain"
                     if knowledge_override is None else knowledge_override)
        cards = prompt_cards(sources, knowledge=knowledge)
        if not cards:
            raise InsufficientDataError("Bộ thẻ không có trường văn bản phù hợp để tạo bài.")
        request_key = str(uuid.uuid4())
        self.limiter.reserve(request_key, include_exercise=True)
        source_data = {
            "language": "auto" if knowledge else self.config.language,
            "feedback_language": self.config.feedback_language,
            "learner_level": self.config.learner_level,
            "cards": cards,
        }
        if exercise_type == "listening":
            source_data["listening_difficulty"] = listening_difficulty

        def checked(payload: dict) -> dict:
            envelope = validate_envelope(payload)
            if envelope["status"] == "insufficient_data":
                return envelope
            data = envelope["data"]
            if knowledge or exercise_type not in AI_GRADED_TYPES:
                answers = [normalize_answer(answer) for answer in data["correct_answers"]]
                if not answers or not all(answers):
                    raise ResponseValidationError("AI chưa đưa ra đáp án dùng để chấm bài.")
                if exercise_type in ("multiple_choice", "phrase"):
                    choices = {normalize_answer(option) for option in data["options"]}
                    if (not 3 <= len(data["options"]) <= 4 or len(choices) != len(data["options"])
                            or "" in choices or len(answers) != 1 or answers[0] not in choices):
                        raise ResponseValidationError("Bài trắc nghiệm cần có 3–4 lựa chọn và một đáp án đúng.")
            return envelope
        api_succeeded = False
        try:
            result = self.client.create_structured(
                load_system_prompt(),
                load_task_prompt(exercise_type),
                source_data,
                "brainexer_exercise",
                EXERCISE_RESPONSE_SCHEMA,
            )
            api_succeeded = True
            try:
                envelope = checked(result.payload)
            except ResponseValidationError:
                self.limiter.finish(request_key, api_succeeded=True, exercise_created=False)
                request_key = str(uuid.uuid4())
                self.limiter.reserve(request_key, include_exercise=True)
                api_succeeded = False
                result = self.client.create_structured(
                    load_system_prompt(), load_task_prompt(exercise_type), source_data,
                    "brainexer_exercise", EXERCISE_RESPONSE_SCHEMA,
                )
                api_succeeded = True
                envelope = checked(result.payload)
            if envelope["status"] == "insufficient_data":
                raise InsufficientDataError(envelope["reason"])

            data = envelope["data"]
            primary = sources[0] if sources and exercise_type != "writing_free" else None
            exercise_id = self.database.insert_exercise(
                session_id=session_id,
                exercise_type=exercise_type,
                prompt_shown=data["question_prompt"],
                source_context=source_data,
                payload=data,
                raw_response=result.raw_response if self.config.store_raw_responses else None,
                provider=self.config.provider,
                model=self.config.model,
                prompt_version=PROMPT_VERSION,
                request_id=result.request_id,
                card_id=primary.card_id if primary else None,
                note_id=primary.note_id if primary else None,
            )
        except Exception:
            self.limiter.finish(request_key, api_succeeded=api_succeeded, exercise_created=False)
            raise
        self.limiter.finish(request_key, api_succeeded=True, exercise_created=True)
        return GeneratedExercise(exercise_id, session_id, exercise_type, data)

    def submit_objective(
        self,
        exercise: GeneratedExercise,
        user_answer: str,
    ) -> AttemptResult:
        return submit_objective(self.database, exercise, user_answer)

    def grade_writing(
        self,
        exercise: GeneratedExercise,
        user_text: str,
        *,
        source_context: dict[str, Any] | None = None,
    ) -> AttemptResult:
        if not user_text.strip():
            raise InsufficientDataError("Bạn chưa nhập bài viết.")
        request_key = str(uuid.uuid4())
        self.limiter.reserve(request_key, include_exercise=False)
        grading_source = {
            "prompt_given": exercise.data.get("question_prompt", ""),
            "related_target_words": exercise.data.get("target_words_to_use", []),
            "user_text": user_text,
            "language": self.config.language,
            "feedback_language": self.config.feedback_language,
            "learner_level": self.config.learner_level,
        }
        application = exercise.exercise_type in ("application", "explain")
        schema = GRADING_RESPONSE_SCHEMA
        prompt = "writing_grading"
        if application:
            grading_source.update(
                cards=(source_context or {}).get("cards", []),
                reference_answers=exercise.data["correct_answers"],
                language=(source_context or {}).get("language", "auto"),
            )
            schema = APPLICATION_GRADING_RESPONSE_SCHEMA
            prompt = "application_grading"
        api_succeeded = False
        try:
            result = self.client.create_structured(
                load_system_prompt(),
                load_task_prompt(prompt),
                grading_source,
                "brainexer_application_grade" if application else "brainexer_writing_grade",
                schema,
            )
            api_succeeded = True
            try:
                envelope = validate_envelope(result.payload, schema)
            except ResponseValidationError:
                self.limiter.finish(request_key, api_succeeded=True)
                request_key = str(uuid.uuid4())
                self.limiter.reserve(request_key, include_exercise=False)
                api_succeeded = False
                result = self.client.create_structured(
                    load_system_prompt(), load_task_prompt(prompt), grading_source,
                    "brainexer_application_grade" if application else "brainexer_writing_grade", schema,
                )
                api_succeeded = True
                envelope = validate_envelope(result.payload, schema)
        except Exception:
            self.limiter.finish(request_key, api_succeeded=api_succeeded)
            raise
        self.limiter.finish(request_key, api_succeeded=True)
        if envelope["status"] == "insufficient_data":
            raise InsufficientDataError(envelope["reason"])
        data = envelope["data"]
        attempt_id = self.database.insert_attempt(
            exercise.exercise_id,
            user_text,
            data,
            is_correct=None,
            score=float(data["score"]),
            mistakes=data.get("errors", []),
        )
        return AttemptResult(attempt_id, float(data["score"]), None, data)


def submit_objective(database: Database, exercise: GeneratedExercise, user_answer: str,
                     *, ignore_accents: bool = False) -> AttemptResult:
    feedback = local_feedback(exercise.exercise_type, exercise.data, user_answer,
                              ignore_accents=ignore_accents)
    correct = bool(feedback["is_correct"])
    score = 10.0 if correct else 0.0
    mistakes = [] if correct else [deterministic_mistake(exercise.exercise_type, exercise.data, user_answer)]
    attempt_id = database.insert_attempt(
        exercise.exercise_id, user_answer, feedback, is_correct=correct, score=score, mistakes=mistakes,
    )
    return AttemptResult(attempt_id, score, correct, feedback)
