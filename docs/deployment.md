# 上线部署：底图怎么上传

## 为什么打包成 PMTiles

全港底图约 7,000 张瓦片。直接上传几千个小文件很慢，而且很多网站托管平台限制文件数量和单个文件大小。

PMTiles 是专门给地图瓦片用的**单文件**格式。浏览器用"范围请求"只读需要的那几段，不会整份下载。所以底图变成 **3 个文件 + 一小批字体/图标**，放到任何支持范围请求的静态存储上即可，**网站上线后底图不需要后端服务器**。

## 步骤

1. **下载全港瓦片到本地缓存**（约 1 小时，限速请求，可随时中断重跑）：
   ```powershell
   uv run python pipeline/03_prewarm_basemap_cache.py
   ```
2. **打包**（结果在 `data/build/basemap/`，脚本会抽样读回校验）：
   ```powershell
   uv run --with pmtiles python pipeline/04_build_basemap_pmtiles.py
   ```
3. **本地验证打包结果**：网址加 `?basemap=pmtiles`，后端会模拟静态托管提供这些文件。
4. **上传** `data/build/basemap/` 整个文件夹到对象存储，例如：
   - Cloudflare R2（免费额度 10 GB，下载流量免费）
   - 腾讯云 COS（比赛主合作方）

   需要开启**公开读取**，并配置 CORS：允许网站域名的 `GET`、`HEAD` 请求，放行 `Range` 请求头，暴露 `ETag` 响应头。
5. **构建前端**时指定底图地址，然后把 `frontend/dist/` 部署到静态网站托管平台：
   ```powershell
   $env:VITE_BASEMAP_PMTILES_BASE = "https://<你的存储域名>/basemap"
   cd frontend; npm run build
   ```

## 条款和署名

- CSDI 条款允许下载、复制和分发数据（商业、非商业均可），但须注明**香港特区政府及空间数据共享平台（CSDI）为数据来源**。
- 地图 API 要求地图上显示**地政总署标志**和 "© Map from Lands Department"，前端已经加上。
- Map API 文档要求避免短时间大量请求，所以下载脚本限速为每秒 2.5 个。

## 还没做的

- 搜索和交通模型接口仍需要后端服务器，部署方式到时再定。
- 地政总署标志目前从其官网加载，离线演示前应改为本地文件。
