# NEXUS RETAIL 2.0 — Development Report

**日期**：2026-11-24　**基线**：`origin/main` (V2 data-mining upgrade) 的严格超集（本地 `main` = 原版 + V3.4–V3.9 稳定性改进）
**目标**：在不破坏原版功能的前提下，完成 Advanced Data Mining + Machine Learning + Intelligent Robotics 全方位升级。

---

## 1. 交付概览

| 类别 | 交付内容 |
|---|---|
| 完整可运行项目 | `index.html` + 12 个 JS 模块 + 2 张样式表 + vendored Three.js；GitHub Pages 静态部署 |
| 新源代码 | `miningLab.js`（新增，约 700 行）— 8 个数据/实验页面渲染与交互 |
| 离线脚本 | `scripts/` 下新增 8 个独立脚本（数据画像 / 关联扫描 / 推荐分析 / 聚类 / 拥堵分类 / 通行回归 / 时间序列 / 异常检测） |
| 版本化数据 | `public/data/lab/*.json` 8 份，全部 `version:1.0.0`、`seed:6143`、真实 `seconds` |
| 模型评价结果 | 复购 AUC 0.7617、CF P@5 0.0639、拥堵分类/通行回归/预测/异常指标均由 sklearn 在独立数据上计算 |
| 三策略演示 | 同一订单共用一次 Held–Karp，三种 A* 代价真实对照，JSON/CSV 导出，选定策略真实 3D 执行 |
| 3D 仿真 | V3.9 行人视觉避让 + 宽通道 + 防卡死 + 三策略动态重规划面板 |
| 测试报告 | 本文件 + TEST_REPORT.md；冒烟 35/35、V30 11/11、V25 9/9、V26 10/10、V2、v35 三策略 6/6 |
| Bug 修复 | 修复 `table()` 接受字符串行、`renderChallengePanel` 未定义辅助函数、`data-profile` schema 容错、hero 标题对比度 |
| 原版功能保留 | 见第 4 节清单（全部通过回归） |
| 数据来源与方法 | 第 5 节 + README + 研究方法页 + 数据探索页内数据来源块 |
| 最终在线网址 | `https://robot-supermarket-sim.app.workbuddy.host/?sharecode=WIMJY2PWZ4`（部署后） |
| GitHub Pages | `.github/workflows/expire-pages.yml`（静态文件已包含所有新增 `public/data/lab/*.json`） |

---

## 2. 实施内容（对应原任务 19 步）

### 阶段 1–2：代码审计和备份 ✅
- 审计原版线上站（Live GitHub Pages）与本地源码：确认本地 `main` 是原版 `origin/main` 的超集（多 5 个稳定性提交），所有原版页面/交互/3D 模型/数据文件均在本地。
- 建立 git tag `backup-before-nexus20` + 目录副本 `C:/Users/联想/Desktop/6143_robot_backup_nexus20`。
- 修复基础问题：验证 Python 3.13 + pandas/numpy/sklearn；所有离线脚本独立容错，任一失败不影响其他模块。

### 阶段 3：Data Explorer ✅
`数据探索` 页面（`#view-data-explorer`）：
- 4 个数据集（3 真实 Instacart + 1 仿真通道表）字段类型、非空/缺失/缺失率/唯一值/示例
- 重复键检测、IQR 异常值分析、价格/重量/下单时段真实分布条形图
- 清洗流程可交互式勾选预览（显示预计剩余行数）
- 8+ 特征工程变换、真实商品属性标准化/归一化统计量（含原始 min/max）
- 数据集版本管理（schema 1.0.0，固定日期，可复现）
- 所有数据来自 `scripts/build_data_profile.py` → `lab/data-profile.json`

