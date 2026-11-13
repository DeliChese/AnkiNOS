"""Time collection reads on synthetic history; never opens a user's profile."""
import importlib.util
import inspect
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from anki.collection import Collection
from anki.lang import set_lang

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('nos_data',ROOT/'data.py')
data=importlib.util.module_from_spec(spec);spec.loader.exec_module(data)
set_lang('en_US')
scratch=ROOT/'tests'/'.tmp'/('data-perf-'+uuid.uuid4().hex)
scratch.mkdir(parents=True)
col=Collection(str(scratch/'collection.anki2'))
try:
    did=col.decks.id('Performance')
    note=col.new_note(col.models.current());note.fields[:]=['Question','Answer'];col.add_note(note,did)
    cid=col.find_cards(f'nid:{note.id}')[0]
    columns=[row[1] for row in col.db.all('PRAGMA table_info(cards)')]
    projection=','.join('c.id+seq.x' if field=='id' else 'c.'+field for field in columns)
    col.db.execute(f'WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<19999) INSERT INTO cards SELECT {projection} FROM cards c,seq WHERE c.id=?',cid)
    cutoff=col.sched.day_cutoff
    start=(cutoff-2000*86400)*1000
    step=(2000*86400*1000)//600000
    col.db.execute('WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<600000) INSERT INTO revlog SELECT ?+x*?,?+(x%20000),0,3,1,1,2500,10000,1 FROM seq',start,step,cid)
    tree=col.sched.deck_due_tree()
    optimized='due_tree' in inspect.signature(data.collect_snapshot).parameters
    def collect(revision,review_only=False):
        args={'due_tree':tree,'revision':revision,'review_only':review_only} if optimized else {}
        started=time.perf_counter();out=data.collect_snapshot(col,**args)
        return round((time.perf_counter()-started)*1000,1),out
    cold,out=collect(0)
    warm,_=collect(0)
    # A real new review in the current Anki day.
    col.db.execute('INSERT INTO revlog VALUES (?,?,0,3,1,1,2500,10000,1)',int(time.time()*1000),cid)
    if not optimized:data.clear_snapshot_cache()
    answer,after=collect(1,True)
    assert after['stats']['reviews']==out['stats']['reviews']+1
    result={'cards':20000,'revlog_rows':600000,'cold_ms':cold,'unchanged_refresh_ms':warm,'after_review_ms':answer,'history_days':len(out['days']),'streak':out['stats']['streak']}
    if hasattr(data,'collect_history_year'):
        started=time.perf_counter();archive=data.collect_history_year(col,out['history_start_year'],revision=1)
        result['archive_year_ms']=round((time.perf_counter()-started)*1000,1)
        assert archive['days'],'Older history must remain accessible'
    path=ROOT/'previews'/('data-performance-before.json' if os.environ.get('NOS_PERF_BASELINE') else 'data-performance-after.json')
    path.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
finally:
    col.close()
    assert scratch.resolve().is_relative_to(ROOT/'tests'/'.tmp')
    shutil.rmtree(scratch)
