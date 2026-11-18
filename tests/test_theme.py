"""Appearance validation at the persistence boundary; no Qt required."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("nos_theme_test", Path(__file__).resolve().parents[1] / "theme_settings.py")
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)


class ThemeTests(unittest.TestCase):
    def test_current_preferences_remain_compatible(self):
        for mode in ("dusk", "night", "oled", "light"):
            self.assertEqual(theme.clean_theme_settings({"theme": mode, "accent": "blue"}), {"theme": mode, "accent": "blue"})

    def test_custom_and_automatic_colors_survive_validation(self):
        self.assertEqual(theme.clean_theme_settings({"theme": "system", "color_theme": "rosepine", "accent": "custom", "custom_accent": "#Ab12CD"}),
                         {"theme": "system", "color_theme": "rosepine", "accent": "custom", "custom_accent": "#ab12cd"})
        for palette in theme.COLOR_THEMES:
            self.assertEqual(theme.clean_theme_settings({"color_theme": palette, "accent": "auto"}), {"color_theme": palette, "accent": "auto"})

    def test_malformed_webview_or_import_data_is_ignored(self):
        for value in (None, [], {}, 42, False, "unknown", "url(https://example.com)"):
            self.assertEqual(theme.clean_theme_settings({key: value for key in theme.THEME_DEFAULTS}), {})
        for color in ("red", "#abc", "#11223344", "#123456; color:red", "#gg1122"):
            self.assertEqual(theme.clean_theme_settings({"custom_accent": color}), {})


if __name__ == "__main__":
    unittest.main()