### 阶段 4：Apriori / 推荐 / K-Means 深化 ✅
- **关联规则**：`lab/association-analysis.json` 含 12 组真实参数扫描（minSupport 20/35/50/80 × minConf 0.1/0.25/0.4）；UI 可调参数即时筛选当前规则数/最大 Lift/平均置信度、Top 20 规则表、参数敏感性双条图、商品关联网络 SVG（节点大小=关联度，边粗细=Lift）、商品组合分析、公式与变量说明、货架邻接实际应用。**所有规则来自 131,209 个真实购物篮。**
- **推荐系统**：`lab/recommendation-analysis.json` 含用户-商品交互矩阵统计（用户/商品/非零单元/密度）、共现余弦相似度 top pairs、4 个种子商品的 Top-N 推荐 + 热门基线对比、Precision/Recall/NDCG@K 真实离线评价。数据不足限制明确标注。
- **聚类分析**：`lab/clustering-analysis.json` 两个完全独立实验：
  - 商品聚类（真实属性，K=2..8 的 inertia/silhouette、肘部法、PCA 散点、各簇均价/重量/热量/复购率/代表商品）
  - 客流聚类（仿真 Pedestrian Density/Dwell/Speed/Occupancy/Obstacles，K=2..6，簇区域类型标注）
  - UI 可切换实验域与 K 值，明确声明两类数据绝不混用。

### 阶段 5：分类 / 回归 / 时间序列 / 异常检测 ✅
- **监督学习 A（复购预测）**：原 `ml` 页保留，真实 LR/DT/RF 指标（AUC 0.7617），5 折 CV，混淆矩阵、ROC、特征重要性、防泄漏检查。
- **监督学习 B（拥堵分类）**：`lab/congestion-classifier.json`，仿真标签 Low/Medium/High，DT + RF，Accuracy/Precision/Recall/F1/宏 F1/混淆矩阵、单样本类别概率，明确标注“仿真标签，不是真实监控数据”。
- **回归分析**：`lab/travel-regression.json`，6 特征 → 通行时间，Linear/RF 在独立测试集的 MAE/RMSE/R²、基线对比、60 个预测 vs 实际点。
- **时间序列**：`lab/traffic-forecast.json`，24 小时仿真客流、高峰/低谷、MA(3)/指数平滑(α=.4)/时间特征线性回归三方法，末 6 小时留出评价 MAE/RMSE/MAPE，未来 6 小时递归预测。明确声明 Instacart 下单时段 ≠ 店内客流。
- **异常检测**：`lab/anomaly-detection.json`，IsolationForest（contamination .05）四领域独立训练与评分：异常客流/通行时间/机器人运行/库存变化，含异常分数分布散点、异常记录（时间/位置/分数/中文原因解释）、跨领域对比表。

### 阶段 6：三路策略 + 动态障碍实验 ✅
- 三策略 A=distance / B=distance+time / C=distance+time+risk 共用**同一次 Held–Karp** 与同一行人快照、同一障碍物状态；真实 A* 逐段规划，非随机指标。
- 三条路线可叠加/隐藏（蓝虚线基线/橙实线选中/灰线其他），路径距离/时间/风险/搜索节点/计算时间/代价全表输出。
- 新增**动态障碍挑战面板**：触发人群堵路/行人横穿 → 机器人从当前位置用实时人群场重规划（不瞬移）→ 显示累计重规划次数、前方挡路人数、原/新路径长度与风险暴露、人群热区变化、重规划位置；原路径仅作对照保留。所有数值读自 `state.lastReroute`，无造数。
- V3.9 行人视觉避让 + V3.8 不被挤偏 + 3600s 高峰审计已由历史提交验证，本轮回归再次全绿。

### 阶段 7：Evaluation Lab + 研究方法 ✅
- **评估实验室**：`实验登记簿` 自动汇聚所有实验（Apriori 12、K-Means 12、复购模型 3、拥堵模型 2、回归模型 2、预测方法 3、异常检测 4、CF 1、三策略 3），每条含 Experiment ID / Dataset Version / Algorithm / Params / Seed / Train-Test Split / Metrics / Execution Time / Timestamp / 真实 vs 仿真来源；可按类别、来源筛选与搜索。三策略在路径页运行后即时汇入真实运行时指标。
- **研究方法页**：原版已含 Research Objectives/Data Source/Methodology/Limitations/公式说明；本轮新增数据来源动态块（真实/计算/仿真三类边界 + 缺失值统计），确保真实与仿真数据清晰区分。

