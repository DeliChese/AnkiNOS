"""Boot a separate offscreen Anki profile, never the user's collection."""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

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
    for file in ("__init__.py", "integration.py", "data.py", "reviewer_ui.py", "config.json", "manifest.json", "ankios-ui.html", "ankios-overview.html"):
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
    until("!!window.AnkiNOS && document.getElementById('connection').textContent.includes('Bộ sưu tập Anki')")
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
    assert not js("document.getElementById('page-footnote').textContent.includes('minh họa')")
    assert js("getComputedStyle(document.querySelector('.glass')).backdropFilter") != "none"
    assert integration._toggle_action in aqt.mw.form.menuTools.actions()
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
    did = col.decks.id("NOS Test::Real cards")
    note = col.new_note(col.models.current())
    note.fields[0] = "A disposable AnkiNOS test question"
    note.fields[1] = "Test answer"
    col.add_note(note, did)
    aqt.mw.moveToState("deckBrowser")
    until("document.getElementById('library-footer-copy')?.textContent.includes('1 thẻ')")
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
    assert not js("document.getElementById('study').disabled")
    assert js("document.getElementById('overview-new').textContent") == "1"
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
    review_ready_ms=round((time.perf_counter()-review_started)*1000)
    wait(150)
    assert aqt.mw.reviewer.card is not None
    bottom=aqt.mw.bottomWeb
    until("!!document.getElementById('ansbut')",bottom)
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
    empty_id=col.decks.id("NOS Test::Empty")
    integration.bridge((False,None),'nos:'+json.dumps({"action":"study","id":str(empty_id)}),aqt.mw.deckBrowser)
    end=time.monotonic()+10
    while (aqt.mw.state!="overview" or integration._overview_rendered) and time.monotonic()<end:
        wait()
    wait(400)
    assert not integration._overview_rendered
    assert not aqt.mw.toolbarWeb.isHidden() and not aqt.mw.bottomWeb.isHidden(), "Keep native completion-page controls available"
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
    # The native deck browser can be restored without disabling the add-on.
    integration._toggle(False)
    until("!document.getElementById('nos-app') && !!document.getElementById('studiedToday')")
    assert not aqt.mw.toolbarWeb.isHidden() and not aqt.mw.bottomWeb.isHidden()
    integration._toggle(True)
    until("!!window.AnkiNOS && document.getElementById('connection')?.textContent.includes('Bộ sưu tập Anki')")
    integration.save_settings({"theme":"dusk", "activity_collapsed":False})
    integration.send("settings",integration.settings())
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
    report.update(native_scheduler_queried_once=True,archive_heatmap_loaded_via_native_bridge=True)
    (ROOT / "previews" / "anki-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print("PASS: " + json.dumps(report),flush=True)
    aqt.mw.unloadProfileAndExit()
    app.exec()


if __name__ == "__main__":
    main()
