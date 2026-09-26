# 数据来源总目录：核对记录

核对时间：2026-09-26；项目只读。辅助脚本只在本输出目录运行，未执行任何 `pipeline/` 脚本，也未访问网络。

## 计数方法

- Parquet：项目虚拟环境的 `pyarrow.parquet.read_metadata(path)`，记录 `num_rows` 与 schema；不读数据列。
- GDB ZIP：先设 `CPL_TMPDIR=F:/tools/gdal-tmp`，再用 `pyogrio.list_layers` 与 `pyogrio.read_info` 取得各图层 `features` 与字段。
- GTFS ZIP：用 `zipfile` 打开包内 `.txt` 表，流式逐行数、扣除表头。ZIP 成员数本身不能当作线路数。
- NPZ：只看压缩包内 `.npy` 文件头的 `shape`，没有加载矩阵值；470×470 是矩阵维度，并非实测人数。
- GeoJSON／JSON：读顶层结构和 `features`／`dataSet`／列表长度；CSV：用 `csv.reader` 逐行计数，扣除表头；大小：文件系统 `stat().st_size`。
- PDF、文字稿、XLS、PBF、TIF 和底图包：只记录本地文件数与大小；行数没有逐条记录语义时不强行相加。

## 逐来源文件及数字

| 编号 | 文件路径或组 | 本稿引用的实际计数与大小 | 读取方法 |
|---|---|---|---|
| A01 | `data/raw/census/stpug_2021.geojson` | 211 条；34.87 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A02 | `data/raw/projections/table_1.csv` | 26 条；2.7 KB | csv.reader 流式计数（不含表头） |
| A02 | `data/raw/projections/table_7.csv` | 500 条；49.4 KB | csv.reader 流式计数（不含表头） |
| A02 | `data/raw/projections/table_15.csv` | 212 条；15.2 KB | csv.reader 流式计数（不含表头） |
| A03 | `data/raw/projections/csd_110-01001.json` | dataSet 11,154 条；3.55 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A03 | `data/raw/projections/csd_110-01002.json` | dataSet 50,322 条；15.51 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A03 | `data/raw/projections/csd_110-01003.json` | dataSet 1,048 条；245.9 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A04 | `data/raw/socioeconomic/csd_130-06601.json` | dataSet 3,312 条；861.1 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A04 | `data/raw/socioeconomic/csd_130-06603.json` | dataSet 1,220 条；336.7 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A04 | `data/raw/socioeconomic/csd_130-06606.json` | dataSet 1,656 条；426.2 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A04 | `data/raw/socioeconomic/csd_130-06806.json` | dataSet 1,900 条；482.4 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| A05 | `data/raw/tpedm/tpedm-2021-based.geojson` | 18 条；737.9 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| B01 | `data/raw/landuse/luhk2024_codes.tif` | 无逐条计数；2.48 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| B01 | `data/raw/landuse/luhk2024_statistics_english.csv` | 27 条；1.7 KB | csv.reader 流式计数（不含表头） |
| B01 | `data/raw/landuse/luhk2024_statistics_sc.csv` | 27 条；1.4 KB | csv.reader 流式计数（不含表头） |
| B02 | `data/raw/zoning/` | 540 个文件；536.56 MB | 文件枚举与 stat；同组条数另看审计或主表 |
| B03 | `data/raw/rvd/` | 16 个文件；33.1 KB | 文件枚举与 stat；同组条数另看审计或主表 |
| B04 | `data/raw/policy/` | 10 个文件；4.46 MB | 文件枚举与 stat；同组条数另看审计或主表 |
| C01 | `data/raw/buildings/building-stock-raw.parquet` | 222,354 条；9.46 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| C01 | `data/raw/buildings/building-stock.parquet` | 222,354 条；9.61 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| C01 | `data/raw/buildings/buildings-classified.parquet` | 222,354 条；10.02 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| C02 | `data/raw/buildings/bd-building-usage.csv` | 51,354 条；17.94 MB | csv.reader 流式计数（不含表头） |
| C03 | `data/raw/schools/schools.parquet` | 3,063 条；145.9 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| C03 | `data/web/zones-schools.geojson` | 455 条；1.13 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| C04 | `data/raw/institutions/facilities.parquet` | 291 条；15.4 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| C04 | `data/web/zones-institutions.geojson` | 455 条；1.09 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| C05 | `data/raw/hotels/hotel-rooms-by-district.csv` | 1 条；896 B | csv.reader 流式计数（不含表头） |
| D01 | `data/raw/road-network/RdNet_IRNP.gdb.zip` | CENTERLINE 36,471 条；INTERSECTION 27,320 条；TURN 11,051 条；TUN_BRIDGE_TOLL 49 条；TUN_BRIDGE_TV_TOLL 1,112 条；17.02 MB | CPL_TMPDIR=F:/tools/gdal-tmp 后，pyogrio.read_info 各图层 features |
| D02 | `data/raw/osm/hong-kong-latest.osm.pbf` | 无逐条计数；37.54 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| E01 | `data/raw/gtfs_official/td-gtfs-en.zip` | routes.txt 2,452 行；stops.txt 9,447 行；trips.txt 82,397 行；frequencies.txt 76,328 行；stop_times.txt 1,369,514 行；13.69 MB | zipfile 内各 GTFS 文本表逐行计数（不含表头） |
| E01 | `data/raw/gtfs_official/td-gtfs-tc.zip` | routes.txt 2,452 行；stops.txt 9,447 行；trips.txt 82,397 行；frequencies.txt 76,328 行；stop_times.txt 1,369,514 行；13.69 MB | zipfile 内各 GTFS 文本表逐行计数（不含表头） |
| E02 | `data/raw/gtfs_community/hk.gtfs.zip` | routes.txt 1,623 行；stops.txt 14,765 行；trips.txt 4,891 行；frequencies.txt 50,297 行；stop_times.txt 104,422 行；18.78 MB | zipfile 内各 GTFS 文本表逐行计数（不含表头） |
| E03 | `data/raw/gtfs_merged/hk-merged.gtfs.zip` | routes.txt 2,473 行；stops.txt 9,824 行；trips.txt 82,443 行；frequencies.txt 76,480 行；stop_times.txt 1,370,156 行；10.26 MB | zipfile 内各 GTFS 文本表逐行计数（不含表头） |
| F01 | `data/raw/tcs/tcs2022_eng.pdf` | 无逐条计数；5.25 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F01 | `data/raw/tcs/tcs2022_eng.txt` | 无逐条计数；170.1 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F01 | `data/raw/tcs/tcs2022app_eng.pdf` | 无逐条计数；1.84 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F01 | `data/raw/tcs/tcs2022app_eng.txt` | 无逐条计数；26.2 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F02 | `data/raw/tcs/gvtcs2011_eng.pdf` | 无逐条计数；1.57 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F02 | `data/raw/tcs/gvtcs2011_eng.txt` | 无逐条计数；83.7 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F02 | `data/raw/tcs/gvtcs2011app_eng.pdf` | 无逐条计数；2.08 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F02 | `data/raw/tcs/gvtcs2011app_eng.txt` | 无逐条计数；13.2 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v1.pdf` | 无逐条计数；4.45 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v1.txt` | 无逐条计数；292.5 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v2.pdf` | 无逐条计数；8.69 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v2.txt` | 无逐条计数；656.9 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v6.pdf` | 无逐条计数；10.90 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v6.txt` | 无逐条计数；636.7 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v9.pdf` | 无逐条计数；6.24 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| F03 | `data/raw/tpdm/tpdm_v9.txt` | 无逐条计数；428.1 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| G01 | `data/raw/atc/ATC_IRNP.gdb.zip` | ATC_STATION_PT 1,694 条；ATC_STATION_LINE 356 条；86.7 KB | CPL_TMPDIR=F:/tools/gdal-tmp 后，pyogrio.read_info 各图层 features |
| G01 | `data/raw/atc/ATC_TRAFFIC_DATA.zip` | 无逐条计数；33.71 MB | zipfile 成员目录；可用的条数另取审计 JSON |
| G01 | `data/raw/atc/extract/S1001.xls` | 无逐条计数；89.6 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| G01 | `data/raw/atc/extract/sample.xls` | 无逐条计数；84.0 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| G01 | `data/web/traffic/atc-stations.json` | records 2,422 条；1.35 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| G01 | `data/web/traffic/atc-occupancy.json` | stations 763 条；6.98 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| G02 | `data/raw/traffic/rawSpeedVol-lanes.xml` | 无逐条计数；708.8 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| G02 | `data/web/traffic/detectors.json` | 807 条；187.8 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| G02 | `data/web/traffic/observed-` | 24 个文件；5.60 MB | 文件枚举与 stat；同组条数另看审计或主表 |
| G03 | `data/raw/td-digest/` | 18 个文件；4.53 MB | 文件枚举与 stat；同组条数另看审计或主表 |
| H01 | `data/raw/cross-boundary/daily-passengers.parquet` | 28 条；5.0 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| H01 | `data/web/cross-boundary.json` | control_points 15 条；5.6 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| H02 | `data/raw/cross-boundary/students-by-point-and-level.csv` | 540 条；40.2 KB | csv.reader 流式计数（不含表头） |
| H03 | `data/raw/td-digest/2606_table81a.xls` | 无逐条计数；46.6 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81b.xls` | 无逐条计数；35.8 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81c.xls` | 无逐条计数；49.2 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81d.xls` | 无逐条计数；39.9 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81e.xls` | 无逐条计数；42.5 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81f.xls` | 无逐条计数；43.0 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/2606_table81g.xls` | 无逐条计数；51.2 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| H03 | `data/raw/td-digest/1112_table41a.txt` | 无逐条计数；76.1 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I01 | `data/raw/road-network/RdNet_IRNP.gdb.zip` | CENTERLINE 36,471 条；INTERSECTION 27,320 条；TURN 11,051 条；TUN_BRIDGE_TOLL 49 条；TUN_BRIDGE_TV_TOLL 1,112 条；17.02 MB | CPL_TMPDIR=F:/tools/gdal-tmp 后，pyogrio.read_info 各图层 features |
| I02 | `data/raw/fares/taxi-fare-urban.json` | 无逐条计数；671 B | JSON 结构：features／dataSet／顶层列表长度和键 |
| I02 | `data/raw/taxi/legco_brief_taxi_fare_2024.pdf` | 无逐条计数；1.13 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/legco_brief_taxi_fare_2024.txt` | 无逐条计数；49.2 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/legco_issh_taxi_2025.pdf` | 无逐条计数；305.9 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/legco_issh_taxi_2025.txt` | 无逐条计数；14.7 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/legco_tp_taxi_fare_2024.pdf` | 无逐条计数；665.6 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/legco_tp_taxi_fare_2024.txt` | 无逐条计数；25.8 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/ptss_final_report_2017.pdf` | 无逐条计数；5.09 MB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I02 | `data/raw/taxi/ptss_final_report_2017.txt` | 无逐条计数；260.0 KB | 文件系统 stat 读取大小；非逐条表或本次未解析内部行数 |
| I03 | `data/raw/fares/mtr_lines_fares.csv` | 9,216 条；743.9 KB | csv.reader 流式计数（不含表头） |
| I04 | `data/raw/prices/csd_510-60001.json` | dataSet 7,908 条；1.63 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| J01 | `data/build/basemap/` | 28 个文件；200.99 MB | 文件枚举与 stat；同组条数另看审计或主表 |
| J02 | `data/raw/placenames/GEO_PLACE_NAME.geojson` | 2,706 条；829.6 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| J02 | `data/raw/placenames/PLACE_NAME.geojson` | 2,826 条；748.8 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| J02 | `data/web/places.json` | places 9,548 条；1.29 MB | JSON 结构：features／dataSet／顶层列表长度和键 |
| J03 | `data/raw/boundaries/districts_18.json` | 18 条；796.6 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| K01 | `data/model/landuse-2026.parquet` | 455 条；121.3 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K02 | `data/model/parameters-tcs2022.json` | 无逐条计数；19.7 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| K03 | `data/model/trip-ends-2026.parquet` | 470 条；74.0 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K03 | `data/model/building-trip-ends.parquet` | 222,193 条；6.95 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| K04 | `data/model/road-links.parquet` | 36,471 条；1.77 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| K04 | `data/model/road-nodes.parquet` | 27,319 条；564.7 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K04 | `data/model/road-turns.parquet` | 11,051 条；114.6 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K04 | `data/model/road-connectors.parquet` | 1,266 条；19.1 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K04 | `data/model/zone-centres.parquet` | 455 条；20.3 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K05 | `data/model/census-links.parquet` | 416 条；15.5 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K06 | `data/model/road-speeds-hourly.parquet` | 1,144,632 条；489.4 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K07 | `data/model/bpr-parameters.json` | 无逐条计数；84 B | JSON 结构：features／dataSet／顶层列表长度和键 |
| K08 | `data/model/skim-car-freeflow.npz` | 分区轴 455；矩阵 455×455；2.34 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K09 | `data/model/skim-active-transit.npz` | 分区轴 455；矩阵 455×455；400.7 KB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K10 | `data/model/trip-distribution-2026.npz` | 分区轴 470；矩阵 470×470；3.06 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K11 | `data/model/mode-split-2026.npz` | 分区轴 470；矩阵 470×470；12.06 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K12 | `data/model/am-peak-2026.npz` | 分区轴 470；矩阵 470×470；5.52 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K13 | `data/model/bus-preload-am.parquet` | 21,983 条；200.1 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K13 | `data/model/bus-segment-paths.parquet` | 14,289 条；514.0 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K14 | `data/model/goods-2026.npz` | 分区轴 470；矩阵 470×470；3.21 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K15 | `data/model/assignment-am-2026.parquet` | 47,693 条；2.33 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| K16 | `data/model/skim-car-am-delay.npz` | 分区轴 455；矩阵 455×455；1.53 MB | ZIP 中 .npy 文件头的 shape（未读矩阵值） |
| K17 | `data/model/taxi-requests-2026.parquet` | 715,443（9/26 下午重跑后；Codex 读时为 717,198） 条；10.58 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| K18 | `data/model/taxi-fleet-hourly.parquet` | 24 条；6.8 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K19 | `data/model/td-digest-series.json` | 无逐条计数；22.2 KB | JSON 结构：features／dataSet／顶层列表长度和键 |
| K20 | `data/model/fleet-simulation-2026.parquet` | 24 条；8.0 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K21 | `data/model/deployment-scenarios.parquet` | 240 条；23.6 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K22 | `data/model/extra-scenarios.parquet` | 240 条；27.8 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K23 | `data/model/duty-scenarios.parquet` | 408 条；22.7 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K24 | `data/model/land-utilization-2024.parquet` | 455 条；52.3 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K25 | `data/model/zoning-2026.parquet` | 11,958 条；45.08 MB | pyarrow.parquet.read_metadata：num_rows、schema |
| K25 | `data/model/zoning-capacity.parquet` | 455 条；56.6 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K26 | `data/model/property-values-2026.parquet` | 455 条；24.1 KB | pyarrow.parquet.read_metadata：num_rows、schema |
| K27 | `data/model/transit-assignment-am-2026.parquet` | 43,996 条；788.8 KB | pyarrow.parquet.read_metadata：num_rows、schema |

## 代码与审计中的交叉核对

| 本稿数字或判断 | 直接依据及读取方法 |
|---|---|
| 211 → 455 个内部小区；15 个口岸后为 470 个出行端点 | `data/web/zones-split-audit.json` 的 `census_zones`、`model_zones`；`data/web/cross-boundary.json` 的 `control_points` 长度；`trip-ends-2026.parquet` 的 Parquet 行数和 NPZ 的 `zones` 轴。 |
| 2026 人口采用统计处临时总量 | `data/web/landuse-2026-audit.json` 的 `population_2026`、`csd_mid_2026_whole_territory` 与 `report`，并参照 `pipeline/16_landuse_2026.py` 开头说明。 |
| 学校区级学额准确、逐校学额估算 | `data/web/zones-schools-audit.json` 的 `official_totals`、`allocated` 和 `report`；`pipeline/11_zone_schools.py` 开头说明。 |
| 口岸人次、学童及 1 人配平差 | `data/web/cross-boundary-audit.json` 的 `report` 和 `data/web/cross-boundary.json` 的结构；`pipeline/13_cross_boundary.py`。 |
| 道路中心线、转向、固定／分时收费条数 | `data/raw/road-network/RdNet_IRNP.gdb.zip` 的 `pyogrio.read_info` 图层 `features`；`data/web/road-network-audit.json` 的 `links`、`nodes`、`turns`、`tolls`。 |
| 探测器 807 个与 9/26 倍计修复 | `data/web/traffic/detectors.json` 顶层列表长度；`docs/for-codex/pipeline-manifest.md` 第 05 步及 `pipeline/05_traffic_detectors.py` 说明。 |
| 周年交通普查的空间站点与有效车流记录不相等 | GDB 图层 `ATC_STATION_PT` 的 `features`；`data/web/traffic/atc-stations.json` 的 `records` 列表长度。 |
| 路网容量、速度及收费的推算性质 | `pipeline/15_road_network.py` 开头说明与 `data/web/road-network-audit.json`；`pipeline/15d_speed_profiles.py` 和 `data/web/road-speeds-audit.json`。 |
| 方式划分中公交车费的近似 | `data/web/mode-choice-audit.json` 的 `report` 与 `pipeline/23_mode_choice.py`。 |
| 出行分布的自给率标记、道路分配的 GEH 标记 | `data/web/trip-distribution-audit.json`、`data/web/assignment-audit.json` 的 `flags`。GEH 是比较模型车流与实测车流差距的统计量。 |
| 模型文件推算链条与四阶段直接输入 | `docs/for-codex/pipeline-manifest.md` 的逐步输入／输出表，并交叉读相应 `pipeline/NN_*.py` 文件开头 docstring。 |
| 规划署表 15 的 212 行 | `data/raw/projections/table_15.csv` 由 `csv.reader` 计到 212 行；最后一行为“陆上总计”，其余 211 行是小区。 |
| TPDM 本地册数 | `data/raw/tpdm/` 目录文件名包含 `tpdm_v1`、`tpdm_v2`、`tpdm_v6`、`tpdm_v9`，各有 PDF 与文字稿。 |
| 网址 | 只取 `pipeline/` 脚本里明确写出的完整网址；没有完整网址时留空。 |

## 覆盖自查

- `data/raw/`：检查到 28 个子目录；目录覆盖缺项：无。
- `data/model/`：检查到 34 个顶层文件；目录覆盖缺项：无。
- `data/raw/zoning/` 中每张图则的 `ZONE.json`、`BHC.json`、`PLAN_SCHEME_AREA.json`、注释 PDF 按同一官方来源 B02 成组列出，未逐文件复制明细。
- `data/raw/policy/`、`data/raw/taxi/` 属政策与参考资料；已列 B04、I02，四阶段主计算不直接读取。
- `data/web/` 的 `*-audit.json` 是核对报告而非独立外部来源；所引用的报告已在对应来源与本记录列明。`data/cache/` 与 `data/snapshots/` 为可再生缓存或历史快照，未作为新增来源编号。