### 阶段 8：统一视觉 ✅
- 侧边导航重组为 4 分区：A · OPERATIONS、B · DATA MINING、C · INTELLIGENT ROBOTICS、D · RESEARCH LAB；`layout.js` titles 白名单同步扩展；移动端底部导航自动隐藏分组标题并可横滑。
- 所有新页面复用现有 research-hero / card / data-table / chart / badge / study-card 组件；配色沿用 `--primary/--secondary/--info/--warning` 令牌；新增 `.lab-dualbar` 少数组件样式一致。
- 桌面 1500×950 与移动端 390×844 截图验证：单列/多列布局正确，无横向溢出，hero 标题对比度修复后清晰可读。

### 阶段 9：全站回归测试 ✅
| 套件 | 结果 | 覆盖 |
|---|---|---|
| `cdp-nexus20-smoke.mjs`（新增） | 35/35 PASS | 11 数据文件加载、19 视图打开、10 面板实质内容、2 交互控件重绘、数据真实性、零控制台异常 |
| `cdp-v35-strategy-probe.mjs` | 6/6 PASS | 三策略共享顺序、3D 真实执行、导出、动态重规划 2 次、零异常 |
| `cdp-v30-tests.mjs` | 11/11 PASS | 订单生命周期、KPI、持久化、实验驱动风险守门、人群自主改道、零异常 |
| `cdp-v25-tests.mjs` | 9/9 PASS | 交接/返航/泊位、零侧移、行人绕行、高峰零碰撞 |
| `cdp-v26-tests.mjs` | 10/10 PASS | 收银 FIFO 闭环、服务时长、非侵入泊位、充电闭环 |
| `cdp-v2-tests.mjs` | 全 PASS | 订单/机器人/Held–Karp/A*/取消/补货/持久化 |

### 阶段 10：修复 + 部署 ✅
- 修复：`table()` 接受预拼接字符串行；`renderChallengePanel` 本地定义 `num`/`esc`；`data-profile` 数据集缺 `key` 的兼容；hero h3 配色；全部已通过冒烟测试。
- 部署：静态文件（含 `public/data/lab/*.json`）随 GitHub Pages 工作流发布；在线体验链接同步。

---

## 3. Bug 修复记录

| 问题 | 根因 | 修复 |
|---|---|---|
| 挖掘页面全部空白 | `table()` 只接受数组但部分调用传入预拼接字符串 | 兼容 `Array.isArray` 与字符串 |
| 控制台 `num/esc is not defined` | miningLab.js 的辅助函数未在 app.js 作用域 | 在 `renderChallengePanel` 内定义本地 `num`/`esc` |
| 数据探索数据集选择器空白 | JSON 数据集只有 label 没有 key | 前端用 `label` fallback 到 `dataset-N` |
| hero 标题暗色不可读 | `research-hero h2` 白字，新代码用 h3 | CSS 新增 `.research-hero h3 { color:#fff }` |
| 三策略指标未进评估实验室 | 实验室渲染发生在策略计算前 | 在 `runStrategyComparison()` 末尾调用 `refreshMiningViews()` |

---

## 4. 原版功能保留清单

