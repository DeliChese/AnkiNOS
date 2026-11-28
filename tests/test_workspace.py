"""Contextual notes remain independent of the removed study modes."""
import importlib
from pathlib import Path
import sys
import tempfile
import types
import unittest
ROOT=Path(__file__).resolve().parents[1]
pkg=types.ModuleType("nos_workspace_tests");pkg.__path__=[str(ROOT)];sys.modules[pkg.__name__]=pkg
Workspace=importlib.import_module(pkg.__name__+".workspace_store").WorkspaceStore

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'tests/.tmp').mkdir(exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'tests/.tmp');self.folder=Path(self.tmp.name)
        self.store=Workspace(self.folder/'workspace.sqlite3')

    def tearDown(self):self.tmp.cleanup()

    def test_notes_are_contextual_accent_insensitive_and_recoverable(self):
        identifier=self.store.save('a','deck1','Ngoại ngữ','Phân biệt nghĩa','Ghi chú không tự hết hạn',note_id='123')
        self.assertEqual(len(self.store.list('a','deck1',query='phan biet')),1)
        self.assertEqual(self.store.list('a','deck2'),[]);self.assertEqual(self.store.list('b','deck1'),[])
        self.assertEqual(self.store.get('a',identifier)['note_id'],'123')
        self.store.save('a','deck1','Ngoại ngữ','Changed','Nội dung mới',note_id='999',identifier=identifier)
        self.assertEqual(self.store.get('a',identifier)['note_id'],'123')
        with self.assertRaises(ValueError):self.store.save('b','deck1','Other','bad','cannot rebind',identifier=identifier)
        self.store.trash('b',identifier);self.assertIsNotNone(self.store.get('a',identifier))
        self.store.trash('a',identifier);self.assertEqual(self.store.list('a','deck1'),[])
        self.assertEqual(len(self.store.list('a','deck1',trash=True)),1)
        self.store.trash('a',identifier,True);self.assertEqual(len(self.store.list('a','deck1')),1)

    def test_bindings_do_not_share_between_collections_and_removal_preserves_notes(self):
        self.store.bind('a','1','resource')
        self.assertEqual(self.store.bindings('b','1'),set())
        self.assertEqual(self.store.bindings('a','1'),{'resource'})
        self.store.bind('a','1','resource',True);self.assertEqual(self.store.bindings('a','1'),set())

    def test_general_deckless_notes_and_optional_deck_reassignment(self):
        gid=self.store.save('a','','Ghi chú chung','Ý tưởng chung','Không gắn deck nào',allow_deck_change=True)
        self.assertEqual(len(self.store.list('a',None)),1)
        self.assertEqual(len(self.store.list('a','')),1)
        self.store.save('a','deck1','Tiếng Anh','Ý tưởng chung','Gắn deck tùy chọn',identifier=gid,allow_deck_change=True)
        self.assertEqual(self.store.get('a',gid)['deck_id'],'deck1')
        self.assertEqual(self.store.list('a',''),[])
        self.assertEqual(len(self.store.list('a','deck1')),1)
        with self.assertRaises(ValueError):
            self.store.save('b','deck1','Other','bad','cross-collection blocked',identifier=gid,allow_deck_change=True)

    def test_pin_color_tags_sort_and_duplicate(self):
        first=self.store.save('a','','Ghi chú chung','Beta note','Nội dung 1',pinned=False,color='blue',tags='#Ngữ pháp, dễ nhầm, ngữ pháp',allow_deck_change=True)
        second=self.store.save('a','','Ghi chú chung','Alpha note','Nội dung 2',pinned=True,color='mint',tags='ôn thi',allow_deck_change=True)
        row1=self.store.get('a',first)
        self.assertEqual(row1['color'],'blue')
        self.assertEqual(row1['tags'],'Ngữ pháp, dễ nhầm')
        # Pinned floats first
        listed=self.store.list('a',None)
        self.assertEqual([r['id'] for r in listed],[second,first])
        # Filter by color, pinned_only, and accent-insensitive tag search
        self.assertEqual([r['id'] for r in self.store.list('a',None,color='blue')],[first])
        self.assertEqual([r['id'] for r in self.store.list('a',None,pinned_only=True)],[second])
        self.assertEqual([r['id'] for r in self.store.list('a',None,query='de nham')],[first])
        # Toggle pin and duplicate
        self.assertTrue(self.store.toggle_pin('a',first))
        self.assertEqual(len(self.store.list('a',None,pinned_only=True)),2)
        copy_id=self.store.duplicate('a',first)
        copy=self.store.get('a',copy_id)
        self.assertIn('(Bản sao)',copy['title'])
        self.assertEqual(copy['color'],'blue')
        self.assertEqual(copy['pinned'],0)
        # Sort by title (pinned first, then title asc)
        self.assertEqual(self.store.list('a',None,sort='title')[0]['id'],second)

