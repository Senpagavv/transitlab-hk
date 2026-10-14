"""The Hong Kong 400 m grid (task 51, Codex; moved into the project 2026-10-15). Reads data/model and data/web (read
only), writes game-feeder/v7/hk/: hk-base.json and hk-demand-{am,pm,day,holiday}.json. Notes: README.md here."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import json, math, zipfile
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
from rasterio.features import rasterize
from affine import Affine
from opencc import OpenCC
ROOT=Path(__file__).resolve().parents[3]; DEST=Path(__file__).resolve().parent; OUT=ROOT/"game-feeder"/"v7"/"hk"
sys.path.insert(0,str(ROOT))
from game.engine.base import get_base, RAIL_LINES
from game.engine.places import get_places
M=ROOT/"data/model"; W=ROOT/"data/web"; CC=OpenCC("t2s"); TRAD=OpenCC("s2hk")
CELL=400; X0=800000; YTOP=848000; COLS=160; ROWS=120; NG=COLS*ROWS
NOTES={}
def log(s): print(s,flush=True)
def json_numbers(d):
    if isinstance(d,float): return rnd(d)
    if isinstance(d,dict): return {k:json_numbers(v) for k,v in d.items()}
    if isinstance(d,list): return [json_numbers(v) for v in d]
    return d

def save(n,d):
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/n).write_text(json.dumps(json_numbers(d),ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf-8")
def rnd(x):
    if x is None or not np.isfinite(x): return None
    v=round(float(x),1); return int(v) if v.is_integer() else v
def integer(x): return int(round(float(x))) if x is not None and np.isfinite(x) else None
def cr(x,y): return (max(0,min(COLS-1,int((x-X0)//CELL))),max(0,min(ROWS-1,int((YTOP-y)//CELL))))
def xy(c): return (X0+(c[0]+.5)*CELL,YTOP-(c[1]+.5)*CELL)
def ci(c): return c[1]*COLS+c[0]
def cp(k): return [int(k%COLS),int(k//COLS)]
def path(p,q):
    ax,ay=(p[0]-X0)/CELL,(YTOP-p[1])/CELL; bx,by=(q[0]-X0)/CELL,(YTOP-q[1])/CELL
    c,r=cr(*p); ec,er=cr(*q); out=[(c,r)]; dx,dy=bx-ax,by-ay
    sx=1 if dx>0 else -1; sy=1 if dy>0 else -1
    tx=((c+1 if dx>0 else c)-ax)/dx if dx else math.inf
    ty=((r+1 if dy>0 else r)-ay)/dy if dy else math.inf
    dtx=abs(1/dx) if dx else math.inf; dty=abs(1/dy) if dy else math.inf
    while (c,r)!=(ec,er):
        if len(out)>COLS+ROWS+10: raise RuntimeError("grid path did not finish")
        if tx<=ty and c!=ec: c+=sx; tx+=dtx
        elif r!=er: r+=sy; ty+=dty
        else: c+=sx; tx+=dtx
        out.append((c,r))
    return out
def components(edges):
    adj=defaultdict(set)
    for a,b in edges: adj[a].add(b); adj[b].add(a)
    seen=set(); groups=[]
    for root in sorted(adj):
        if root in seen: continue
        seen.add(root); stack=[root]; comp=set()
        while stack:
            a=stack.pop(); comp.add(a)
            for b in adj[a]:
                if b not in seen: seen.add(b); stack.append(b)
        groups.append(comp)
    return sorted(groups,key=len,reverse=True),adj
def walks(edges):
    groups,adj=components(edges); result=[]
    for comp in groups:
        root=min(comp); visited=set(); walk=[root]; stack=[(root,iter(sorted(adj[root])))]
        while stack:
            a,it=stack[-1]
            try: b=next(it)
            except StopIteration:
                stack.pop()
                if stack: walk.append(stack[-1][0])
                continue
            e=tuple(sorted((a,b)))
            if e in visited: continue
            visited.add(e); walk.append(b); stack.append((b,iter(sorted(adj[b]))))
        result.append((comp,walk))
    return result
def sum50(a):
    p=np.zeros((ROWS*8,COLS*8)); p[:a.shape[0],:a.shape[1]]=a
    a=p.reshape(ROWS,8,COLS,8).sum(axis=(1,3)); v=np.floor(a.ravel()).astype(int)
    d=int(round(a.sum()))-int(v.sum())
    if d>0: v[np.argsort(-(a.ravel()-v),kind="stable")[:d]]+=1
    return v.reshape(ROWS,COLS)
def balanced(a):
    a=np.asarray(a,float); v=np.floor(a).astype(int)
    delta=int(round(a.sum()))-int(v.sum())
    if delta>0: v[np.argsort(-(a-v),kind="stable")[:delta]]+=1
    return v
def geometry(b,pl):
    log("1a land/population/jobs/zones")
    chars=list("~w^grcimpo."); lut=np.full(256,chars.index("."),np.uint8)
    mapping={0:"~",91:"w",92:"w",71:"^",72:"^",73:"^",74:"^",32:"g",1:"r",2:"r",3:"r",11:"c",
             21:"i",22:"i",23:"i",31:"o",43:"p",44:"p",41:"o",42:"o",51:"o",52:"o",53:"o",54:"o"}
    for code,ch in mapping.items(): lut[code]=chars.index(ch)
    cat=np.zeros((ROWS*40,COLS*40),np.uint8); codes=b.land_codes
    cat[:codes.shape[0],:codes.shape[1]]=lut[codes]
    counts=np.stack([(cat==k).reshape(ROWS,40,COLS,40).sum(axis=(1,3)) for k in range(len(chars))])
    land="".join(chars[k] for k in counts.argmax(axis=0).ravel())
    pop,jobs=sum50(pl.pop),sum50(pl.jobs)
    landgrid=counts.argmax(axis=0)
    coast=np.isin(landgrid,[0,1])&((pop+jobs)>0)&(counts[2:].sum(axis=0)>0)
    landgrid[coast]=counts[2:,coast].argmax(axis=0)+2
    land="".join(chars[k] for k in landgrid.ravel())
    NOTES["coastal_grid"]={"reclassified_cells":int(coast.sum()),"population":int(pop[coast].sum()),"jobs":int(jobs[coast].sum()),
      "remaining_water_population":int(pop[np.isin(landgrid,[0,1])].sum()),"remaining_water_jobs":int(jobs[np.isin(landgrid,[0,1])].sum())}
    zonepop=balanced(b.ends.population.iloc[:b.n].to_numpy(float))
    zonejobs=balanced(b.ends.jobs.iloc[:b.n].to_numpy(float))
    cells=[cp(k)+[int(pop.ravel()[k]),int(jobs.ravel()[k])] for k in np.flatnonzero((pop+jobs).ravel())]
    z50=rasterize(((g,i+1) for i,g in enumerate(b.zone_geo.geometry)),out_shape=pl.pop.shape,
                 transform=Affine(50,0,pl.x0,0,-50,pl.y1),fill=0,dtype="int32")
    rr,cc=np.indices(pl.pop.shape); cid=(rr//8)*COLS+cc//8; keep=z50>0
    labels=(z50[keep]-1)*NG+cid[keep]
    zp=np.bincount(labels,weights=pl.pop[keep],minlength=b.n*NG).reshape(b.n,NG)
    zj=np.bincount(labels,weights=pl.jobs[keep],minlength=b.n*NG).reshape(b.n,NG)
    zg=rasterize(((g,i+1) for i,g in enumerate(b.zone_geo.geometry)),out_shape=(ROWS,COLS),
                 transform=Affine(CELL,0,X0,0,-CELL,YTOP),fill=0,dtype="int32")-1
    density=b.landuse.gfa_office.fillna(0).to_numpy()/b.landuse.area_km2.clip(lower=.01).to_numpy()
    q75,q90=np.quantile(density[density>0],[.75,.9]); zones=[]
    gx=np.tile(np.arange(COLS),ROWS); gy=np.repeat(np.arange(ROWS),COLS)
    for i,z in enumerate(pl.zones):
        w=zp[i] if zp[i].sum()>0 else zj[i]
        if w.sum():
            c,r=np.average(gx,weights=w),np.average(gy,weights=w)
            k=min(np.flatnonzero(w>0),key=lambda k:((k%COLS-c)**2+(k//COLS-r)**2,-w[k],int(k)))
            rep=cp(k)
        else: rep=list(cr(b.zone_x[i],b.zone_y[i]))
        zones.append({"id":z["zone"],"name":TRAD.convert(z["label"]),"hans":CC.convert(z["label"]),"en":None,"district":TRAD.convert(z["district"]),
                      "cell":rep,"pop":int(zonepop[i]),"jobs":int(zonejobs[i]),"cbd":2 if density[i]>=q90 else 1 if density[i]>=q75 else 0})
    NOTES["cbd"]={"office_gfa_density_q75":rnd(q75),"office_gfa_density_q90":rnd(q90)}
    existing={s["id"]:s for s in pl.existing}; used=set(); stations=[]; moved=[]
    for s in b.stations.to_dict("records"):
        old=cr(s["x"],s["y"]); cell=old
        if cell in used or land[ci(cell)]=="~":
            cell=min(((c,r) for r in range(ROWS) for c in range(COLS) if (c,r) not in used and land[r*COLS+c]!="~"),
                     key=lambda c:((xy(c)[0]-s["x"])**2+(xy(c)[1]-s["y"])**2,c[1],c[0]))
            moved.append({"id":s["id"],"name":existing[s["id"]]["name_zh"],"from":list(old),"to":list(cell)})
        used.add(cell); name=existing[s["id"]]["name_zh"]
        stations.append({"id":s["id"],"name":name,"hans":CC.convert(name),"en":s["name_en"],"cell":list(cell),
                         "xy":[rnd(s["x"]),rnd(s["y"])],"lines":s["lines"],"zone":b.inner[int(s["zone"])]})
    NOTES["moved_stations"]=moved
    return {"version":1,"cell_m":CELL,"x0":X0,"y_top":YTOP,"cols":COLS,"rows":ROWS,"land":land,"cells":cells,
            "zones":zones,"stations":stations,"zone_index":zg.ravel().astype(int).tolist()}
def railway(B):
    log("1b railway station order")
    st={s["id"]:s for s in B["stations"]}
    with zipfile.ZipFile(ROOT/"data/raw/gtfs_merged/hk-merged.gtfs.zip") as z:
        routes=pd.read_csv(z.open("routes.txt"),dtype=str)
        trips=pd.read_csv(z.open("trips.txt"),dtype=str,usecols=["route_id","trip_id"])
        stops=pd.read_csv(z.open("stops.txt"),dtype=str).set_index("stop_id")
        times=pd.read_csv(z.open("stop_times.txt"),dtype={"trip_id":str,"stop_id":str,"stop_sequence":int},usecols=["trip_id","stop_id","stop_sequence"])
    rail=routes[routes.route_type=="1"]; trips=trips[trips.route_id.isin(rail.route_id)]
    t=times[times.trip_id.isin(trips.trip_id)].merge(trips,on="trip_id")
    def parent(s):
        p=stops.at[s,"parent_station"]; return p if isinstance(p,str) and p else s
    t["station"]=t.stop_id.map(parent); seqs=defaultdict(set)
    for (route,trip),g in t.groupby(["route_id","trip_id"]):
        line=route.removeprefix("osm:MTR-")
        if line not in RAIL_LINES: continue
        seq=list(dict.fromkeys(s for s in g.sort_values("stop_sequence").station if s in st))
        if len(seq)>1: seqs[line].add(min(tuple(seq),tuple(reversed(seq))))
    a=pd.read_parquet(M/"transit-assignment-am-2026.parquet"); a=a[(a.route_type==1)&a.line.isin(RAIL_LINES)]
    names={"EAL":("東鐵綫","East Rail Line"),"TWL":("荃灣綫","Tsuen Wan Line"),"KTL":("觀塘綫","Kwun Tong Line"),
      "ISL":("港島綫","Island Line"),"TKL":("將軍澳綫","Tseung Kwan O Line"),"TML":("屯馬綫","Tuen Ma Line"),
      "TCL":("東涌綫","Tung Chung Line"),"SIL":("南港島綫","South Island Line"),"AEL":("機場快綫","Airport Express"),
      "DRL":("迪士尼綫","Disneyland Resort Line")}
    lines=[]; audit=[]
    for line in RAIL_LINES:
        patterns=sorted(seqs[line],key=lambda x:(-len(x),x)); main=list(patterns[0]); adj=defaultdict(set)
        for seq in patterns:
            for s,u in zip(seq,seq[1:]): adj[s].add(u); adj[u].add(s)
        mainset=set(main); covered=set(main); walk=[]
        def branch(s,parent):
            out=[s]
            for u in sorted(adj[s]):
                if u==parent or u in mainset or u in covered: continue
                covered.add(u); out+=branch(u,s); out.append(s)
            return out
        for s in main: walk+=branch(s,None)
        expected={s["id"] for s in st.values() if line in s["lines"]}
        if set(walk)!=expected: raise RuntimeError("railway coverage "+line+" "+str(expected-set(walk)))
        cells=[]
        for sid in walk:
            target=tuple(st[sid]["cell"])
            if not cells: cells=[target]
            else: cells+=path(xy(cells[-1]),xy(target))[1:]
        row=rail[rail.route_id=="osm:MTR-"+line].iloc[0]; color=str(row.route_color).strip()
        if len(color)!=6: raise RuntimeError("official color missing")
        g=a[a.line==line]; name,en=names[line]
        lines.append({"id":line,"name":name,"hans":CC.convert(name),"en":en,"color":"#"+color.upper(),
          "stations":walk,"cells":[list(c) for c in cells],"trains_per_hour":rnd(g.per_hour.max()),"cap_per_hour":integer(g.capacity.max()),
          "main_stations":main,"patterns":[list(x) for x in patterns]})
        audit.append({"line":line,"stations":len(expected),"branch_revisits":len(walk)-len(expected),"order":[st[s]["name"] for s in walk]})
    B["lines"]=lines; NOTES["rail_order"]=audit
    ni={s["en"]:s["id"] for s in B["stations"]}
    return [[r.line,ni[r.from_station],ni[r.to_station],integer(r.volume),integer(r.capacity)] for r in a.itertuples()]
def roads(B):
    log("1c roads and directional volumes")
    links=pd.read_parquet(M/"road-links.parquet").set_index("link_id"); nodes=pd.read_parquet(M/"road-nodes.parquet").set_index("node_id")
    ass=pd.read_parquet(M/"assignment-am-2026.parquet")
    ass=ass[ass.road_link.isin(links.index)].set_index(["road_link","side"]); ass.index=ass.index.set_names(["link_id","side"])
    speed=pd.read_parquet(M/"road-speeds-hourly.parquet")
    h=speed[speed.hour.isin([8,11,18])].pivot_table(index=["link_id","side"],columns="hour",values="speed",aggfunc="mean")
    d=ass.join(h); free_speed=d.distance*60/d.free_time
    for hour in [11,18]:
        valid=(d[hour]>0)&(d.alpha>0)&(d.beta>0)&(d.capacity>0)
        d["load"+str(hour)]=d.total*census_hour_factors()[hour]; NOTES["speed_fallback_"+str(hour)]=int((~valid).sum())
        good=(d[8]>0)&(d[hour]>0); NOTES["time_factor_"+str(hour)]=float(np.median((d.loc[good,8]/d.loc[good,hour]).to_numpy()))
    rank={"expressway":3,"primary":2,"district":1}; selected=links[links.road_class.isin(rank)&links.routable]
    edges=defaultdict(lambda:{"dirs":np.zeros((2,4)),"candidates":{}}); samecell=0
    for lid,r in selected.iterrows():
        p=nodes.loc[r.a_node,["x","y"]].to_numpy(float); q=nodes.loc[r.b_node,["x","y"]].to_numpy(float)
        if not (X0<=p[0]<X0+COLS*CELL and YTOP-ROWS*CELL<p[1]<=YTOP and X0<=q[0]<X0+COLS*CELL and YTOP-ROWS*CELL<q[1]<=YTOP): continue
        cells=path(p,q)
        if len(cells)<2: samecell+=1; continue
        raw=str(r.street).strip(); name="未命名道路" if raw in ("-99","nan","","None") else raw; group=(name,str(r.road_class))
        cap=max(float(r.capacity_ab_veh_hr),float(r.capacity_ba_veh_hr) if pd.notna(r.capacity_ba_veh_hr) else 0)
        for u,v in zip(cells,cells[1:]):
            a,b=ci(u),ci(v); key=tuple(sorted((a,b))); fw=0 if a<b else 1; info=edges[key]
            for side,di in [("ab",fw),("ba",1-fw)]:
                if (lid,side) in d.index:
                    row=d.loc[(lid,side)]; info["dirs"][di]+=np.array([row.capacity,row.total,row.load18,row.load11])
            info["candidates"][int(lid)]={"group":group,"score":(rank[r.road_class],cap)}
    if len(edges)>4200: raise RuntimeError("road section budget exceeded: "+str(len(edges)))
    groups=defaultdict(set)
    for e,info in edges.items():
        rep=max(info["candidates"],key=lambda k:(info["candidates"][k]["score"],-k))
        groups[info["candidates"][rep]["group"]].add(e)
    output=[]; owner={}
    for group,es in sorted(groups.items()):
        for comp,walk in walks(es):
            ces={e for e in es if e[0] in comp and e[1] in comp}; ids={lid for e in ces for lid,x in edges[e]["candidates"].items() if x["group"]==group}
            rr=links.loc[sorted(ids)]; name,klass=group; rid=len(output)
            output.append({"id":rid,"name":name,"hans":CC.convert(name),"en":None if name=="未命名道路" else name,"class":klass,
                          "cells":[cp(k) for k in walk],"tunnel":bool((rr.elevation<0).any()),"toll":rnd(rr.toll_car_hkd.fillna(0).max())})
            for e in ces: owner[e]=rid
    sections=[]; loads={"am":[],"pm":[],"day":[]}
    for e,info in sorted(edges.items()):
        a=info["dirs"]; cap=a[:,0].max()
        if cap<=0: continue
        sid=len(sections); load=a[:,1].max()
        sections.append({"id":sid,"a":cp(e[0]),"b":cp(e[1]),"road":owner[e],"cap":integer(cap),
                         "am":{"load":integer(load),"vc":rnd(load/cap)},"model_links":sorted(info["candidates"])})
        for period,col in [("am",1),("pm",2),("day",3)]:
            load=a[:,col].max(); loads[period].append([sid,integer(load),rnd(load/cap)])
    B["roads"]=output; B["sections"]=sections; comps,_=components(set(edges))
    NOTES["roads"]={"source_links":len(selected),"within_one_cell":samecell,"features":len(output),"sections":len(sections),
                    "component_cells":[len(c) for c in comps],"class_counts":dict(Counter(x["class"] for x in output))}
    NOTES["untranslated_roads"]=sorted({r["name"] for r in output if r["name"]!="未命名道路" and r["name"].isascii()})
    top=ass.sort_values("vc",ascending=False).head(15).reset_index()
    NOTES["model_top_vc"]=[{"link":int(r.link_id),"name":str(links.at[r.link_id,"street"]),"side":r.side,"load":integer(r.total),
      "cap":integer(r.capacity),"vc":rnd(r.vc),"class":str(links.at[r.link_id,"road_class"]),"cell":list(cr(*nodes.loc[links.at[r.link_id,"a_node"],["x","y"]].to_numpy(float))),"reason":("local道路未选" if links.at[r.link_id,"road_class"] not in rank else "400米同格内" if cr(*nodes.loc[links.at[r.link_id,"a_node"],["x","y"]].to_numpy(float))==cr(*nodes.loc[links.at[r.link_id,"b_node"],["x","y"]].to_numpy(float)) else "已有格间映射"),"grid_sections":[s["id"] for s in sections if int(r.link_id) in s["model_links"]]} for r in top.itertuples()]
    return loads
AREAS=[
("kowloon-east","九龍東","觀塘"),("kai-tak","啟德","啟德"),("mong-kok-yau-tsim-mong","旺角·油尖旺","旺角"),
("tsim-sha-tsui","尖沙咀","尖沙咀"),("central-admiralty","中環·金鐘","金鐘"),("causeway-bay-wan-chai","銅鑼灣·灣仔","銅鑼灣"),
("sham-shui-po-cheung-sha-wan","深水埗·長沙灣","長沙灣"),("hung-hom-ho-man-tin","紅磡·何文田","紅磡"),
("tsuen-wan-kwai-tsing","荃灣·葵青","荃灣"),("sha-tin-tai-wai","沙田·大圍","沙田"),("ma-on-shan","馬鞍山","馬鞍山"),
("tai-po","大埔","大埔墟"),("fanling-sheung-shui","粉嶺·上水","粉嶺"),("yuen-long","元朗","元朗"),
("tin-shui-wai-hung-shui-kiu","天水圍·洪水橋","天水圍"),("tuen-mun","屯門","屯門"),("tseung-kwan-o","將軍澳","將軍澳"),
("tung-chung","東涌","東涌"),("hong-kong-south","港島南","黃竹坑"),("northern-metropolis","北部都會區·新田古洞","落馬洲")]
def areas(B):
    st={s["name"]:s for s in B["stations"]}; B["areas"]=[]
    for key,name,center in AREAS:
        c,r=st[center]["cell"]; c0=min(max(c-8,0),COLS-16); r0=min(max(r-6,0),ROWS-12)
        B["areas"].append({"key":key,"name":name,"hans":CC.convert(name),"center":center,"box":[c0,r0,c0+16,r0+12]})

def census_hour_factors():
    if "road_hourly_factors" in NOTES: return {int(k):v for k,v in NOTES["road_hourly_factors"].items()}
    a=json.loads((W/"traffic/atc-stations.json").read_text(encoding="utf-8"))
    year=2024; profiles={r["station"]:r["weekday_pct"] for r in a["hourly"] if r["year"]==year}
    aadt=defaultdict(float)
    for r in a["records"]:
        if r["year"]==year and isinstance(r.get("aadt"),(int,float)): aadt[r["station"]]+=r["aadt"]
    totals={h:sum(aadt[s]*v[h]/100 for s,v in profiles.items() if s in aadt) for h in [8,11,18]}
    if totals[8]<=0: raise RuntimeError("missing census hourly profile")
    factors={h:totals[h]/totals[8] for h in [11,18]}
    NOTES["road_hourly_factors"]={str(h):v for h,v in factors.items()}
    NOTES["road_hourly_census"]={"year":year,"stations":len(set(profiles)&set(aadt)),"hourly_sum":{str(h):rnd(v) for h,v in totals.items()}}
    return factors
def npzmat(file,key,ids):
    z=np.load(file); a=np.asarray(z[key],float); order=list(z["zones"].astype(str))
    ix=[order.index(k) for k in ids]
    if len(order)!=a.shape[0]: raise RuntimeError("matrix shape mismatch "+key)
    return a[np.ix_(ix,ix)]
def hour_people(b,hour):
    p=json.loads((M/"parameters-tcs2022.json").read_text(encoding="utf-8"))
    prof=p["hourly_profile_pct"]; fs={k:prof[key][hour]/sum(prof[key]) for k,key in b.pk.PROFILE_KEY.items()}; ds={k:.5 for k in fs}
    if hour==18:
        ds["HBW"]=max(0,1-.5*p["peak_hour_direction_pct"]["work_to_home_1800"]/100/fs["HBW"]); ds["HBS"]=0
    for purpose,like in b.crossing.items(): fs[purpose]=fs[like]; ds[purpose]=0 if hour==18 and like=="HBS" else .5
    people={m:np.zeros((b.n_all,b.n_all)) for m in b.modes}
    for purpose,f in fs.items():
        d=ds[purpose]
        for m in b.modes:
            t=b.mode_file["T_"+purpose+"_"+m].astype(float); people[m]+=f*(d*t+(1-d)*t.T)
    NOTES["coefficients_"+str(hour)]={k:{"fraction_pct":rnd(f*100),"from_home_pct":rnd(ds[k]*100)} for k,f in fs.items()}
    return people
def holiday_people(b):
    prof=json.loads((M/"parameters-tcs2022.json").read_text(encoding="utf-8"))["hourly_profile_pct"]
    monthly=json.loads((M/"td-digest-series.json").read_text(encoding="utf-8"))["patronage_thousand_per_day"]["monthly"]
    vals={k:v["MTR Lines"] for k,v in monthly.items() if k.startswith("2025-") and "MTR Lines" in v}
    low=min(vals,key=vals.get); high=max(vals,key=vals.get); mult=vals[high]/vals[low]
    retail=b.landuse.gfa_retail.fillna(0).to_numpy()
    park=(b.zoning.ha_country_park+b.zoning.ha_conservation+b.zoning.ha_recreation+b.zoning.ha_open_space).fillna(0).to_numpy()
    theme=np.zeros(b.n); border=np.zeros(b.n)
    for r in b.stations.to_dict("records"):
        if r["name_en"] in ("Disneyland Resort","Ocean Park"): theme[int(r["zone"])]+=1
    for i,z in enumerate(b.ids):
        if z.startswith("X:"): border[b.host[i]]+=1
    weight=np.ones(b.n)
    for a in [retail,park,theme,border]:
        if a.sum()>0: weight+=a/a.sum()*b.n
    people={m:np.zeros((b.n_all,b.n_all)) for m in b.modes}
    for purpose,key in [("HBO","HBO"),("NHB","NHB_EB")]:
        f=prof[key][11]/sum(prof[key])
        for m in b.modes:
            t=b.mode_file["T_"+purpose+"_"+m].astype(float)[:b.n,:b.n]
            q=t*weight[None,:]; scale=np.divide(t.sum(1),q.sum(1),out=np.zeros(b.n),where=q.sum(1)>0); q*=scale[:,None]
            people[m][:b.n,:b.n]+=mult*f*(.7*q+.3*q.T)
    NOTES["holiday"]={"low_month":low,"low_thousand_per_day":rnd(vals[low]),"high_month":high,"high_thousand_per_day":rnd(vals[high]),
        "multiplier":rnd(mult),"exact_multiplier":format(mult,".8f"),"formula":"1+455*sum(proxy/proxy.sum())",
        "proxies":["retail GFA","park/conservation/recreation/open-space hectares","Disneyland Resort/Ocean Park station counts","border-control host counts"]}
    target_people=hour_people(b,11)
    target=sum(v[:b.n,:b.n].sum() for v in target_people.values())*mult
    initial=sum(v.sum() for v in people.values())
    rescale=target/initial
    for m in people: people[m]*=rescale
    NOTES["holiday"]["total_target_people"]=integer(target)
    NOTES["holiday"]["HBO_NHB_rescale"]=rnd(rescale)
    return people,mult
THEMES={"am":("#EEF3F8","#2B3A4A","#2F6FD6"),"pm":("#F8EEE2","#493C2C","#C46A28"),
        "day":("#F7F5EF","#383C36","#498260"),"holiday":("#FBEDEA","#4A3030","#C8102E")}
LABELS={"am":("早高峰","AM peak","平日 08:00–09:00","B"),"pm":("晚高峰","PM peak","平日 18:00–19:00","C"),
        "day":("平日日常","Weekday off-peak","平日 11:00–12:00","C"),"holiday":("節假日","Holiday","假日 11:00–12:00 情景","D")}
def demand(period,people,B,b,sections,rails,ptmin,walkmin,carmin,factor=1):
    n=b.n; car=(people["PV"]+people["TAXI"])[:n,:n]; pt=people["PT"][:n,:n]; spb=people["SPB"][:n,:n]
    ii,jj=np.where(car+pt>=1)
    pairs=[[int(i),int(j),rnd(car[i,j]),rnd(pt[i,j]),integer(carmin[i,j]),integer(ptmin[i,j]),integer(walkmin[i,j])] for i,j in zip(ii,jj)]
    pc=np.zeros(n); pp=np.zeros(n)
    for x in pairs: pc[x[0]]+=x[2]; pp[x[0]]+=x[3]
    c,p,s=float(car.sum()),float(pt.sum()),float(spb.sum()); total=c+p+s
    check={"car_share":rnd(c/total),"pt_share":rnd(p/total),"car_pct":rnd(100*c/total),"pt_pct":rnd(100*p/total),
      "spb_pct":rnd(100*s/total),"car":integer(c),"pt":integer(p),"spb":integer(s),"pair_count":len(pairs),
      "pair_car":rnd(pc.sum()),"pair_pt":rnd(pp.sum()),"represented_pct":rnd(100*(pc.sum()+pp.sum())/(c+p)),
      "excluded_control_car":integer((people["PV"]+people["TAXI"]).sum()-c),"excluded_control_pt":integer(people["PT"].sum()-p),
      "by_district":[],"top_vc":[],"model_top_vc":NOTES["model_top_vc"],"null_minutes":{"car":sum(x[4] is None for x in pairs),"pt":sum(x[5] is None for x in pairs),"walk":sum(x[6] is None for x in pairs)}}
    districts=np.array([z["district"] for z in B["zones"]])
    for di in sorted(set(districts)):
        ix=np.flatnonzero(districts==di); c1,p1,s1=car[ix].sum(),pt[ix].sum(),spb[ix].sum(); t=c1+p1+s1; c2,p2=pc[ix].sum(),pp[ix].sum()
        check["by_district"].append({"district":di,"model_car":integer(c1),"model_pt":integer(p1),"model_spb":integer(s1),
          "car":integer(c2),"pt":integer(p2),"model_car_pct":rnd(100*c1/t) if t else 0,"model_pt_pct":rnd(100*p1/t) if t else 0,
          "model_car_pct_of_car_pt":rnd(100*c1/(c1+p1)) if c1+p1 else 0,"pair_car_pct":rnd(100*c2/(c2+p2)) if c2+p2 else 0})
    roadmap={r["id"]:r for r in B["roads"]}
    for sid,load,vc in sorted(sections,key=lambda x:x[1]/max(1,B["sections"][x[0]]["cap"]),reverse=True)[:15]:
        q=B["sections"][sid]; check["top_vc"].append({"section":sid,"name":roadmap[q["road"]]["name"],"load":load,"cap":q["cap"],"vc":vc,"model_links":q["model_links"]})
    label,en,hours,tier=LABELS[period]; paper,ink,accent=THEMES[period]
    lineout=[]
    for lid,f,t,vol,cap in rails:
        if period=="pm": f,t=t,f
        lineout.append([lid,f,t,integer(vol*factor),cap])
    return {"period":period,"label":label,"hans":CC.convert(label),"en":en,"hours":hours,"tier":tier,
      "theme":{"paper":paper,"ink":ink,"accent":accent},"zones":b.inner,"pairs":pairs,"sections":sections,"lines":lineout,"checks":check,
      "tiers":{"pairs":"B" if period=="am" else tier,"sections":"C" if period!="holiday" else "D","lines":"B" if period=="am" else "D",
               "minutes":"B" if period=="am" else "C"}}
def validate(B,D,b):
    assert len(B["land"])==NG and len(B["zone_index"])==NG
    p=sum(c[2] for c in B["cells"]); j=sum(c[3] for c in B["cells"])
    assert p==integer(b.ends.population.iloc[:b.n].sum()) and j==integer(b.ends.jobs.iloc[:b.n].sum())
    assert sum(z["pop"] for z in B["zones"])==p and sum(z["jobs"] for z in B["zones"])==j
    assert len(B["stations"])==97
    assert len({tuple(s["cell"]) for s in B["stations"]})==97
    assert all(B["land"][ci(s["cell"])]!="~" for s in B["stations"])
    for feature in B["roads"]+B["lines"]:
        assert all(abs(a[0]-q[0])+abs(a[1]-q[1])==1 for a,q in zip(feature["cells"],feature["cells"][1:])),feature["id"]
    for s in B["sections"]:
        assert abs(s["a"][0]-s["b"][0])+abs(s["a"][1]-s["b"][1])==1
    assert len(B["areas"])==20 and all(a["box"][2]-a["box"][0]==16 and a["box"][3]-a["box"][1]==12 for a in B["areas"])
    for period,d in D.items():
        assert d["zones"]==b.inner
        assert len(d["sections"])==len(B["sections"])
        assert all(len(x)==7 and 0<=x[0]<b.n and 0<=x[1]<b.n and x[2]+x[3]>=1 for x in d["pairs"])
        assert all(x[1]>=0 and x[2]>=0 for x in d["sections"])
    assert D["am"]["sections"]==[[s["id"],s["am"]["load"],s["am"]["vc"]] for s in B["sections"]]
    NOTES["checks"]={"population":p,"jobs":j,"population_difference":0,"jobs_difference":0,"stations":97,"zones":len(B["zones"]),
       "road_sections":len(B["sections"]),"four_connected":True,"areas":20}
def report(B,D):
    files={p.name:round(p.stat().st_size/1024/1024,1) for p in OUT.glob("*.json")}
    NOTES["file_sizes_mb"]=files
    am=D["am"]["checks"]
    text=["# 任务51交付说明","","已完成：全港400米底板、早高峰、核对、离线查看页；"+("晚高峰、平峰、节假日。" if len(D)==4 else "其余时段尚未生成。"),
      "","## 重算","",
      "使用项目现有 Python，开启 -B 禁止写入字节码；脚本只在自身上级任务51目录写文件。运行：",
      "F:/transitlab-hk/.venv/Scripts/python.exe -B C:/Users/赵禹博/Desktop/TransitLab五模式-Codex/任务51/scripts/build_hk_grid.py",
      "可加 --am-only 只生成底板与早高峰。源项目未修改，未运行 pipeline 脚本入口，未做 git 操作，未联网。get_base 按任务书许可导入模型模块。","","## 口径与接口","",
      "- 400米，HK1980 / EPSG:2326，x0=800000、y_top=848000、160列×120行。完整覆盖10米土地栅格；东侧最后250米补海。人口岗位50米格边缘补零后8×8相加，按最大余数取整，保持全港总数。",
      "- land取400米格内地类面积最多者；若水域占多数但有模型人口/岗位且本格确有非水地类，改取格内面积最大的非水类，保护海岸窄条建筑。山林与灌丛等映射 ^，非行政意义的郊野公园边界；住宅r、商业c、工业i、机构及其他已建o、港口机场p、交通o、农业及空地.；缺少格级混合用途标签，此版未单独标m。图形为粗尺度简化。",
      "- zones.cell 用50米人口权重、没人则岗位权重的空间重心，再选本区有人/岗位的最近400米格。pop/jobs由trip-ends分区数采用最大余数取整，分区合计与格子合计及模型一致；未沿用pl.zones对岗位的截尾整数。zone_index为新增行优先数组，值为 zones 下标，-1表示中心点不在分区内；查看页使用。",
      "- zones.en 无可靠分区英文标签，写 null；中文标签从模型继承，hans 用本地 OpenCC 转换。district保留项目区名并转换为繁体；name也是繁体，hans为简体。",
      "- cbd 为C级游戏分类：按办公GFA/区面积，正值样本第90百分位以上=2，第75百分位以上=1，其余=0。阈值由数据计算，分类阈值选择属启发式，不代表官方CBD。"+json.dumps(NOTES["cbd"],ensure_ascii=False),
      "- stations.id 为GTFS母站ID；xy来自项目GTFS的HK1980坐标。重铁97站，含机场快线，不含轻铁。冲突/海格移到真实坐标最近的非海空格。",
      "- lines.stations 为GTFS相邻站的真实行走顺序。分支插入往返，允许在分岔站重复；新增 main_stations/patterns 保存主路径和GTFS分支模式。cells按已移动站格之间直线栅格化，为4连通示意折线，不是轨道工程线位。官方色来自本地GTFS route_color。",
      "- trains_per_hour 来自港铁分配表 per_hour（班次）；cap_per_hour 来自 capacity。需求文件 lines 的 perHour 使用 volume（人/小时），不是 per_hour。非AM载客仅按全港PT总量缩放；PM交换方向，D级，不是重新分配。",
      "- roads选 expressway/primary/district，排除local。路节点端点直线栅格化；共用节点落在同格，保留交叉连接。道路按名字/级别的连通块输出，分支用4连通往返步行覆盖。400米聚合会合并立交及平行道路，无法保留高程和转向限制，C级。",
      "- sections 每一相邻格边唯一；经过该边的原路容量和负荷按空间方向分别相加。cap取两方向容量大者，load取两方向流量大者，vc=load/cap，均为一位小数或整数。model_links新增为追溯原路ID。两个最大值可能来自不同方向；用于游戏近似。",
      "- roads.tunnel 以源 elevation<0 判断，toll取本组件最大私家车收费。缺名道路写未命名道路。中文路名从places.json的双语站点同位逗号分段提取，仅English完全匹配、中文路名后缀且候选唯一才采用；英文原名保留en。对照及来源保存out/road-name-map.json；不能确认的保留英文，完整列表在文末。",
      "- areas.box为[c0,r0,c1,r1]，右/下端不含，全部16×12格且不越界，中心按移格后的站。",
      "- pairs只保留未取整car+pt≥1；car=PV+TAXI，人/小时，pt=PT，SPB未并入公交；checks方式比例分母包含SPB。car_share/pt_share按任务要求只留一位小数，精确核对用car_pct/pt_pct等百分数（一位小数）。pairs过滤和取整会产生少量损失。",
      "- 455内部分区之间的OD；15个X:口岸/外部联系控制点未纳入pairs，排除量在checks中列出。不能据此解释全港含跨境的全部出行。",
      "- carMin=早高峰模型车程，不含停车；PM/day乘逐小时速度中位比8点/目标小时，C级。ptMin/walkMin来自skim-active-transit（2026-09-22 07:30–08:30窗），步行R5上限2小时，补回接驳后可能超过2小时；其他时段沿用基础时刻与步行；不可达用null，不能当0分钟。","","## 字段来源和可信度","",
      "A=项目保存的官方原始输入；B=项目模型输出或确定性汇总；C=400米几何、游戏分类或时段近似；D=缺模型而明确假设。",
      "|字段|来源|级别|","|---|---|---|",
      "|网格坐标/land|luhk2024_codes.tif及其transform，400米多数类|B|",
      "|cells人口岗位|game.engine.places的50米pop/jobs；trip-ends-2026|B|",
      "|zones名字/区/总数|zones-2026.geojson、pl.zones标签、trip-ends-2026守恒取整|B|",
      "|zones.cell/cbd/zone_index|分区边界、50米人口岗位、landuse办公GFA|C|",
      "|stations ID/xy/线路、官方色|本地GTFS（重铁来自OSM）、places.json|B|",
      "|station cell、lines cells|真实站位栅格化及避让|C|",
      "|lines班次/容量、AM载客|transit-assignment-am-2026|B|",
      "|roads/sections几何|road-links/road-nodes，400米汇总|C|",
      "|AM OD/minutes/道路负荷|am-peak-2026、skim-active-transit、b.car_skim0、assignment-am-2026|B；格边负荷C|",
      "|PM/day OD|mode-split-2026、parameters-tcs2022的目的小时系数|C|",
      "|PM/day道路负荷|ATC 2024按AADT加权的11/18点对8点系数×AM|C|",
      "|PM/day港铁载客|AM载客×该时段总PT/AM总PT；PM反向|D|",
      "|holiday全部时段推算|HBO/NHB、用途/口岸去处代理、TD月客量高低比|D|","","## 核对结果","",
      json.dumps(NOTES["checks"],ensure_ascii=False),
      "人口和岗位与模型合计完全一致。海岸分类调整："+json.dumps(NOTES["coastal_grid"],ensure_ascii=False)+"。AM分钟空值数（car/pt/walk）："+json.dumps(am["null_minutes"],ensure_ascii=False)+"。"+json.dumps(files,ensure_ascii=False)+" MB。",
      "道路连通块（各块涉及格子数，从大到小）："+json.dumps(NOTES["roads"],ensure_ascii=False),
      "主要连通块以外的小块保留，没有凭空造连接路。400米共格可连通，但不证明原始路网能转向。",
      f"AM car={am['car']:,}，PT={am['pt']:,}，SPB={am['spb']:,} 人/小时；car={am['car_pct']}%，PT={am['pt_pct']}%；pairs覆盖car+PT {am['represented_pct']}%。",
      "各区核对采用出发区；模型和pairs同为内区→内区，下面最后两列均以car+PT为分母。","","|区|模型car|模型PT|输出car|输出PT|模型car%|输出car%|","|---|---:|---:|---:|---:|---:|---:|"]
    for r in am["by_district"]:
        text.append("|"+r["district"]+"|"+str(r["model_car"])+"|"+str(r["model_pt"])+"|"+str(r["car"])+"|"+str(r["pt"])+"|"+str(r["model_car_pct_of_car_pt"])+"|"+str(r["pair_car_pct"])+"|")
    text+=["","### 格边 v/c 最高15段","","|格段|道路|负荷|容量|v/c|原路ID|","|---|---|---:|---:|---:|---|"]
    for r in am["top_vc"]: text.append(f"|{r['section']}|{r['name']}|{r['load']}|{r['cap']}|{r['vc']}|{','.join(map(str,r['model_links']))}|")
    text+=["","### 原模型 v/c 最高15方向及格段映射","","|原路|道路|方向|v/c|对应格段|","|---|---|---|---:|---|"]
    for r in NOTES["model_top_vc"]: text.append(f"|{r['link']}|{r['name']}|{r['side']}|{r['vc']}|{','.join(map(str,r['grid_sections'])) or r['reason']}|")
    text+=["","两张表不要求排名相同：格边合并平行及交叉道路后容量与流量改变，且原模型高负荷可能发生在400米同格内部。保留model_links支持追溯。","","### 港铁站序"]
    for r in NOTES["rail_order"]: text.append("- "+r["line"]+"："+str(r["stations"])+"站，"+" → ".join(r["order"]))
    text+=["","### 移格站列表"]
    for r in NOTES["moved_stations"]: text.append("- "+r["name"]+"："+str(r["from"])+" → "+str(r["to"]))
    if not NOTES["moved_stations"]: text.append("无须移格。")
    if len(D)>1:
        text+=["","## PM/day参数","",
          "小时系数=该目的目标小时图值/该目的24小时图值合计。PM HBW回程根据40%回家比例×0.5，再从小时总量扣除；HBS全部回程；HBO/NHB及跨境其他各半。11点各目的各半；方向缺少实测，C级。没有把AM普查的方式调整系数强加到其他小时。",
          "18点："+json.dumps(NOTES["coefficients_18"],ensure_ascii=False),
          "11点："+json.dumps(NOTES["coefficients_11"],ensure_ascii=False),
          "道路普查缩放："+json.dumps(NOTES["road_hourly_census"],ensure_ascii=False)+"；"+json.dumps(NOTES["road_hourly_factors"],ensure_ascii=False),
          "车程速度比中位数：18点 "+str(rnd(NOTES["time_factor_18"]))+"，11点 "+str(rnd(NOTES["time_factor_11"]))+"。这些数据不构成新的交通分配。",
          "","## 节假日D级假设","",
          "11–12点仅保留HBO+NHB构成，不含上班/上学；总量归一到平峰全目的内区机动人流×月际高低比；去处权重=1+455×各代理归一份额之和，四类代理等权；先对目的地加权，再逐出发区归一，保持每区原HBO/NHB总量；70%去程、30%回程。",
          "代理为购物零售GFA、郊野/保育/休憩/开放空间面积、迪士尼和海洋公园母站数量、跨境控制点宿主区数量。没有可靠海滩数据，无法单独对海滩加权；公园面积也不等于实际游客量。",
          "2025港铁日客量最高月/最低月比例："+json.dumps(NOTES["holiday"],ensure_ascii=False)+"。这是月际旺淡量级，不能当节假日实测增幅。道路按平峰车流×节假日car/day car；港铁按AM载客×holiday PT/AM PT。分钟沿用平峰近似。"]
    text+=["","## 独立验证","",
      "scripts/verify_source.py逐项对照原始NPZ/parquet：分区与格子守恒、AM/PM/day OD阈值与人数、方式占比、AM分钟空值与取整、港铁volume/容量。结果在out/source-verification.json。",
      "scripts/verify_viewer.mjs用现有Playwright和Edge离线核对输出schema/引用/4连通，检查四时段切换、平移、缩放、图层与指格提示，结果在out/verification.json；另保存全港和九龙东截图。核对使用显式离线模式，浏览器临时目录也位于任务51。"]
    text+=["","## 已知限制 / 拿不准","",
      "- 轻铁未做；分区英文名缺失；英文路名未全部找到中文对照。",
      "- 没有PM/day/holiday独立网络分配；非AM港铁载客为D级全局缩放，无法反映实际线路分流。节假日不含游客独立产生量及口岸控制点外部OD。",
      "- 有人口/岗位的海岸多数水域格已用本格真实非水地类修正；不移动居民或岗位。山林不是正式山高程。",
      "- 税费/停车分钟、桥隧转向、立交高程、车道分流未展开；格边模型主要供任务52/53初版。",
      "- viewer只用于核对几何与负荷，双击离线可开，内嵌展示必要数据；数据权威文件为JSON。",
      "","## 尚无本地中文对照的路名","", "、".join(NOTES["untranslated_roads"])]
    (DEST/"说明.md").write_text("\n".join(text)+"\n",encoding="utf-8")
    save("checks.json",NOTES)
def apply_road_names(B):
    import re
    places=json.loads((W/"places.json").read_text(encoding="utf-8"))["places"]
    candidates=defaultdict(set)
    for p in places:
        en=[s.strip().upper() for s in re.split("[,，]",p.get("name_en",""))]
        zh=[s.strip() for s in re.split("[,，]",p.get("name_zh",""))]
        if len(en)!=len(zh): continue
        for e,z in zip(en,zh):
            if not re.search(r"[\u3400-\u9fff]",z) or re.search("[A-Za-z0-9]",z): continue
            if not re.search(r"(道|路|街|徑|径|里|巷|橋|桥|隧道)$",z): continue
            candidates[e].add(z)
    accepted={e:next(iter(v)) for e,v in candidates.items() if len(v)==1}
    mapping={}
    for road in B["roads"]:
        e=road["en"]
        if e and e.upper() in accepted:
            name=TRAD.convert(accepted[e.upper()])
            road["name"]=name; road["hans"]=CC.convert(name); road["name_source"]="data/web/places.json"
            mapping[e]={"name":name,"hans":CC.convert(name),"source":"data/web/places.json bilingual stop-name components"}
    for row in NOTES["model_top_vc"]:
        if row["name"].upper() in accepted: row["name_zh"]=TRAD.convert(accepted[row["name"].upper()])
    NOTES["untranslated_roads"]=sorted({r["en"] for r in B["roads"] if r["en"] and r["name"].isascii()})
    NOTES["road_names"]={"translated_distinct":len(mapping),"untranslated_distinct":len(NOTES["untranslated_roads"]),
      "source":"data/web/places.json","rule":"English exact match; aligned comma components; Chinese road suffix; conflicting candidates rejected"}
    save("road-name-map.json",mapping)

def main():
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument("--am-only",action="store_true"); args=parser.parse_args()
    log("Loading existing model read-only (-B)")
    b,pl=get_base(),get_places(); B=geometry(b,pl); rail=railway(B); loads=roads(B); apply_road_names(B); areas(B)
    B["sources"]={"grid":"Planning Department luhk2024_codes.tif; HK1980",
      "population_jobs":"game.engine.places 50m grid, trip-ends-2026.parquet","zones":"zones-2026.geojson; landuse-2026.parquet",
      "stations_lines":"hk-merged.gtfs.zip; places.json; transit-assignment-am-2026.parquet","road_names":"data/web/places.json bilingual stop names",
      "roads":"road-links.parquet; road-nodes.parquet; assignment-am-2026.parquet"}
    B["tiers"]={"land":"B","cells":"B","zones":"B","cbd":"C","stations":"B","line_geometry":"C","roads":"C","sections":"C","areas":"C"}
    am=np.load(M/"am-peak-2026.npz")
    assert list(am["zones"].astype(str))==b.ids
    people={m:am["P_"+m].astype(float) for m in b.modes}
    ptmin=npzmat(M/"skim-active-transit.npz","transit_min",b.inner); walkmin=npzmat(M/"skim-active-transit.npz","walk_min",b.inner)
    D={"am":demand("am",people,B,b,loads["am"],rail,ptmin,walkmin,b.car_skim0)}
    save("hk-base.json",B); save("hk-demand-am.json",D["am"]); log("Base and AM JSON saved")
    validate(B,D,b); report(B,D); log("AM checks passed")
    if "viewer" in globals(): viewer(B,D)
    if not args.am_only:
        ampt=people["PT"][:b.n,:b.n].sum()
        for period,hour in [("pm",18),("day",11)]:
            log("4 "+period)
            q=hour_people(b,hour); factor=q["PT"][:b.n,:b.n].sum()/ampt
            D[period]=demand(period,q,B,b,loads[period],rail,ptmin,walkmin,b.car_skim0*NOTES["time_factor_"+str(hour)],factor)
            save("hk-demand-"+period+".json",D[period])
        log("5 holiday D scenario")
        q,mult=holiday_people(b)
        factor=q["PT"][:b.n,:b.n].sum()/ampt
        cratio=(q["PV"]+q["TAXI"])[:b.n,:b.n].sum()/(hour_people(b,11)["PV"]+hour_people(b,11)["TAXI"])[:b.n,:b.n].sum()
        hs=[[sid,integer(load*cratio),rnd(vc*cratio)] for sid,load,vc in loads["day"]]
        D["holiday"]=demand("holiday",q,B,b,hs,rail,ptmin,walkmin,b.car_skim0*NOTES["time_factor_11"],factor)
        save("hk-demand-holiday.json",D["holiday"]); validate(B,D,b)
        if "viewer" in globals(): viewer(B,D)
        report(B,D)
    log(json.dumps({"checks":NOTES["checks"],"files_mb":NOTES["file_sizes_mb"]},ensure_ascii=True))

VIEWER=r"""<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>香港 400 米格子底板 · 任务51</title>
<style>
:root{--paper:#EEF3F8;--ink:#2B3A4A;--accent:#2F6FD6}*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif}
main{display:grid;grid-template-columns:1fr 290px;height:100vh;overflow:hidden}
#map{position:relative;min-width:0}canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
canvas:active{cursor:grabbing}aside{padding:22px 20px;background:#ffffffda;border-left:1px solid #b8c4cc;overflow:auto}
h1{font-size:22px;line-height:1.3;margin:0 0 5px}h2{font-size:13px;letter-spacing:.08em;margin:20px 0 9px}
.sub{opacity:.65;font-size:12px}.periods{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:20px 0 10px}
button,select{font:inherit;color:inherit;border:1px solid #bac5c9;border-radius:5px;background:#fff;padding:7px 9px}
button{cursor:pointer}button.active{background:var(--accent);color:white;border-color:var(--accent)}
button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #cf9a43;outline-offset:2px}
.layers{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:flex;gap:6px;align-items:center}
input{accent-color:var(--accent)}select{width:100%;margin-bottom:7px}#fit{width:100%}
.card{background:var(--paper);padding:12px;border-radius:5px;margin-top:14px}#hover{min-height:145px}
.big{font-size:18px;font-weight:600}#legend span{display:block;margin:4px 0}.sw{display:inline-block;width:12px;height:3px;vertical-align:middle;margin-right:6px}
#hint{position:absolute;bottom:16px;left:18px;background:#ffffffe8;border:1px solid #bac5c9;padding:6px 10px;border-radius:5px;font-size:12px}
#status{font-size:12px;line-height:1.6}.muted{opacity:.65}#railkeys{font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:4px}
@media(max-width:760px){main{grid-template-columns:1fr 230px}aside{padding:14px}h1{font-size:18px}}
</style>
<main><div id="map"><canvas id="canvas" aria-label="香港格子地图"></canvas><div id="hint">拖动平移 · 滚轮缩放 · 指向格子查看数据</div></div>
<aside><div class="sub">TRANSITLAB · 任务51</div><h1>香港 400 米底板</h1><div class="sub">离线数据核对 · 160 × 120 格</div>
<div class="periods" id="periods"></div><div id="status"></div>
<h2>图层</h2><div class="layers">
<label><input id="terrain" type="checkbox" checked>地形</label><label><input id="population" type="checkbox">人口</label>
<label><input id="jobs" type="checkbox">岗位</label><label><input id="roads" type="checkbox" checked>道路</label>
<label><input id="metro" type="checkbox" checked>港铁</label><label><input id="areas" type="checkbox" checked>片区框</label></div>
<h2>20 个切图片区</h2><select id="area"><option value="">全港</option></select><button id="fit">回到全港</button>
<div id="hover" class="card"><div class="big">指向一格</div><div class="muted">查看分区、人口和岗位。</div></div>
<h2>道路 v/c</h2><div id="legend"><span><i class="sw" style="background:#62917a"></i>≤ 0.8 畅通</span>
<span><i class="sw" style="background:#d69645"></i>0.8–1.0 接近容量</span><span><i class="sw" style="background:#bf4a4a"></i>&gt; 1.0 超出容量</span></div>
<h2>港铁官方色</h2><div id="railkeys"></div><div class="sub" style="margin-top:20px">400米会合并立交与平行道路。非早高峰港铁载客和节假日为推算；详见说明.md。</div>
</aside></main><script id="dataset" type="application/json">__DATA__</script>
<script>
"use strict";
const data=JSON.parse(document.getElementById("dataset").textContent),B=data.base,D=data.demands;
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),map=document.getElementById("map");
const $=id=>document.getElementById(id),fmt=n=>Math.round(n).toLocaleString("zh-CN");
let period="am",scale=5,ox=0,oy=0,w=0,h=0,dpr=1,hover=null,drag=null,vc=new Map();
const cellData=new Map(B.cells.map(c=>[c[1]*B.cols+c[0],c])),stByCell=new Map(B.stations.map(s=>[s.cell[1]*B.cols+s.cell[0],s]));
const landnames={"~":"海","w":"河流/水塘","^":"山林/灌丛","g":"休憩绿地","r":"住宅","c":"商业","i":"工业","m":"机构/混合","p":"港口/机场","o":"其他已建","." :"农地/空地"};
const colors={"~":"#c8dee5","w":"#b3d7df","^":"#c9d4c1","g":"#d9e2ca","r":"#e6d4bd","c":"#d8c2bd","i":"#c5cdd2","m":"#ded4c4","p":"#ccd0d1","o":"#dedbd0","." :"#e7e5d4"};
function line(a,b){ctx.beginPath();ctx.moveTo(a[0]+.5,a[1]+.5);ctx.lineTo(b[0]+.5,b[1]+.5);ctx.stroke()}
function jam(v){return v>1?"#bf4a4a":v>.8?"#d69645":"#62917a"}
function draw(){
 const theme=D[period].theme;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=theme.paper;ctx.fillRect(0,0,w,h);
 ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);
 const c0=Math.max(0,Math.floor(-ox/scale)),r0=Math.max(0,Math.floor(-oy/scale));
 const c1=Math.min(B.cols,Math.ceil((w-ox)/scale)),r1=Math.min(B.rows,Math.ceil((h-oy)/scale));
 for(let r=r0;r<r1;r++)for(let c=c0;c<c1;c++){
  const k=r*B.cols+c,ch=B.land[k],val=cellData.get(k);
  if($("terrain").checked){ctx.fillStyle=colors[ch]||theme.paper;ctx.fillRect(c,r,1,1);
   if(scale>7&&ch==="^"){ctx.fillStyle="#9aac93";ctx.fillRect(c+.2,r+.22,.15,.42);ctx.fillRect(c+.12,r+.32,.31,.15);ctx.fillRect(c+.58,r+.5,.25,.2)}
   if(scale>8&&"rcim".includes(ch)){ctx.fillStyle=ch==="i"?"#8c9ba4":"#b99c85";ctx.fillRect(c+.17,r+.24,.29,.53);ctx.fillRect(c+.57,r+.15,.26,.43);ctx.fillStyle="#f1e8d4";ctx.fillRect(c+.22,r+.35,.06,.09);ctx.fillRect(c+.34,r+.5,.06,.09);ctx.fillRect(c+.61,r+.24,.06,.09)}
  }
  if(val&&$("population").checked){ctx.globalAlpha=Math.min(.8,Math.log1p(val[2])/13);ctx.fillStyle="#346a9f";ctx.fillRect(c,r,1,1);ctx.globalAlpha=1}
  if(val&&$("jobs").checked){ctx.globalAlpha=Math.min(.8,Math.log1p(val[3])/13);ctx.fillStyle="#a25b45";ctx.fillRect(c,r,1,1);ctx.globalAlpha=1}
  if(scale>4){ctx.fillStyle="#42544f25";ctx.fillRect(c+.47,r+.47,.055,.055)}
 }
 if($("roads").checked){
  ctx.lineCap="square";ctx.lineWidth=.36;ctx.strokeStyle="#f5f0e1";
  B.sections.forEach(s=>line(s.a,s.b));
  ctx.lineWidth=.13;B.sections.forEach(s=>{ctx.strokeStyle=jam(vc.get(s.id)?.[2]||0);line(s.a,s.b)});
 }
 if($("areas").checked){ctx.strokeStyle=theme.accent;ctx.lineWidth=.065;ctx.setLineDash([.3,.25]);ctx.globalAlpha=.45;
  B.areas.forEach(a=>{const q=a.box;ctx.strokeRect(q[0],q[1],q[2]-q[0],q[3]-q[1])});ctx.setLineDash([]);ctx.globalAlpha=1;
  if(scale>9){ctx.fillStyle=theme.ink;ctx.font=".75px sans-serif";B.areas.forEach(a=>ctx.fillText(a.hans,a.box[0]+.2,a.box[1]+.9))}
 }
 if($("metro").checked){ctx.lineJoin="round";ctx.lineCap="round";ctx.lineWidth=.16;
  B.lines.forEach(l=>{ctx.strokeStyle=l.color;ctx.beginPath();l.cells.forEach((c,i)=>i?ctx.lineTo(c[0]+.5,c[1]+.5):ctx.moveTo(c[0]+.5,c[1]+.5));ctx.stroke()});
  B.stations.forEach(s=>{const x=s.cell[0]+.5,y=s.cell[1]+.5;ctx.fillStyle="#fffaf0";ctx.strokeStyle=theme.ink;ctx.lineWidth=.065;ctx.beginPath();ctx.arc(x,y,.2,0,Math.PI*2);ctx.fill();ctx.stroke();
   if(scale>19){ctx.fillStyle=theme.ink;ctx.font=".52px sans-serif";ctx.fillText(s.hans,x+.25,y-.18)}
  });
 }
 if(hover){ctx.strokeStyle=theme.ink;ctx.lineWidth=.1;ctx.strokeRect(hover[0],hover[1],1,1)}
}
function changePeriod(p){period=p;const d=D[p];vc=new Map(d.sections.map(x=>[x[0],x]));document.documentElement.style.setProperty("--paper",d.theme.paper);
 document.documentElement.style.setProperty("--ink",d.theme.ink);document.documentElement.style.setProperty("--accent",d.theme.accent);
 document.querySelectorAll(".periods button").forEach(b=>b.classList.toggle("active",b.dataset.period===p));
 $("status").textContent=d.hours+" · "+d.tier+" 级；开车 "+d.checks.car_pct+"% / 公交 "+d.checks.pt_pct+"%。";
 draw();
}
function fit(box){const q=box||[0,0,B.cols,B.rows],pad=box?40:22;scale=Math.min((w-pad*2)/(q[2]-q[0]),(h-pad*2)/(q[3]-q[1]));
 ox=(w-(q[2]+q[0])*scale)/2;oy=(h-(q[3]+q[1])*scale)/2;draw()}
function resize(){const rect=map.getBoundingClientRect();w=rect.width;h=rect.height;dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);fit()}
function showCell(c,r){if(c<0||r<0||c>=B.cols||r>=B.rows){hover=null;$("hover").innerHTML='<div class="big">图外</div>';return}
 hover=[c,r];const k=r*B.cols+c,v=cellData.get(k)||[c,r,0,0],zi=B.zone_index[k],z=zi>=0?B.zones[zi]:null,s=stByCell.get(k);
 $("hover").replaceChildren();const a=document.createElement("div");a.className="big";a.textContent=z?z.hans:"分区外 / 水域";$("hover").append(a);
 const lines=["格 "+c+", "+r+" · "+landnames[B.land[k]],z?z.district+" · "+z.id:"中心点未落入分区","人口 "+fmt(v[2])+" · 岗位 "+fmt(v[3])];
 if(s)lines.push("港铁："+s.hans+" · "+s.lines.join(" / "));
 lines.forEach(t=>{const d=document.createElement("div");d.textContent=t;$("hover").append(d)});
}
Object.keys(D).forEach(p=>{const b=document.createElement("button");b.type="button";b.textContent=D[p].hans;b.dataset.period=p;b.addEventListener("click",()=>changePeriod(p));$("periods").append(b)});
B.areas.forEach((a,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=a.hans;$("area").append(o)});
B.lines.forEach(l=>{const d=document.createElement("div"),sw=document.createElement("i");sw.className="sw";sw.style.background=l.color;d.append(sw,document.createTextNode(l.hans));$("railkeys").append(d)});
["terrain","population","jobs","roads","metro","areas"].forEach(id=>$(id).addEventListener("change",draw));
$("fit").addEventListener("click",()=>{$("area").value="";fit()});$("area").addEventListener("change",()=>fit($("area").value===""?null:B.areas[Number($("area").value)].box));
canvas.addEventListener("wheel",e=>{e.preventDefault();const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
 const gx=(mx-ox)/scale,gy=(my-oy)/scale;scale=Math.max(2,Math.min(85,scale*Math.exp(-e.deltaY*.001)));
 ox=mx-gx*scale;oy=my-gy*scale;draw()},{passive:false});
canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,ox,oy};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener("pointerup",e=>{drag=null;canvas.releasePointerCapture(e.pointerId)});
canvas.addEventListener("pointercancel",()=>drag=null);
canvas.addEventListener("pointermove",e=>{if(drag){ox=drag.ox+e.clientX-drag.x;oy=drag.oy+e.clientY-drag.y}
 const rect=canvas.getBoundingClientRect();showCell(Math.floor((e.clientX-rect.left-ox)/scale),Math.floor((e.clientY-rect.top-oy)/scale));draw()});
window.addEventListener("resize",resize);resize();changePeriod("am");
window.__hkViewer={base:B,demands:D,getState:()=>({period,scale,ox,oy,w,h,hover})};
</script></html>"""
def viewer(B,D):
    view={"base":B,"demands":{p:{k:d[k] for k in ["period","hans","hours","theme","tier","sections","lines","checks"]} for p,d in D.items()}}
    embedded=json.dumps(view,ensure_ascii=False,separators=(",",":"),allow_nan=False).replace("</","<\\/")
    (OUT/"viewer.html").write_text(VIEWER.replace("__DATA__",embedded),encoding="utf-8")

if __name__ == '__main__': main()
