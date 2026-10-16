"""Exercise deliberately bad AI outputs. No live chat or credential reads."""
import asyncio
import copy
import importlib.util
import json
from pathlib import Path

import pytest

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('sentence_runner',HERE/'run_sentences.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
CASES=json.loads((runner.ROOT/'game-feeder/v7/ai/test-sentences.json').read_text(encoding='utf-8'))['sentences']
FIXED=json.loads((HERE/'canned-replies.json').read_text(encoding='utf-8'))


def result(i):return {'request':copy.deepcopy(FIXED[f'S{i:02d}'])}


@pytest.mark.parametrize('field,value,dimension',[('mode',2,'mode'),('area','kowloon-east','area'),('title','短','title_length')])
def test_scoring_detects_wrong_mode_area_and_title(field,value,dimension):
    r=result(3);r['request'][field]=value
    score=runner.score_case(CASES[2],r)
    assert score['checks'][dimension] is False and not score['good']


def test_extra_missing_duplicate_wrong_amount_and_wrong_place():
    case=CASES[2]
    r=result(3);r['request']['changes'].append({'place':'沙田站一帶','what':'jobs','pct':30})
    assert runner.score_case(case,r)['checks']['no_extra'] is False
    r=result(3);r['request']['changes']=[]
    assert runner.score_case(case,r)['checks']['changes'] is False
    r=result(3);r['request']['changes']*=2
    assert runner.score_case(case,r)['checks']['no_extra'] is False
    r=result(3);r['request']['changes'][0]['add']=30001
    assert runner.score_case(case,r)['checks']['changes'] is False
    r=result(3);r['request']['changes'][0]['place']='九龍灣站一帶'
    assert runner.score_case(case,r)['checks']['no_extra'] is False


def test_unstated_year_and_percentage_substitution_do_not_pass():
    r=result(3);r['request']['changes'][0]['by_year']=4
    assert not runner.score_case(CASES[2],r)['good']
    r=result(3);r['request']['changes']=[{'place':'沙田站一帶','what':'people','pct':30}]
    assert not runner.score_case(CASES[2],r)['good']


def test_empty_changes_refusal_and_unknown_failure_are_distinct():
    assert runner.score_case(CASES[40],result(41))['good']
    from fastapi.responses import JSONResponse
    assert runner.score_case(CASES[25],JSONResponse({'code':'refuse'},status_code=422))['good']
    assert not runner.score_case(CASES[25],JSONResponse({'message':'server broke'},status_code=503))['good']
    assert not runner.score_case(CASES[4],JSONResponse({'code':'refuse'},status_code=422))['good']


def test_fixture_schema_and_all_expected_places():
    assert len(CASES)==len(FIXED)==60 and len({c['id'] for c in CASES})==60
    names=runner.load_names()
    for c in CASES:
        assert all(k in c for k in ('mode','area','changes','expect'))
        if c['expect']!='ok':continue
        for ch in c['changes']:
            pool='roads' if ch['what']=='road_cap' else 'places'
            assert any(place in names[area][pool] for area in runner.options(c['area']) for place in runner.options(ch['place'])),c['id']


def test_offline_runner_never_consults_config_or_network(monkeypatch,tmp_path,capsys):
    def forbidden(*args,**kwargs):raise AssertionError('network/config forbidden')
    monkeypatch.setattr(runner.feeder_ai,'_config',forbidden)
    monkeypatch.setattr(runner.feeder_ai.httpx,'AsyncClient',forbidden)
    original=runner.feeder_ai.chat
    output=asyncio.run(runner.run(limit=3,out=tmp_path/'offline'))
    assert output['summary']['good']==3 and runner.feeder_ai.chat is original
    assert (tmp_path/'offline.json').exists() and (tmp_path/'offline.md').exists()
    assert 'offline-fixed-replies' in capsys.readouterr().out
