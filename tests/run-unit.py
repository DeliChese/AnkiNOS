"""Run the unit suite with all temporary files inside the disposable test area."""
from pathlib import Path
import tempfile
import unittest

root = Path(__file__).resolve().parents[1]
scratch = root / "tests" / ".tmp"
scratch.mkdir(exist_ok=True)
tempfile.tempdir = str(scratch)
suite = unittest.defaultTestLoader.discover(str(root / "tests"), pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(not result.wasSuccessful())
