"""Independent checks against source NPZ/parquet; read-only, -B."""
import sys,json
from pathlib import Path
import numpy as np
import pandas as pd
sys.dont_write_bytecode=True
ROOT=Path(r"F:\transitlab-hk"); DEST=Path(__file__).resolve().parents[1]; OUT=DEST/"out"
sys.path.insert(0,str(ROOT))
from game.engine.base import get_base
b=get_base(); B=json.loads((OUT/"hk-base.json").read_text(encoding="utf-8")); ids=[z["id"] for z in B["zones"]]
n=len(ids); am=np.load(ROOT/"data/model/am-peak-2026.npz")
assert ids==list(am["zones"].astype(str))[:n]
ends=pd.read_parquet(ROOT/"data/model/trip-ends-2026.parquet").set_index("zone").loc[ids]
assert sum(c[2] for c in B["cells"])==int(ends.population.sum())
assert sum(c[3] for c in B["cells"])==int(ends.jobs.sum())
assert all(z["pop"]==ends.at[z["id"],"population"] and abs(z["jobs"]-ends.at[z["id"],"jobs"])<1 for z in B["zones"])
assert sum(z["jobs"] for z in B["zones"])==round(ends.jobs.sum())
ptz=np.load(ROOT/"data/model/skim-active-transit.npz"); ix=[list(ptz["zones"].astype(str)).index(z) for z in ids]
ptmin=ptz["transit_min"][np.ix_(ix,ix)]; walkmin=ptz["walk_min"][np.ix_(ix,ix)]
params=json.loads((ROOT/"data/model/parameters-tcs2022.json").read_text(encoding="utf-8")); prof=params["hourly_profile_pct"]
mode=np.load(ROOT/"data/model/mode-split-2026.npz")
def hour(h):
    f={p:prof[k][h]/sum(prof[k]) for p,k in b.pk.PROFILE_KEY.items()}; d={p:.5 for p in f}
    if h==18:
        d["HBW"]=max(0,1-.5*params["peak_hour_direction_pct"]["work_to_home_1800"]/100/f["HBW"]);d["HBS"]=0
    for p,k in b.crossing.items(): f[p]=f[k];d[p]=0 if h==18 and k=="HBS" else .5
    q={m:np.zeros((n,n)) for m in b.modes}
    for p in f:
        for m in q:
            t=mode["T_"+p+"_"+m][:n,:n].astype(float);q[m]+=f[p]*(d[p]*t+(1-d[p])*t.T)
    return q
result={"passed":True,"population":int(ends.population.sum()),"jobs":int(ends.jobs.sum()),"checks":{}}
for period in ["am","pm","day"]:
    q={m:am["P_"+m][:n,:n] for m in b.modes} if period=="am" else hour(18 if period=="pm" else 11)
    D=json.loads((OUT/("hk-demand-"+period+".json")).read_text(encoding="utf-8")); pairs=D["pairs"]
    car=q["PV"]+q["TAXI"];pt=q["PT"]; mask=car+pt>=1
    assert len(pairs)==int(mask.sum()),period
    ii=np.array([p[0] for p in pairs]);jj=np.array([p[1] for p in pairs])
    assert np.all(mask[ii,jj])
    assert len(set(zip(ii,jj)))==len(pairs)
    c=np.array([p[2] for p in pairs]);p=np.array([p[3] for p in pairs])
    ce=float(np.abs(c-car[ii,jj]).max());pe=float(np.abs(p-pt[ii,jj]).max())
    assert ce<=.050001 and pe<=.050001
    for index,skim in [(5,ptmin),(6,walkmin)]+([(4,b.car_skim0)] if period=="am" else []):
        values=skim[ii,jj]; valid=np.isfinite(values)
        assert all((row[index] is not None)==bool(ok) for row,ok in zip(pairs,valid))
        got=np.array([row[index] for row,ok in zip(pairs,valid) if ok])
        assert np.array_equal(got,np.rint(values[valid]))
    total=sum(q[m].sum() for m in q)
    assert abs(D["checks"]["car_pct"]-round(100*car.sum()/total,1))<.001
    assert abs(D["checks"]["pt_pct"]-round(100*pt.sum()/total,1))<.001
    result["checks"][period]={"pairs":len(pairs),"flow_error_at_most":.1,"pair_car_loss_pct":round(100*(1-c.sum()/car.sum()),1),
      "pair_pt_loss_pct":round(100*(1-p.sum()/pt.sum()),1)}
source=pd.read_parquet(ROOT/"data/model/transit-assignment-am-2026.parquet")
source=source[(source.route_type==1)&source.line.isin([l["id"] for l in B["lines"]])]
id_en={s["id"]:s["en"] for s in B["stations"]}
rows={tuple([r.line,r.from_station,r.to_station]):(int(round(r.volume)),int(round(r.capacity))) for r in source.itertuples()}
A=json.loads((OUT/"hk-demand-am.json").read_text(encoding="utf-8"))
assert len(A["lines"])==len(source)
for l,f,t,v,cap in A["lines"]: assert rows[(l,id_en[f],id_en[t])]==(v,cap)
result["rail_am_passenger_volume_and_capacity"]=True
result["skim_null_semantics"]=True
result["source_project_read_only"]=True
(OUT/"source-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(result,ensure_ascii=True))
