# WaferMap · 晶圆膜厚分布分析

离线单页 Web 应用：把晶圆膜厚测量数据变成可交互的 **WaferMap / 等值线 / 剖面曲线 / 统计视图**。
双击 `index.html` 即可运行 —— **不装软件、不联网、不依赖服务器**，适合产线与涉密机器。

![version](https://img.shields.io/badge/version-v1.0.2-blue) ![offline](https://img.shields.io/badge/offline-file%3A%2F%2F-success) ![tests](https://img.shields.io/badge/tests-104%20assertions-brightgreen)

## 特性

**晶圆图**
- 插值：**薄板样条**（精确通过每个测点，平滑且保留边缘极值）/ 高斯核（可调 σ），栅格 120–400 可调
- **等高线**（marching squares，与色阶面共用同一栅格，永远一致）
- 色阶：Jet / Viridis / Inferno / 灰阶等，256 级查表
- 每测点 **± 符号**（高于/低于平均值）+ 数值标签（26 候选位自动避让）
- 竖直图例独立画布，不遮挡晶圆

**视图**
| 视图 | 内容 |
|---|---|
| 单晶圆 | WaferMap（含统计条）+ Lineplot + **按半径分环的箱线图** |
| 全量网格 | 所有膜厚列的 WaferMap / LineProfile 一次看完（双 TAB） |
| 统计对比 | Mean / Nu% 柱状图 + 统计表 |

**统计**：Mean · Median · Std（样本 `n−1`）· Range · Nu% = Std/\|Mean\|×100，小数位可选。

**导入导出**
- 导入：`.csv` / `.xlsx` / `.xlsm` / `.xls`（本地解析，不上传；多工作表自动挑数据表）
- 导出：单图 PNG（含统计条）、**拼版 PNG**（按界面列布局还原）、统计 CSV、数据 CSV

## 快速开始

1. `git clone https://github.com/LeoXuedong/WaferMap.git`（或下载源码 ZIP 解压）
2. 双击 `index.html`（Edge / Chrome 均可）
3. 点顶部「导入数据」，选择你的 CSV / Excel 文件

> 启动为空白，不预载任何数据；导入自己的 CSV / Excel 即可。

## 数据格式

```
X,Y,TK1,TK2,...
-147,-145,100.7,101.2,...
```

- 第一行表头；前两列为 X / Y 坐标（**mm**）
- 其后每列一个膜厚值（单位在左侧面板选 Å / nm，**仅切换显示标签**）

## 开发

```bash
node tests/unit.js           # 纯逻辑单测          62 条
node tests/acceptance.js     # Playwright 真实浏览器 103 条
node tests/make_fixtures.js  # 生成 xlsx 测试夹具（合成数据）
node tests/shot_real.js      # 截图（合成数据；WM_DATA=... 可换自己的文件）
node tests/shot_export.js    # 拼版 PNG 导出并校验尺寸
python build/pack_release.py # 打包 + 解压副本哈希比对
```

- 依赖：Node 18+、Playwright（Chromium；也可用 `CHROME_PATH` 指定本机浏览器）
- 真实机台文件：`WM_DATA=/path/to/file.xlsx node tests/shot_real.js`
- 无构建步骤：改完刷新即生效

## 结构

```
index.html          单页入口
css/app.css
js/core.js          CSV/XLSX 解析、数值列识别、色阶
js/stats.js         统计量、分位数、分箱
js/wafer.js         晶圆图渲染（插值、等高线、标签、统计条）
js/charts.js        Lineplot / 直方图 / 柱状 / 半径箱线图
js/views.js         三个视图 + 独立图例画布
js/export.js        单卡 / 拼版 PNG、CSV
js/app.js           状态、面板、导入导出
vendor/             ECharts 5.6.0 + SheetJS（本地内嵌，无 CDN）
tests/              unit / acceptance / 截图脚本 / fixtures
docs/开发记录.md     架构、算法口径、迭代史、问题全表
```

## 技术

Canvas 2D（晶圆图自绘）+ ECharts 5.6.0（曲线与统计图）+ SheetJS（Excel 解析）。
全部资源本地化，零网络请求 —— 断网可用。
