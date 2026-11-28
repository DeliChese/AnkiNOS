"""Boot a separate offscreen Anki profile, never the user's collection."""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--disable-gpu"
os.environ["ANKI_SINGLE_INSTANCE_KEY"] = "nos-test-" + uuid.uuid4().hex
os.environ["ANKI_SOFTWAREOPENGL"] = "1"
if os.environ.get("NOS_ANKI_PACKAGES"):
    sys.path.insert(0, os.environ["NOS_ANKI_PACKAGES"])

import anki
from anki.lang import set_lang
import aqt
import aqt.update
from aqt.addons import AddonsDialog
from aqt.profiles import ProfileManager, VideoDriver
from aqt.qt import QEventLoop, QTimer

aqt.update.check_for_update = lambda: None


def wait(ms=100):
    loop = QEventLoop()
    QTimer.singleShot(ms, loop.quit)
    loop.exec()


def js(expression, view=None):
    results = []
    (view or aqt.mw.web).evalWithCallback(f"JSON.stringify(({expression}))", results.append)
    end = time.monotonic() + 5
    while not results and time.monotonic() < end:
        wait(25)
    assert results, "WebView did not respond: " + expression
    return json.loads(results[0]) if results[0] else None


def until(expression, view=None):
    end = time.monotonic() + 15
    while time.monotonic() < end:
        if js(expression,view):
            return
        wait(100)
    print("DOM diagnostic:", js("({title:document.title,body:document.body.innerText.slice(0,600),native:typeof pycmd,nos:typeof window.AnkiNOS})"), flush=True)
    raise AssertionError("Anki dashboard not ready: " + expression)


