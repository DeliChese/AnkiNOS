"""BrainExer sessions must never alter Anki's reviewer data."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from anki.collection import Collection
from anki.lang import set_lang

set_lang("en_US")
ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("nos_hub_invariant")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
from nos_hub_invariant.brainexer_api import BrainExer  # noqa: E402
from nos_hub_invariant.brainexer.hub_store import HubStore  # noqa: E402
from nos_hub_invariant.brainexer.core.models import CardSource, DeckInfo  # noqa: E402
from nos_hub_invariant.brainexer.db.connection import Database  # noqa: E402


class BrainExerInvariantTests(unittest.TestCase):
    def test_tts_quota_stops_new_ai_generation_before_spending_tokens(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp") as directory:
            api = BrainExer("Test", {"ai_data_consent": True, "azure_data_consent": True,
                                     "azure_region": "southeastasia",
                                     "max_tts_chars_per_month": 0}, Path(directory))
            source = CardSource(1, 1, 1, "Hello", "Xin chào", "",
                                {"Front": "Hello", "Back": "Xin chào"})
            generated = []
            api.hub_ai_next = lambda *args: generated.append(1)
            with patch("nos_hub_invariant.brainexer_api.KeyringStore.get_api_key", return_value="key"):
                with self.assertRaisesRegex(ValueError, "giới hạn ký tự"):
                    api.listening_generate((DeckInfo(1, "English"), 1, [source]),
                                           "en-US-JennyNeural", "1")
            self.assertEqual(generated, [])

    def test_failed_azure_call_reuses_generated_sentence_without_new_ai_tokens(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp") as directory:
            api = BrainExer("Test", {"ai_data_consent": True, "azure_data_consent": True,
                                     "azure_region": "southeastasia"}, Path(directory))
            source = CardSource(1, 1, 1, "Hello", "Xin chào", "", {"Front": "Hello", "Back": "Xin chào"})
            prepared = (DeckInfo(1, "English"), 1, [source])
            generated = []
            def fake_ai(_prepared, _mode, _kind, _session_id=0, *, listening_difficulty):
                generated.append(listening_difficulty)
                store = HubStore(api.path)
                session = store.start(1, "English", "language", "listening")
                exercise = Database(api.path).insert_exercise(
                    session, "listening", "Hello world", {"listening_difficulty": listening_difficulty},
                    {"question_prompt": "Hello world", "target_words_to_use": ["Hello"],
                     "target_meaning": "Xin chào"},
                    "openai", "fake", "test", "",
                )
                return {"session_id": session, "question": {"id": exercise}}
            api.hub_ai_next = fake_ai
            with patch("nos_hub_invariant.brainexer_api.KeyringStore.get_api_key", return_value="key"), \
                 patch("nos_hub_invariant.brainexer_api.cached_audio",
                       side_effect=[ValueError("Azure timeout"), "a" * 64, "a" * 64]):
                with self.assertRaisesRegex(ValueError, "Azure timeout"):
                    api.listening_generate(prepared, "en-US-JennyNeural", "1", difficulty="easy")
                hard = api.listening_generate(prepared, "en-US-JennyNeural", "1", difficulty="hard")
                result = api.listening_generate(prepared, "en-US-JennyNeural", "1", difficulty="easy")
            self.assertEqual(generated, ["easy", "hard"])
            self.assertNotEqual(hard["exercise_id"], result["exercise_id"])
            self.assertEqual(result["audio_hash"], "a" * 64)

    def test_practice_game_and_mistake_review_leave_scheduler_untouched(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "tests/.tmp") as directory:
            root = Path(directory)
            col = Collection(str(root / "collection.anki2"))
            try:
                deck_id = col.decks.id("Science")
                for question, answer in (("What is mitosis?", "Cell division"),
                                         ("What is osmosis?", "Water diffusion"),
                                         ("What is gravity?", "Attraction"),
                                         ("What is synthesis?", "Combination")):
                    note = col.new_note(col.models.current())
                    note.fields[0], note.fields[1] = question, answer
                    col.add_note(note, deck_id)
                columns = {row[1] for row in col.db.all("PRAGMA table_info(cards)")}
                tracked = [name for name in ("id", "due", "ivl", "queue", "factor",
                                             "stability", "difficulty") if name in columns]
                def snapshot():
                    return (col.db.all("SELECT " + ",".join(tracked) + " FROM cards ORDER BY id"),
                            col.db.scalar("SELECT COUNT(*) FROM revlog"))
                original = snapshot()
                api = BrainExer("Test", {}, root)
                api.hub_kind("Science", "knowledge")
                prepared = api.prepare(col, deck_id, False, "multiple_choice")
                practice = api.hub_next(prepared, "multiple_choice", "knowledge")
                result = api.hub_answer(practice["question"]["id"], "wrong", "sure")
                self.assertFalse(result["correct"])
                self.assertEqual(snapshot(), original)
                store = HubStore(api.path)
                mistake = store.mistakes("Science")[0]
                due_day = date.today() + timedelta(days=1)
                review = store.review_question(deck_id, "Science", "knowledge", today=due_day)
                store.review_answer(mistake["id"], mistake["corrected_text"], due_day,
                                    exercise_id=review["question"]["exercise_id"])
                store.finish(review["session_id"])
                self.assertEqual(snapshot(), original)
                game = api.hub_next(prepared, "matching", "knowledge")
                chosen = [pair["right"] for pair in game["question"]["pairs"]]
                store.answer(game["question"]["id"], json.dumps(chosen))
                self.assertEqual(snapshot(), original)
                api.hub_set_fields("Science", "knowledge", "Back", "Front")
                self.assertEqual(api.hub_fields(prepared)["roles"]["question_field"], "Back")
                self.assertEqual(set(api.hub_field_names(col, deck_id, False)["fields"]),
                                 {"Front", "Back"})
                api.hub_next(prepared, "recall", "knowledge")
                preferred_id = col.find_cards('deck:"Science"')[0]
                ordered = api.prepare(col, deck_id, False, "listening_reflex", [preferred_id])
                self.assertEqual(ordered[2][0].card_id, preferred_id)
                self.assertEqual(snapshot(), original)
            finally:
                col.close()


if __name__ == "__main__":
    unittest.main()
