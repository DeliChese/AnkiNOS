"""Focus Mode storage regression tests, runnable without Anki or Qt.

python -m unittest discover -s tests -p 'test_focus.py'
"""
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
package=types.ModuleType("nos_focus_test")
package.__path__=[str(ROOT)]
sys.modules[package.__name__]=package
for name in ("media_store","focus_store"):
    spec=importlib.util.spec_from_file_location(package.__name__+"."+name,ROOT/(name+".py"))
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
focus=sys.modules[package.__name__+".focus_store"]


class FocusModeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.clock=[100.0]
        self.patch=patch.object(focus.time,"monotonic",side_effect=lambda:self.clock[0])
        self.patch.start()
        self.store=focus.FocusStore(self.root,"Personal")

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_pause_resume_tracks_only_active_time(self):
        self.store.start(5)
        self.clock[0]+=90
        self.store.answer()
        self.store.pause()
        self.clock[0]+=300
        self.assertEqual(self.store.status()["seconds"],90)
        self.store.resume()
        self.clock[0]+=30
        self.store.stop()
        result=self.store.history()
        self.assertEqual(result["total_sessions"],1)
        self.assertEqual(result["total_seconds"],120)
        self.assertEqual(result["total_cards"],1)

    def test_auto_completion_and_reopened_history(self):
        self.store.start(5)
        self.clock[0]+=301
        self.store.checkpoint()
        self.assertFalse(self.store.status()["active"])
        reopened=focus.FocusStore(self.root,"Personal")
        result=reopened.history()
        self.assertEqual(result["completed_sessions"],1)
        self.assertEqual(result["total_seconds"],300)

    def test_profiles_are_isolated(self):
        self.store.start(5)
        self.clock[0]+=60
        self.store.stop()
        other=focus.FocusStore(self.root,"Other")
        self.assertEqual(other.history()["total_sessions"],0)
        self.assertEqual(self.store.history()["total_sessions"],1)

    def test_crash_recovery_keeps_checkpoint_not_offline_time(self):
        self.store.start(5)
        self.clock[0]+=40
        self.store.checkpoint()
        self.clock[0]+=999
        reopened=focus.FocusStore(self.root,"Personal")
        result=reopened.history()
        self.assertEqual(result["total_sessions"],1)
        self.assertEqual(result["total_seconds"],40)
        self.assertEqual(result["sessions"][0]["status"],"interrupted")

    def test_reject_invalid_duration(self):
        for minutes in (0,-1,200,True,"25"):
            with self.assertRaises(ValueError):
                self.store.start(minutes)


if __name__=="__main__":
    unittest.main()