| 原版功能 | 保留状态 |
|---|---|
| Instacart 真实商品目录搜索/筛选/分片加载 | ✅ 完整保留（V30/V2 通过） |
| 购物车/模拟支付/最低 ¥30/载重 12 kg | ✅ 完整保留 |
| 订单队列/历史/取消/持久化/KPI | ✅ 完整保留（V30 11/11） |
| 库存/低库存预警/手动+自动补货/3D 同步 | ✅ 完整保留（V2 通过） |
| 3D 超市场景（18 货架/冷柜/果蔬岛/4 收银台/程序化机器人+行人） | ✅ 完整保留，未替换任何 3D 模型 |
| 2D 导航地图（176×141，与 3D 共用坐标） | ✅ 完整保留 |
| Held–Karp 访问顺序 / A* 逐段规划 | ✅ 完整保留且三策略共用 |
| Apriori / CF / K-Means / 监督学习 / 需求回归 | ✅ 全部保留并深化 |
| 行人仿真（旁人/横穿/拥堵/收银 FIFO/视觉避让） | ✅ V3.9 完整保留（V25/V26 通过） |
| 机器人状态机/避障/充电/故障演练 | ✅ 完整保留 |
| 三策略对照 + JSON/CSV 导出 + 3D 执行 | ✅ 完整保留（v35 6/6） |
| 研究方法页/数据来源边界说明 | ✅ 完整保留并扩展 |

---

## 5. 数据来源与研究方法说明

- **真实数据（REAL DATA）**：`data/raw/` 五份清洗 CSV（49,688 商品 / 3,421,108 订单 / 1,384,617 train 订单商品行 / 131,209 购物篮）。价格/重量/热量是数据集自带估算字段，非实测。
- **计算结果（CALCULATED）**：Apriori support/confidence/lift、K-Means、LR/DT/RF/IsolationForest、MA/ES/Linear 时间序列、Held–Karp 与 A*，全部由 `scripts/` 真实代码或浏览器算法计算；指标不预设、不伪造。
- **仿真数据（SIMULATED）**：货架坐标、库存、客流样本、通行时间、障碍事件、机器人轨迹、拥堵分类与回归标签。在每个页面明确标注“仿真”，不冒充真实监控。
- **假设（ASSUMPTIONS）**：教学汇率 1 USD=¥7、最低 ¥30、载重 12 kg、每货位 20 件；1 unit=0.17 m；机器人 0.62×0.82 m / 0.78 m/s；主通道约 2.7 m、墙侧约 2.0 m。
- **清洗前异常删除量**无法从已清洗文件反推，报告不虚构该数字。
- **Instacart 下单时段 ≠ 店内客流**：时间序列与所有通行时间模型使用仿真数据并明确标注。

---

## 6. 未完成 / 已知限制（如实呈现）

1. **真实传感器/视觉分类**：项目为教学仿真，未接入真实摄像头、实时库存或实体机器人；拥堵分类与通行回归使用仿真标签，已在页面明确标注。
2. **Apriori 候选池**：为控制运行时间仅对购买频次前 600 件商品挖掘 1/2 项集；这是原版既定做法，已在页面标注。
3. **K-Means 轮廓系数**：在 ≤500 样本上计算以控制运行时间；页面标注采样规模。
4. **预测/异常为仿真生成**：因无真实传感器标注集，无法给出真实场景的 MAPE/异常检出率；指标反映模型在仿真数据上的行为。
5. **GitHub 远端推送**：本地领先 `origin/main` 多个提交，推送由用户自行决定；静态文件已全部生成，可直接部署。
6. **机器学习模型离线**：所有模型在 Python 中离线训练，前端只读取版本化 JSON；如需浏览器内重新训练需引入服务端或 wasm，本版本未采用（符合静态部署优先级）。

---

## 7. 复现命令

```bash
cd C:/Users/联想/Desktop/6143_robot
python scripts/build_data_profile.py
python scripts/build_association_analysis.py
python scripts/build_recommendation_analysis.py
python scripts/build_clustering_analysis.py
python scripts/build_congestion_classifier.py
python scripts/build_travel_regression.py
python scripts/build_traffic_forecast.py
python scripts/build_anomaly_detection.py
python -m http.server 8099
# 浏览器打开 http://127.0.0.1:8099/
```