def main():
    base = ROOT / "tests" / ".tmp" / ("anki-" + uuid.uuid4().hex[:10])
    base.mkdir(parents=True)
    addon = base / "addons21" / "NOS"
    addon.mkdir(parents=True)
    for file in ("__init__.py", "integration.py", "i18n.py", "data.py", "graphs_data.py", "study_data.py", "backup_store.py", "theme_settings.py", "legacy_learning_backup.py", "legacy_brainexer_backup.py", "daily_scheduler.py", "daily_store.py", "daily_bridge.py", "media_store.py", "focus_store.py", "pomodoro_store.py", "pomodoro_ui.py", "reviewer_ui.py", "workspace_store.py", "study_tools_data.py", "study_tools_ui.py", "config.json", "manifest.json", "ankios-ui.html", "ankios-overview.html", "ankios-tools.html", "ankios-pomodoro.html"):
        shutil.copy2(ROOT / file, addon / file)
    shutil.copytree(ROOT / "assets", addon / "assets")
    set_lang("en_US")
    manager = ProfileManager(base)
    manager.setupMeta()
    manager.meta.update(defaultLang="en_US", firstRun=False, updates=False, suppressUpdate=True)
    manager.create("NOS Test")
    manager.load("NOS Test")
    manager.profile["autoSync"] = False
    manager.set_video_driver(VideoDriver.Software)
    manager.save()
    manager.db.close()
    app = aqt._run(["anki", "-b", str(base), "-p", "NOS Test", "-l", "en_US"], exec=False)
    # Assertions should terminate the test, not enter Anki's interactive pdb.
    sys.excepthook=sys.__excepthook__
    sys.stderr=sys.__stderr__
    assert app is not None
    end = time.monotonic() + 15
    while time.monotonic() < end and not (aqt.mw and aqt.mw.col):
        wait()
    assert aqt.mw.col is not None
    from NOS import integration
    from types import SimpleNamespace
    heatmap_calls=[]
    aqt.mw._review_heatmap=SimpleNamespace(render_for_view=lambda view,*a,**kw:heatmap_calls.append(view.name) or 'native heatmap')
    integration._guard_unused_heatmaps()
    assert aqt.mw._review_heatmap.render_for_view(SimpleNamespace(name='overview')) == ''
    assert heatmap_calls==[], "Do not compute heatmap data before discarding its HTML"
    assert aqt.mw._review_heatmap.render_for_view(SimpleNamespace(name='stats')) == 'native heatmap'
    # Fresh -l en_US profile must auto-detect English out of the box and show Welcome overlay.
    until("!!window.AnkiNOS && document.documentElement.lang === 'en' && document.getElementById('connection').textContent.includes('Anki collection')")
    assert js("!document.getElementById('welcome-overlay').hidden"), "First-run welcome overlay must appear on a new profile"
    js("document.getElementById('welcome-dismiss').click()")
    until("document.getElementById('welcome-overlay').hidden")
    assert aqt.mw.addonManager.getConfig("NOS")["profiles"][aqt.mw.pm.name].get("welcome_dismissed") is True
    # Switch explicitly to Vietnamese so the remaining Vietnamese smoke assertions verify explicit override too.
    integration.save_settings({"language": "vi"})
    integration.send("settings", integration.public_settings())
    until("document.documentElement.lang === 'vi' && document.getElementById('connection').textContent.includes('Bộ sưu tập Anki')")
    js("document.querySelector('[data-action=addons]').click()")
    end = time.monotonic() + 5
    addon_dialog = aqt.mw.findChild(AddonsDialog)
    while addon_dialog is None and time.monotonic() < end:
        wait(25)
        addon_dialog = aqt.mw.findChild(AddonsDialog)
    assert addon_dialog is not None and addon_dialog.isVisible(), "Dashboard Add-ons button must open Anki's Add-ons dialog"
    addon_dialog.reject()
    assert js("document.getElementById('nos-app').dataset.layout") == "aurora"
    js("document.getElementById('layout-toggle').click()")
    js("document.querySelector('[data-layout-id=dock]').click()")
    until("document.getElementById('nos-app').dataset.layout === 'dock'")
    assert aqt.mw.addonManager.getConfig("NOS")["profiles"][aqt.mw.pm.name]["layout"] == "dock"
    js("window.__oldDeckBrowser = true")
    aqt.mw.moveToState("deckBrowser")
    until("!window.__oldDeckBrowser && window.NOSLayout && document.getElementById('nos-app').dataset.layout === 'dock'")
    until("!!window.AnkiNOS.getSnapshot()")
    js("document.getElementById('appearance-toggle').click()")
    js("document.querySelector('[data-settings-tab=layout]').click()")
    js("document.querySelector('[data-layout-card=aurora]').click()")
    assert integration.settings()["layout"] == "dock"
    js("document.querySelector('[data-settings-tab=colors]').click()")
    js("(()=>{const input=document.getElementById('role-primary');input.value='#f1c352';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()")
    js("document.getElementById('btn-apply-appearance').click()")
    until("document.getElementById('nos-app').dataset.layout === 'aurora'")
    assert aqt.mw.addonManager.getConfig("NOS")["profiles"][aqt.mw.pm.name]["layout"] == "aurora"
    assert integration.settings()["theme_overrides"] == {"primary": "#f1c352"}
    js("document.getElementById('appearance-close').click()")
    # An old import without a thumbnail must never decode its original in the
    # gallery's opening frame. Build its preview asynchronously and retain it.
    from aqt.qt import QImage
    from hashlib import sha256
    from NOS.media_store import profile_dir
    image_dir=profile_dir(integration.ROOT, aqt.mw.pm.name)
    image_dir.mkdir(parents=True,exist_ok=True)
    legacy_image_id='e'*32
    original=image_dir/(legacy_image_id+'.png')
    picture=QImage(1200,800,QImage.Format.Format_RGB32)
    picture.fill(0xFF557799)
    assert picture.save(str(original),'PNG')
    original_hash=sha256(original.read_bytes()).digest()
    integration.save_settings({'images':[{'id':legacy_image_id,'name':'Legacy photo','ext':'.png'}]})
    integration.send('settings',integration.public_settings())
    studio_open_ms=js("(()=>{window.__studioPage=document.getElementById('nos-app');const start=performance.now();window.NOSStudio.open();return performance.now()-start})()")
    js(f"(()=>{{document.querySelector('[data-photo-id=\"{legacy_image_id}\"]').click();return true}})()")
    source=js("document.getElementById('studio-preview-image').getAttribute('src')")
    assert not source or source.endswith('-thumb.png'), 'Never load a full-resolution original into Studio'
    until("document.querySelector('#studio-gallery img')?.getAttribute('src')?.endsWith('-thumb.png')")
    assert js("document.getElementById('studio-dialog').open && window.__studioPage===document.getElementById('nos-app')")
    thumbnail=QImage(str(image_dir/(legacy_image_id+'-thumb.png')))
    assert 0<max(thumbnail.width(),thumbnail.height())<=480
    assert sha256(original.read_bytes()).digest()==original_hash
    assert js("document.querySelector('#studio-gallery img').complete")
    js("(()=>{window.__studioTile=document.querySelector('#studio-gallery .nos-studio-tile');window.NOSStudio.close();window.NOSStudio.open();return true})()")
    assert js("window.__studioTile===document.querySelector('#studio-gallery .nos-studio-tile')")
    js("(()=>{window.NOSStudio.close();return true})()")
    integration.save_settings({'images':[]})
    integration.send('settings',integration.public_settings())
    # Redrawing twice within 2 seconds used to silently drop the second page's
    # snapshot, leaving its heatmap empty until the five-minute poll.
    redraw_times=[]
    due_calls=[]
    native_due_tree=aqt.mw.col.sched.deck_due_tree
    def counted_due_tree(*args, **kwargs):
        due_calls.append(1)
        return native_due_tree(*args, **kwargs)
    aqt.mw.col.sched.deck_due_tree=counted_due_tree
    for _ in range(2):
        due_calls.clear()
        started=time.perf_counter()
        loaded=[]
        def load_finished(ok):
            loaded.append(ok)
        aqt.mw.web.loadFinished.connect(load_finished)
        aqt.mw.moveToState('deckBrowser')
        end=time.monotonic()+5
        while not loaded and time.monotonic()<end:
            wait(10)
        aqt.mw.web.loadFinished.disconnect(load_finished)
        assert loaded and loaded[-1], 'Dashboard HTML did not finish loading'
        until("document.getElementById('heatmap')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('#heatmap .heat-cell').length >= 365")
        redraw_times.append(round((time.perf_counter()-started)*1000))
        assert len(due_calls)==1, 'Reuse the scheduler tree Anki already queried'
    aqt.mw.col.sched.deck_due_tree=native_due_tree
    assert max(redraw_times)<1800, redraw_times
    assert js("document.getElementById('profile-name').textContent") == "NOS Test"
    assert js("document.getElementById('stat-retention').textContent") == "—"
    assert not js("document.getElementById('page-footnote')?.textContent.includes('minh họa')")
    assert js("getComputedStyle(document.querySelector('.glass')).backdropFilter") != "none"
    assert not any(action.text().startswith("AnkiNOS") for action in aqt.mw.form.menuTools.actions())
    assert any(action.shortcut().toString() == "Ctrl+K" for action in aqt.mw.actions())
    wait(150)
    assert aqt.mw.toolbarWeb.isHidden(), "Native top bar must be hidden in AnkiNOS"
    assert aqt.mw.bottomWeb.isHidden(), "Native bottom bar must be hidden in AnkiNOS"
    # Asynchronous redraws must not bring duplicated bars back.
    aqt.mw.toolbarWeb.setVisible(True)
    aqt.mw.bottomWeb.setVisible(True)
    wait(100)
    assert aqt.mw.toolbarWeb.isHidden() and aqt.mw.bottomWeb.isHidden()
    aqt.mw.activateWindow()
    wait(50)
    integration.bridge((False,None),'nos:{"action":"fullscreen"}',aqt.mw.deckBrowser)
    wait(100)
    assert aqt.mw.isFullScreen(), "Dashboard fullscreen action must enter native fullscreen"
    assert js("document.getElementById('fullscreen-toggle').getAttribute('aria-pressed')") == "true"
    integration.bridge((False,None),'nos:{"action":"fullscreen"}',aqt.mw.deckBrowser)
    wait(100)
    assert not aqt.mw.isFullScreen()
    col = aqt.mw.col
    # Exercise the real deck creation dialog and asynchronous Anki operation.
    from aqt.qt import QComboBox, QDialog, QDialogButtonBox, QLabel, QLineEdit
    js("(()=>{document.getElementById('library-toggle').click();window.__livePage=document.getElementById('nos-app');return true})()")
    initial_deck_count = int(js("document.getElementById('count-decks').textContent"))
    def assert_live_page():
        assert js("window.__livePage === document.getElementById('nos-app')"), "Do not reload the dashboard after edits"
        assert js("document.getElementById('library-dialog').open"), "Keep the deck library open after edits"
        assert js("document.body.style.opacity !== '0.3'"), "Do not fade the dashboard while another window has focus"

    def create_deck(name, parent_id=None, cancel=False, choose_parent=None):
        before = len(col.decks.all_names_and_ids())
        selected_parent = choose_parent or parent_id
        full_name = (col.decks.name(selected_parent) + "::" if selected_parent else "") + name
        errors = []
        def fill_dialog():
            dialog = app.activeModalWidget()
            try:
                field = dialog.findChild(QLineEdit, "nos-deck-name")
                parents = dialog.findChild(QComboBox, "nos-deck-parent")
                assert parents.currentData() == (parent_id or 0)
                if choose_parent:
                    parents.setCurrentIndex(parents.findData(choose_parent))
                field.setText(name)
                buttons = dialog.findChild(QDialogButtonBox)
                button = QDialogButtonBox.StandardButton.Cancel if cancel else QDialogButtonBox.StandardButton.Ok
                buttons.button(button).click()
                if not cancel:
                    end = time.monotonic() + 5
                    while not col.decks.by_name(full_name) and time.monotonic() < end:
                        wait(25)
                    expected = len(col.decks.all_names_and_ids(skip_empty_default=True))
                    until(f"document.getElementById('count-decks').textContent === '{expected}'")
                    assert dialog.isVisible(), "Saving must not close the creation dialog"
                    assert field.text() == "", "Ready to create the next deck after saving"
                    assert dialog.findChild(QLabel, "nos-deck-status").text().endswith(full_name)
                    created = col.decks.by_name(full_name)
                    assert created and parents.findData(created["id"]) >= 0
                    assert_live_page()
            except Exception as error:
                errors.append(error)
            finally:
                dialog.reject()
        QTimer.singleShot(100, fill_dialog)
        command = {"action": "create_deck"}
        if parent_id:
            command["id"] = str(parent_id)
        integration.bridge((False, None), "nos:" + json.dumps(command), aqt.mw.deckBrowser)
        if errors:
            raise errors[0]
        end = time.monotonic() + 5
        while not cancel and not col.decks.by_name(full_name) and time.monotonic() < end:
            wait(25)
        if cancel:
            assert len(col.decks.all_names_and_ids()) == before
            return None
        created = col.decks.by_name(full_name)
        assert created, full_name
        return created["id"]

    created_root = create_deck("Created parent")
    created_child = create_deck("Created child", created_root)
    create_deck("Grandchild", created_child)
    create_deck("Cancelled child", created_root, cancel=True)
    create_deck("Chosen parent child", choose_parent=created_root)
    # Real collection operations must update in place while another window is open.
    from aqt.operations.deck import rename_deck, remove_decks
    from aqt.operations.note import add_note, update_note, remove_notes
    other_window = QDialog(aqt.mw)
    other_window.show()
    other_window.activateWindow()
    renamed = "Created parent::Renamed child"
    rename_deck(parent=other_window, deck_id=created_child, new_name=renamed).run_in_background()
    until(f"document.querySelector('.deck-name[data-id=\"{created_root}\"]').textContent === 'Created parent'")
    end = time.monotonic() + 5
    while not col.decks.by_name(renamed) and time.monotonic() < end:
        wait(25)
    js(f"(()=>{{document.querySelector('.deck-expand[data-id=\"{created_root}\"]').click();return true}})()")
    until(f"document.querySelector('.deck-name[data-id=\"{created_child}\"]')?.textContent === 'Renamed child'")
    assert_live_page()
    live_note = col.new_note(col.models.current())
    live_note.fields[0] = "Live edit test"
    add_note(parent=other_window, note=live_note, target_deck_id=created_child).run_in_background()
    until("document.getElementById('library-footer-copy').textContent.includes('1 thẻ')")
    assert_live_page()
    revision = integration._data_revision
    live_note.fields[0] = "Updated without closing the editor"
    update_note(parent=other_window, note=live_note).run_in_background()
    end = time.monotonic() + 5
    while (integration._data_revision == revision or integration._active_query or integration._refresh_timer.isActive()) and time.monotonic() < end:
        wait(25)
    assert col.get_note(live_note.id).fields[0] == live_note.fields[0]
    assert_live_page()
    remove_notes(parent=other_window, note_ids=[live_note.id]).run_in_background()
    until("document.getElementById('library-footer-copy').textContent.includes('0 thẻ')")
    assert_live_page()
    remove_decks(parent=other_window, deck_ids=[created_root], deck_name="Created parent").run_in_background()
    until(f"document.getElementById('count-decks').textContent === '{initial_deck_count}'")
    assert other_window.isVisible()
    assert_live_page()
    other_window.close()
    js("(()=>{document.querySelector('[data-action=close_library]').click();return true})()")
    # Use native undo for cleanup, so the remaining smoke test keeps its fixture.
    for _ in range(9):
        col.undo()
    did = col.decks.id("NOS Test::Real cards")
    note = col.new_note(col.models.current())
    note.fields[0] = "A disposable AnkiNOS test question"
    note.fields[1] = "Test answer"
    col.add_note(note, did)
    aqt.mw.moveToState("deckBrowser")
    until("document.getElementById('library-footer-copy')?.textContent.includes('1 thẻ')")
    # Statistics must reuse Anki's native Rust graph data, without opening a dialog.
    js("(()=>{document.getElementById('stats-toggle').click();return true})()")
    assert js("document.getElementById('stats-page').hidden") is False
    until("document.querySelectorAll('#stats-report .stats-native-card').length >= 11")
    assert not js("document.getElementById('stats-loading').textContent.includes('Không thể')")
    js("(()=>{const x=document.getElementById('stats-scope');x.value='collection';x.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
    until("document.getElementById('stats-metric-scope').textContent.includes('toàn bộ bộ sưu tập')")
    js("(()=>{const x=document.getElementById('stats-period');x.value='0';x.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
    until("document.getElementById('stats-metric-scope').textContent.includes('toàn bộ lịch sử')")
    until("document.querySelectorAll('#stats-report .stats-native-card').length >= 11")
    js("(()=>{document.querySelector('.rail-main [data-action=page][data-value=home]').click();return true})()")
    assert js("document.getElementById('stats-page').hidden") is True
    # Exercise settings over the actual native bridge and check disk-backed config.
    js("(()=>{document.querySelector('[data-action=collapse_activity]').click();return true})()")
    wait(150)
    assert integration.settings()["activity_collapsed"] is True
    js("(()=>{document.getElementById('profile-toggle').click();return true})()")
    assert js("document.getElementById('profile-panel').hidden") is False
    js("(()=>{document.querySelector('[data-action=theme]').click();return true})()")
    wait(150)
    assert integration.settings()["theme"] == "night"
    def legacy_heatmap(_overview, content):
        content.table += '<div id="legacy-overview-heatmap">Legacy heatmap</div>'
    aqt.gui_hooks.overview_will_render_content.append(legacy_heatmap)
    parent_id=col.decks.id('NOS Test')
    assert js("document.getElementById('library-dialog').open") is False
    js("(()=>{document.getElementById('library-toggle').click();return true})()")
    assert js("document.getElementById('library-dialog').open") is True
    assert not js("!!document.querySelector('[data-action=collapse_library]')")
    js(f"(()=>{{document.querySelector('.study-button[data-id=\"{parent_id}\"]').click();return true}})()")
    until("document.getElementById('overview-name')?.textContent === 'NOS Test'")
    until("!document.getElementById('overview-children-button').hidden")
    js("(()=>{document.getElementById('overview-children-button').click();return true})()")
    until("!!document.getElementById('library-dialog')?.open")
    assert js(f"document.getElementById('children-{parent_id}').hidden") is False
    assert js(f"!!document.querySelector('#children-{parent_id} .study-button[data-id=\"{did}\"]')")
    # Test a native action, collection selection, and an actual reviewer answer.
    overview_started=time.perf_counter()
    js(f"(()=>{{document.querySelector('#children-{parent_id} .study-button[data-id=\"{did}\"]').click();return true}})()")
    end = time.monotonic() + 10
    while aqt.mw.state != "overview" and time.monotonic() < end:
        wait()
    assert aqt.mw.state == "overview", "Study action did not select the deck"
    until("!!window.AnkiNOS && document.getElementById('overview-name')?.textContent === 'Real cards'")
    overview_ready_ms=round((time.perf_counter()-overview_started)*1000)
    assert js("!!document.getElementById('nos-overview-bootstrap')"), "Ship queue metadata with the HTML"
    integration._save_ui({"color_theme":"mononoke", "accent":"custom", "custom_accent":"#91b78a"})
    integration.send("settings", integration.public_settings())
    until("document.getElementById('nos-app').dataset.colorTheme === 'mononoke'")
    assert integration.settings()["custom_accent"] == "#91b78a"
    assert not js("document.getElementById('study').disabled")
    assert js("document.getElementById('overview-new').textContent") == "1"
    # The selected deck must also update without rebuilding its overview page.
    js("(()=>{window.__liveOverview=document.getElementById('nos-app');return true})()")
    overview_editor = QDialog(aqt.mw)
    overview_editor.show()
    overview_editor.activateWindow()
    extra_note = col.new_note(col.models.current())
    extra_note.fields[0] = "Live overview test"
    add_note(parent=overview_editor, note=extra_note, target_deck_id=did).run_in_background()
    until("document.getElementById('overview-total').textContent === '2 thẻ'")
    assert js("window.__liveOverview === document.getElementById('nos-app')")
    assert overview_editor.isVisible()
    remove_notes(parent=overview_editor, note_ids=[extra_note.id]).run_in_background()
    until("document.getElementById('overview-total').textContent === '1 thẻ'")
    assert js("window.__liveOverview === document.getElementById('nos-app')")
    assert overview_editor.isVisible()
    overview_editor.close()
    assert not js("!!document.getElementById('legacy-overview-heatmap')")
    assert aqt.mw.toolbarWeb.isHidden() and aqt.mw.bottomWeb.isHidden(), "Hide default bars on the selected-deck overview"
    js("(()=>{document.getElementById('overview-menu-toggle').click();return true})()")
    assert js("document.getElementById('overview-menu').hidden") is False
    js("(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()")
    assert js("document.getElementById('overview-menu').hidden") is True
    review_started=time.perf_counter()
    js("(()=>{document.getElementById('study').click();return true})()")
    end=time.monotonic()+10
    while aqt.mw.state != "review" and time.monotonic()<end:
        wait()
    assert aqt.mw.state=="review", "The overview's Học ngay must start Anki's real reviewer"
    assert aqt.mw.toolbarWeb.isHidden() and not aqt.mw.bottomWeb.isHidden(), "Use the review header and keep native rating controls"
    until("typeof _showQuestion === 'function' && !!document.getElementById('qa')")
    until("!!window.NOSReview && document.getElementById('qa').textContent.includes('disposable AnkiNOS')")
    assert js("document.getElementById('nos-review-shell').dataset.colorTheme") == "mononoke"
    assert js("document.getElementById('nos-review-header').style.getPropertyValue('--primary')") == "#f1c352"
    # Custom UI text color must theme the Reviewer header without touching #qa card text color.
    qa_color_before = js("getComputedStyle(document.getElementById('qa')).color")
    js("window.NOSTheme.apply(document.getElementById('nos-review-shell'), {theme:'night', color_theme:'mononoke', accent:'auto', text_color:'custom', custom_text_color:'#ff88bb'}, true)")
    assert js("getComputedStyle(document.getElementById('nos-review-header')).color") == "rgb(255, 136, 187)"
    assert js("getComputedStyle(document.getElementById('qa')).color") == qa_color_before, "Custom UI text color must NEVER alter #qa flashcard text color"
    assert js("getComputedStyle(document.getElementById('qa')).getPropertyValue('--text').trim()") == "", "AnkiNOS --text must not leak into #qa"
    js("window.NOSTheme.apply(document.getElementById('nos-review-shell'), {theme:'dusk', color_theme:'mononoke', accent:'custom', custom_accent:'#91b78a'}, true)")
    review_ready_ms=round((time.perf_counter()-review_started)*1000)
    wait(150)
    assert aqt.mw.reviewer.card is not None
    bottom=aqt.mw.bottomWeb
    until("!!document.getElementById('ansbut')",bottom)
    assert js("document.documentElement.dataset.colorTheme",bottom) == "mononoke"
    assert js("document.documentElement.dataset.nosRatings",bottom) == "true"
    # Even when Anki's own locale is en_US, Reviewer header and bottom bar must match AnkiNOS's active language (vi here).
    assert js("document.querySelector('#nos-review-header .nos-back-label')?.textContent?.trim()") == "Bộ thẻ"
    assert js("document.getElementById('nos-review-side')?.textContent?.trim()") == "Mặt trước"
    assert js("Array.from(document.getElementById('ansbut').childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join('')", bottom) == "Hiện đáp án"
    assert js("Array.from(document.querySelector('button[onclick*=\"edit\"]').childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join('')", bottom) == "Sửa"
    assert js("Array.from(document.querySelector('button[onclick*=\"more\"]').childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join('')", bottom) == "Thêm ⋯"
    flip_started=time.perf_counter()
    js("(()=>{document.getElementById('ansbut').click();return true})()",bottom)
    until("document.getElementById('qa').textContent.includes('Test answer')")
    until("document.querySelectorAll('button[data-ease]').length === 4",bottom)
    flip_ready_ms=round((time.perf_counter()-flip_started)*1000)
    assert js("window.qFade") == 0
    assert js("document.getElementById('nos-review-card').getAnimations().length") == 0
    assert js("getComputedStyle(document.getElementById('nos-review-card')).opacity") == '1'
    assert js("document.querySelector('[data-ease=\"3\"]').hasAttribute('data-nos-ready')",bottom)
    assert js("document.querySelector('[data-ease=\"3\"]').getAttribute('onclick').includes('ease3')",bottom)
    assert js("Array.from(document.querySelectorAll('button[data-ease]')).map(b=>Array.from(b.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join(''))", bottom) == ["Quên", "Khó", "Tốt", "Dễ"]
    # Verify live language switch in Reviewer + BottomBar to zh-cn, en, and back to vi without touching #qa.
    js("window.NOSReview.setLanguage('zh-cn')")
    js("window.NOSRatings.setLanguage('zh-cn')", bottom)
    assert js("document.getElementById('nos-review-side')?.textContent?.trim()") == "答案"
    assert js("!!document.getElementById('nos-pomo-chip')")
    assert js("Array.from(document.querySelectorAll('button[data-ease]')).map(b=>Array.from(b.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join(''))", bottom) == ["重来", "困难", "良好", "简单"]
    assert js("document.getElementById('qa').textContent.includes('Test answer')")
    js("window.NOSReview.setLanguage('en')")
    js("window.NOSRatings.setLanguage('en')", bottom)
    assert js("document.getElementById('nos-review-side')?.textContent?.trim()") == "Answer"
    assert js("Array.from(document.querySelectorAll('button[data-ease]')).map(b=>Array.from(b.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join(''))", bottom) == ["Again", "Hard", "Good", "Easy"]
    js("window.NOSReview.setLanguage('vi')")
    js("window.NOSRatings.setLanguage('vi')", bottom)
    assert js("""Array.from(document.querySelectorAll('button[data-ease]')).every(btn => {
      const span = btn.querySelector('.nobold');
      if (!span || !span.textContent.trim()) return false;
      const b = btn.getBoundingClientRect(), s = span.getBoundingClientRect();
      return s.height > 0 && s.top >= b.top - 1 && s.bottom <= b.bottom + 1 && s.left >= b.left - 1 && s.right <= b.right + 1;
    })""", bottom), "Native due interval labels (.nobold) must be visible inside rating buttons and never clipped"
    assert js("getComputedStyle(document.querySelector('[data-ease=\"1\"]')).color !== getComputedStyle(document.querySelector('[data-ease=\"4\"]')).color",bottom)
    assert js("document.getElementById('nos-review-side').textContent") == "Đáp án"
    js("(()=>{document.querySelector('[data-ease=\"3\"]').click();return true})()",bottom)
    wait(800)
    aqt.mw.moveToState("deckBrowser")
    until("!!window.AnkiNOS && document.getElementById('stat-studied')?.textContent.includes('1 lượt')")
    assert js("document.getElementById('activity-panel').classList.contains('collapsed')")
    assert js("document.getElementById('nos-app').dataset.theme") == "night"
    from datetime import datetime
    archive_id=int((time.time()-1000*86400)*1000)
    col.db.execute('INSERT INTO revlog VALUES (?,?,0,3,1,1,2500,10000,1)',archive_id,aqt.mw.reviewer.card.id if aqt.mw.reviewer.card else col.find_cards(f'nid:{note.id}')[0])
    integration.bridge((False,None),'nos:{"action":"snapshot","force":true}',aqt.mw.deckBrowser)
    archive_year=datetime.fromtimestamp(archive_id/1000-4*3600).year
    until("!document.querySelector('[data-action=year][data-value=\"-1\"]').disabled")
    while int(js("document.getElementById('heatmap-year').textContent"))>archive_year:
        js("(()=>{document.querySelector('[data-action=year][data-value=\"-1\"]').click();return true})()")
    until("document.getElementById('heatmap').getAttribute('aria-busy') === 'false'")
    assert js("document.querySelectorAll('#heatmap .heat-cell[data-tooltip*=\"1 lượt ôn\"]').length") == 1
    # The native bridge must keep archive data on its real calendar date when
    # switching from annual to monthly view and moving between months.
    archive_date=datetime.fromtimestamp(archive_id/1000-4*3600)
    js("(()=>{document.querySelector('[data-action=period][data-value=month]').click();return true})()")
    js(f"(()=>{{const s=document.getElementById('heatmap-month-select');s.value='{archive_date.month-1}';s.dispatchEvent(new Event('change',{{bubbles:true}}));return true}})()")
    assert js(f"!!document.querySelector('#heatmap .heat-cell[data-date=\"{archive_date:%Y-%m-%d}\"][data-tooltip*=\"1 lượt ôn\"]')")
    js("(()=>{document.querySelector('[data-action=year][data-value=\"1\"]').click();return true})()")
    assert js("document.getElementById('heatmap-month-select').value") == str(archive_date.month % 12)
    js("(()=>{document.querySelector('[data-action=year][data-value=\"-1\"]').click();return true})()")
    assert js(f"!!document.querySelector('#heatmap .heat-cell[data-date=\"{archive_date:%Y-%m-%d}\"]')")
    empty_id=col.decks.id("NOS Test::Empty")
    integration.bridge((False,None),'nos:'+json.dumps({"action":"study","id":str(empty_id)}),aqt.mw.deckBrowser)
    end=time.monotonic()+10
    while (aqt.mw.state!="overview" or not integration._overview_rendered) and time.monotonic()<end:
        wait()
    until("document.getElementById('nos-app')?.dataset.overviewState === 'completed' && !document.getElementById('overview-complete-banner')?.hidden && !document.getElementById('overview-complete-actions')?.hidden")
    assert integration._overview_rendered, "Completed deck must render AnkiNOS celebratory overview"
    aqt.mw.moveToState("deckBrowser")
    until("!!window.AnkiNOS && !!document.getElementById('library-panel')")
    # Exercise both cancellation and confirmed removal, then Anki Undo, only
    # against disposable test decks.
    deletion_id=col.decks.id('Delete test::Child')
    deletion_parent=col.decks.id('Delete test')
    deletion_note=col.new_note(col.models.current())
    deletion_note.fields[0]='Disposable deletion card'
    deletion_note.fields[1]='Answer'
    col.add_note(deletion_note,deletion_id)
    prompts=[]
    original_ask=integration.askUser
    integration.askUser=lambda message,**kw: prompts.append(message) or False
    integration._delete_deck(deletion_parent)
    end=time.monotonic()+5
    while not prompts and time.monotonic()<end:wait(30)
    assert col.decks.get(deletion_parent,default=False) is not None
    integration.askUser=lambda message,**kw: True
    integration._delete_deck(deletion_parent)
    end=time.monotonic()+5
    while col.decks.get(deletion_parent,default=False) and time.monotonic()<end:wait(30)
    assert col.decks.get(deletion_parent,default=False) is None
    assert col.decks.get(deletion_id,default=False) is None
    end=time.monotonic()+5
    while aqt.mw._background_op_count and time.monotonic()<end:wait(30)
    until("!!window.AnkiNOS && !!document.getElementById('library-panel')")
    from aqt.operations.collection import undo
    undo(parent=aqt.mw)
    end=time.monotonic()+5
    while (aqt.mw._background_op_count or col.decks.get(deletion_id,default=False) is None) and time.monotonic()<end:wait(30)
    assert col.decks.get(deletion_id,default=False) is not None
    integration.askUser=original_ask
    until("!!window.AnkiNOS && !!document.getElementById('library-panel')")
    # One click from the dashboard must enter the real reviewer with Focus.
    launch_id = col.decks.id("Launchpad test")
    for index in range(3):
        launch_note = col.new_note(col.models.current())
        launch_note.fields[0] = "Launchpad question " + str(index)
        launch_note.fields[1] = "Real scheduler answer"
        col.add_note(launch_note, launch_id)
    integration.save_settings({"last_study_deck": str(launch_id), "pomodoro": {"mode": "classic", "ui_mode": "pill"}})
    aqt.mw.moveToState("deckBrowser")
    until(f"document.querySelector('#study-deck option[value=\"{launch_id}\"]') !== null")
    js(f"(()=>{{const x=document.getElementById('study-deck');x.value='{launch_id}';x.dispatchEvent(new Event('change'));document.getElementById('study-focus').click();return true}})()")
    until("!!window.NOSReview && !!window.NOSPomodoro && !!document.getElementById('qa')")
    assert aqt.mw.state == "review"
    from NOS import pomodoro_ui
    assert pomodoro_ui.pomodoro_store().status()["active"]
    assert pomodoro_ui.pomodoro_store().status()["target_seconds"] == 1500
    assert integration.settings()["last_study_deck"] == str(launch_id)
    pomodoro_ui.pomodoro_store().resume()
    before = pomodoro_ui.pomodoro_store().cards
    aqt.mw.reviewer._showAnswer()
    aqt.mw.reviewer._answerCard(3)
    end = time.monotonic() + 5
    while pomodoro_ui.pomodoro_store().cards == before and time.monotonic() < end:
        wait(30)
    assert pomodoro_ui.pomodoro_store().cards == before + 1
    # Verify live reviewer bottom card counts match col.sched.counts() after answering.
    expected_counts = list(col.sched.counts())
    def bottom_js(code):
        box = []
        aqt.mw.bottomWeb.evalWithCallback(code, lambda v: box.append(v))
        deadline = time.monotonic() + 5
        while not box and time.monotonic() < deadline:
            wait(20)
        return box[0] if box else None
    end = time.monotonic() + 5
    live_counts = None
    while time.monotonic() < end:
        live_counts = bottom_js("(() => { const el = document.querySelector('#ansbut .stattxt'); if (!el) return null; return ['.new-count','.learn-count','.review-count'].map(s => Number((el.querySelector(s)?.textContent || '').replace(/\\D+/g, '') || 0)); })()")
        if live_counts == expected_counts:
            break
        wait(40)
    assert live_counts == expected_counts, f"Reviewer bottom counts {live_counts} != real sched counts {expected_counts}"
    js("""(() => {
        window.__pomoPlays = [];
        const original = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
            original.call(this, when, offset, duration);
            window.__pomoPlays.push([offset, duration]);
        };
        window.NOSPomodoro.playAlert('study');
    })()""")
    until("window.__pomoPlays.length === 1")
    assert 14 < js("window.__pomoPlays[0][1]") <= 15
    js("window.NOSPomodoro.playAlert('break')")
    until("window.__pomoPlays.length === 2")
    assert 9 < js("window.__pomoPlays[1][1]") < 10
    js("document.getElementById('nos-pomo-chip').click()")
    with patch.object(pomodoro_ui.QFileDialog, "getOpenFileName", return_value=(str(addon / "assets" / "afterrest.mp3"), "")):
        js("document.querySelector('[data-pomo-op=pick_sound][data-pomo-slot=study]').click()")
        until("document.querySelector('.nos-pomo-trim').open")
    until("!document.querySelector('[data-trim-action=save]').disabled")
    js("""(() => {
        for (const [id, value] of [['start', 1200], ['duration', 2400]]) {
            const input = document.getElementById('nos-pomo-trim-' + id);
            input.value = value;
            input.dispatchEvent(new Event('input', {bubbles: true}));
        }
        document.querySelector('[data-trim-action=save]').click();
    })()""")
    until("window.NOSPomodoro.getConfig().custom_study_sound.duration_ms === 2400")
    saved_clip = integration.settings()["pomodoro"]["custom_study_sound"]
    assert saved_clip["start_ms"] == 1200 and saved_clip["duration_ms"] == 2400
    js("window.NOSPomodoro.close()")
    pomodoro_ui.pomodoro_store().elapsed = 1500
    pomodoro_ui.pomodoro_store().running_since = time.monotonic()
    pomodoro_ui._tick()
    until("!document.getElementById('nos-pomo-banner').hidden")
    until("window.__pomoPlays.length === 3")
    assert js("window.__pomoPlays[2]") == [1.2, 2.4]
    assert js("document.getElementById('nos-pomo-banner').textContent.includes('1 lượt ôn')")
    assert not pomodoro_ui.pomodoro_store().status()["active"]
    aqt.mw.moveToState("deckBrowser")
    until("!!window.NOSStudy && !document.getElementById('study-now').disabled")
    # Exercise the production async export/preview/restore bridge on this profile.
    backup_path = base / "profile.nosbackup"
    integration.save_settings({"theme": "night", "layout": "bento"})
    with patch.object(integration.QFileDialog, "getSaveFileName", return_value=(str(backup_path), "")):
        integration._backup_export()
        end = time.monotonic() + 10
        while integration._backup_busy and time.monotonic() < end:
            wait(30)
    assert backup_path.is_file() and not integration._backup_busy
    integration.save_settings({"theme": "light", "layout": "dock"})
    with patch.object(integration.QFileDialog, "getOpenFileName", return_value=(str(backup_path), "")), patch.object(integration, "askUser", return_value=False):
        integration._backup_restore()
        end = time.monotonic() + 10
        while integration._backup_busy and time.monotonic() < end:
            wait(30)
    assert integration.settings()["theme"] == "light", "Cancelling preview must not change settings"
    assert integration.settings()["layout"] == "dock"
    with patch.object(integration.QFileDialog, "getOpenFileName", return_value=(str(backup_path), "")), patch.object(integration, "askUser", return_value=True):
        integration._backup_restore()
        end = time.monotonic() + 10
        while integration._backup_busy and time.monotonic() < end:
            wait(30)
    assert not integration._backup_busy
    assert integration.settings()["theme"] == "night"
    assert integration.settings()["layout"] == "bento"
    until("document.getElementById('nos-app').dataset.layout === 'bento'")
    assert pomodoro_ui.pomodoro_store().analytics(period="week")["summary"]["completed_sessions"] >= 1
    assert list((integration.ROOT / "user_files/backups").glob("before-restore-*.nosbackup"))
    # Failed rendering restores native content, and explicit re-enable recovers.
    with patch.object(integration, "showWarning"):
        integration._fallback(RuntimeError("Injected rendering error on disposable profile"))
        until("!document.getElementById('nos-app') && !!document.getElementById('studiedToday')")
    assert not aqt.mw.toolbarWeb.isHidden() and not aqt.mw.bottomWeb.isHidden()
    integration._toggle(True)
    until("!!window.NOSStudy")
    # The native deck browser can be restored without disabling the add-on,
    # and provides an unmistakable one-click return button back to AnkiNOS.
    integration._toggle(False)
    until("!document.getElementById('nos-app') && !!document.getElementById('studiedToday') && !!document.getElementById('nos-return-btn')")
    assert not aqt.mw.toolbarWeb.isHidden() and not aqt.mw.bottomWeb.isHidden()
    assert not any(action.text().startswith("AnkiNOS") for action in aqt.mw.form.menuTools.actions())
    from aqt import utils as aqt_utils
    with patch.object(aqt_utils, "showInfo") as info, patch.object(integration.QFileDialog, "getSaveFileName", return_value=(str(base / "native-mode.nosbackup"), "")):
        integration._compatibility()
        assert "Anki " in info.call_args.args[0]
        integration._backup_export()
        end = time.monotonic() + 10
        while integration._backup_busy and time.monotonic() < end:
            wait(30)
        assert (base / "native-mode.nosbackup").is_file()
        assert "sao lưu" in info.call_args.args[0]
    js("(() => { document.getElementById('nos-return-btn').click(); return true; })()")
    until("!!window.AnkiNOS && document.getElementById('connection')?.textContent.includes('Bộ sưu tập Anki')")
    # Live multilingual switch (vi -> en -> zh-cn -> vi) across WebView and native Qt helper.
    integration.save_settings({"language": "en"})
    integration.send("settings", integration.public_settings())
    until("document.documentElement.lang === 'en' && document.getElementById('connection')?.textContent.includes('Anki collection')")
    assert integration._t("AnkiNOS — Lệnh nhanh") == "AnkiNOS — Quick Commands"
    integration.save_settings({"language": "zh-cn"})
    integration.send("settings", integration.public_settings())
    until("document.documentElement.lang === 'zh-cn' && document.getElementById('connection')?.textContent.includes('Anki 集合')")
    assert integration._t("AnkiNOS — Lệnh nhanh") == "AnkiNOS — 快捷命令"
    integration.save_settings({"theme":"dusk", "layout":"aurora", "language":"vi", "activity_collapsed":False})
    integration.send("settings",integration.public_settings())
    until("document.documentElement.lang === 'vi'")
    aqt.mw.setGeometry(0,0,1440,1000)
    aqt.mw.layout().activate()
    wait(1500)
    print("Viewport:", js("({width:innerWidth,height:innerHeight,scale:devicePixelRatio,app:document.getElementById('nos-app').getBoundingClientRect().width,columns:getComputedStyle(document.querySelector('.stats-grid')).gridTemplateColumns,small:matchMedia('(max-width:720px)').matches})"), flush=True)
    (ROOT / "previews").mkdir(exist_ok=True)
    report = {"anki":anki.version,"addon_loaded":True,"native_bridge":True,"real_collection":True,
              "real_reviewer_answer":True,"persisted_preferences":True,"restore_native_deck_browser":True,
              "dashboard_hides_native_bars":True,"native_review_controls_preserved":True}
    report["native_fullscreen"] = True
    report.update(selected_deck_glass_overview=True,overview_heatmap_removed=True,
                  overview_menu_hidden=True,overview_starts_real_reviewer=True,completion_controls_preserved=True)
    report.update(review_chrome_and_native_ratings=True,delete_cancel_confirm_undo=True,
                  skipped_unused_heatmap_computation=True,overview_ready_ms=overview_ready_ms,review_ready_ms=review_ready_ms)
    report.update(anchored_library_popup=True,parent_to_child_navigation=True,studied_child_separately=True)
    report.update(native_flip_and_ratings_ms=flip_ready_ms,full_card_animation_removed=True)
    report.update(rapid_dashboard_redraw_ms=redraw_times,heatmap_present_after_navigation=True)
    report.update(native_scheduler_queried_once=True,archive_heatmap_loaded_via_native_bridge=True,
                  native_graphs_inline_and_scoped=True,statistics_no_legacy_popup=True)
    report.update(create_deck_with_parent=True,create_nested_subdeck=True,create_deck_cancel=True)
    report.update(live_deck_and_note_edits=True,library_stays_open_after_edits=True,
                  create_dialog_stays_open_after_save=True,overview_updates_without_reload=True)
    report.update(calendar_archive_month_navigation=True)
    report.update(shared_profile_theme=True,custom_accent_persisted=True,themed_reviewer_and_native_ratings=True)
    report.update(dashboard_to_native_focus=True,focus_30_minutes=True,focus_summary=True,
        full_backup_roundtrip=True,restore_cancel_preserves_settings=True,restore_creates_recovery=True,
        automatic_native_fallback=True)
    report.update(tools_menu_without_ankinos=True,command_shortcut_registered=True,
                  backup_available_in_native_mode=True,compatibility_report=True)
    report.update(studio_first_open_js_ms=round(studio_open_ms),studio_legacy_preview_in_background=True,studio_reuses_thumbnails=True)
    (ROOT / "previews" / "anki-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print("PASS: " + json.dumps(report),flush=True)
    aqt.mw.unloadProfileAndExit()
    app.exec()


if __name__ == "__main__":
    main()
