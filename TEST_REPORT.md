# NEXUS RETAIL — Functional Test Report

Date: 2026-11-22 · Environment: Windows, Chrome headless (SwiftShader WebGL), local `python -m http.server 8099`.

## 1. Static integrity

| Check | Result |
|---|---|
| JS syntax (`node --check`) for `app.js`, `scene3d.js`, `storeData.js`, `instacart.js`, `layout.js`, `sensorAdapter.js` | PASS |
| Required DOM IDs present | PASS — 0 missing |
| Navigation views | PASS — 9 views |
| 2D SVG shelf rectangles | PASS — 18 zones |
| WebGL canvas created and resized to container (941 × 508 px) | PASS |
| Console exceptions / errors after clean load | PASS — 0 |
| External network requests for fonts/assets | PASS — none (local-first font stack) |

## 2. Real data loading

| Check | Result |
|---|---|
| `public/data` JSON fetched (index, summary, rules, clusters, top products) | PASS |
| Catalog cards rendered (36 displayed) | PASS |
| Research dashboard cards rendered | PASS — 5 |
| Apriori support / confidence / lift displayed with filters | PASS |
| K-means diagnostics, PCA scatter and cluster cards | PASS |
| Order-hour line chart and attribute bar charts with hover tooltips | PASS |

Observed values from the committed dataset: 49,688 products; 3,421,108 orders; 131,209 train baskets; 28,052 Apriori rules; 400-item K-means sample.

## 3. Order → algorithm → robot lifecycle

Test order: `demoOrderBtn` → 4 real products (¥58.94, 1.90 kg) → simulated payment → `NX-0001`.

| Step | Result |
|---|---|
| Order accepted, robot assigned, live ops counters updated | PASS |
| Held–Karp produced exact visit order for 4 zones | PASS（`Held–Karp 精确访问顺序`） |
| A* planned 6 legs (entrance → 4 zones → checkout → exit) | PASS |
| Robot followed path; progress advanced 0% → 100% | PASS |
| Cold-chain item triggered employee-assistance gate | PASS (2/4 stops, robot stopped) |
| Employee confirmation resumed task | PASS |
| Checkout and exit handover reached | PASS（`等待出口交接`） |
| Handover incremented completed orders and cleared active order | PASS (`done: 1`, `orders: 0`) |

Note: the earlier display `6 / 4` for navigation stops was corrected to cap the counter at the number of zones.

## 4. Simulations and controls

| Check | Result |
|---|---|
| Pedestrian event: obstacle placed, slowdown, A* replan logged | PASS |
| Aisle closure: edge removed from graph, restricted line drawn, replan logged | PASS |
| Aisle reopening: edge restored | PASS |
| Overload event: 3 × 6 kg cases added; >12 kg blocks departure in `playPause()` | PASS |
| Shelf congestion: normal ⇄ peak switches crowd sample and costs | PASS |
| Fault injection: safe-stop with advice; manual recovery clears state | PASS |
| Shortage drill: substitute / skip decisions update bought items | PASS by code path |
| Camera modes: isometric / follow / close-up buttons set `aria-pressed` | PASS |
| 2D / 3D switch: `map-frame.mode-2d` toggles correct canvas/SVG | PASS |
| Presentation mode: shell hidden, 3D enlarged, HUD visible, Escape exits | PASS |
| Fullscreen button | Available (browser permission dependent) |
| Mobile 390 × 844 viewport: no horizontal overflow, bottom nav visible | PASS |

## 5. Performance

| Metric | Result |
|---|---|
| Render loop in headless Chrome | ~165 rAF/s over 2 s (uncapped headless; not a physical-device FPS claim) |
| JS heap after scene activation | ~87 MB used / 107 MB total |
| Product rendering | InstancedMesh buckets, shared geometries, canvas textures |
| Draw-call controls | No per-frame geometry rebuild except route/history layers |
| Render loop when 3D view hidden or 2D mode active | Paused by `setActive(false)` |

## 6. Known boundaries

- No physical robot, no trained vision classifier, no real-time inventory or live telemetry. All such values are labelled simulation.
- Held–Karp is exact only for ≤12 unique zones; above that the interface states that the nearest-cost heuristic is not globally optimal.
- Apriori is limited to the top 600 candidate products and 2-item frequent sets in the offline build; browser filters only re-filter precomputed rules.
- K-means uses pre-existing estimated price/weight/calorie fields; the PCA plot is for inspection, not a validated layout recommendation.
- GitHub Pages deployment is validated by the committed workflow structure; the live URL was not re-pushed during this local test run.

## 7. 中文主体界面回归（2026-11-22 追加）

| Check | Result |
|---|---|
| 9 个页面的导航、标题、按钮、表头、状态与提示均为中文主体 | PASS |
| 英文仅作为小号辅助标签（如 `SYSTEM STATUS` / `SEARCH`）或真实商品原始名称保留 | PASS |
| 3D 场景货区标牌、通道封闭/行人等事件日志中文显示，无乱码方框 | PASS |
| 订单支付、缺货决策、员工协助、出口交接提示中文显示 | PASS（`NX-0001：模拟支付已受理…无真实交易。`） |
| Held–Karp / A* 方法与路段对比表中文显示 | PASS（`Held–Karp 精确访问顺序`） |
| Apriori / K-means 图表说明、支持度/置信度/提升度中文显示 | PASS |
| 中文版重新加载后控制台错误与警告 | PASS — 0 |
| WebGL 画布在 3D 视图中正确缩放 | PASS — 941 × 508 px |

说明：研究算法名、术语缩写（Held–Karp、A*、Apriori、K-means）与 Instacart 商品原始英文名称按数据真实性要求保留；它们以中文语境中的专有名词出现，不构成英文主体界面。

## 8. Human-Aware Navigation 升级回归（2026-11-22 追加）

### 8.1 比例与碰撞体

| 项 | 结果 |
|---|---|
| 统一比例：1 地图单位 = 0.17 m（`PHYSICS.metersPerUnit` = 3D `X_SCALE`） | PASS |
| 机器人车身 0.62 × 0.82 × 约 0.90 m；视觉模型不再使用 1.5 倍整体缩放 | PASS |
| 机器人碰撞半径 0.36 m；行人半径 0.24–0.38 m；安全缓冲 0.80 m | PASS |
| 视觉与 2D 地图的机器人半径使用同一常量 | PASS |
| 主通道净宽约 2.4–2.6 m、次通道约 1.9 m（18 个货区已收窄并错位） | PASS |
| 通道图 `buildNavNodes()` 由机器人与行人共用，3D/2D/导航坐标一致 | PASS |

### 8.2 行为状态机与预测检测

- 状态：`NORMAL_NAVIGATION / SLOW_DOWN / YIELD / WAIT / AVOIDANCE / REPLANNING / RESUME / EMERGENCY_STOP`。
- 检测包含行人当前速度、方向、相对速度、相对轨迹最近点、TTC、机器人制动距离（v²/2a）与速度感知安全距离。
- 行为层输出的是**真实速度系数**，不是只改文字标签；A* 仍负责全局路径，局部避障只调整速度/侧向偏移，受阻超过 4 秒时请求 A* 重规划。
- 行人横穿会先触发 `SLOW_DOWN` 再 `YIELD`；迎面相遇触发 `WAIT`；行人离开后经 `RESUME` 恢复。

### 8.3 十场景自动化测试

由 `window.__NEXUS` 测试钩子驱动，每个场景独立重置 brain 与安全事件，运行 26 秒仿真时间（60 Hz）：

| 场景 | Collision | Yield | Replan | 平均等待 | 观察到的状态 |
|---|---:|---:|---:|---:|---|
| 01 单个行人横穿 | 0 | 5 | 0 | 4.2 s | WAIT → RESUME |
| 02 多人同时横穿 | 0 | 6 | 1 | 8.1 s | WAIT / SLOW_DOWN / REPLANNING / NORMAL |
| 03 迎面相遇 | 0 | 8 | 1 | 10.9 s | YIELD / SLOW_DOWN / RESUME |
| 04 侧面经过 | 0 | 5 | 0 | 4.1 s | WAIT → RESUME |
| 05 货架前停留 | 0 | 6 | 1 | 9.8 s | AVOIDANCE / YIELD / REPLANNING |
| 06 购物车阻挡 | 0 | 5 | 0 | 4.0 s | WAIT → RESUME |
| 07 双人堵塞 | 0 | 8 | 1 | 10.7 s | EMERGENCY_STOP / WAIT / RESUME |
| 08 行人离开后恢复 | 0 | 5 | 0 | 4.2 s | WAIT → RESUME |
| 09 窄道会车 | 0 | 9 | 0 | 12.2 s | WAIT → RESUME |
| 10 高密度拥堵 | 0 | 8 | 2 | 16.7 s | YIELD / WAIT / REPLANNING |

合计：10 场景、**0 次碰撞**、65 次礼让、6 次重规划、0 个控制台错误。指标来自运行中的状态机与安全事件，未隐藏碰撞。

### 8.4 行人系统

- 5 类人物：Regular / Slow / Cart / Browsing / Fast，外观、身高、速度、购物行为与停留时间不同。
- 行为状态：`ENTER_STORE / WALK_TO_SECTION / WALKING / BROWSING / STOPPING / TURNING / QUEUEING / GOING_TO_CHECKOUT / EXITING`。
- 行人在共享通道图上寻路，不与货架/墙壁相交；行人之间施加分离力；靠近机器人时保留侧向让行分量，避免互相停死。
- 控制面板支持 START / PAUSE / RESET、低中高密度、三档步速、四种运动模式与四个预设场景；实时显示速度、距离、TTC、安全状态、目的地与计数。
- 排队/离店点位于主通道外侧（112/118, 14），避免占用机器人结账—出口路段。

### 8.5 3D 模型与性能

- 提供的 9 张图片是 **2D 渲染参考图/三视图**，不是带骨骼的 GLB/GLTF 资产，无法直接导入 Three.js。当前实现按三视图比例与配色做程序化建模：机器人含底盘、驱动轮、万向轮、LiDAR、双目、触摸屏、货台、保险杠与状态灯；行人用层级关节做 walk / idle / browse / push-cart / turn / stop 动画。
- 这是可落地的替代方案；若后续提供真正的 GLB/GLTF 骨骼动画资产，可替换 `makePerson()` 与 `robot` 组而不改导航逻辑。
- 商品用 InstancedMesh；26 个行人模型复用共享几何与材质，未可见时跳过动画更新；渲染循环在 3D 视图隐藏时暂停。
- 3D 画布 941 × 508 px；无头浏览器约 165–170 rAF/s（非真实设备帧率承诺）。

### 8.6 原功能不受影响

完整订单生命周期复测：示例购物篮 → 模拟支付 → Held–Karp → A* → 员工协助确认 → 结账 → 出口交接 → 已完成订单 +1、活动订单 0；碰撞 0、控制台错误 0。2D/3D、三视角、演示模式与原有六类仿真事件仍可用。

---

## 9. 3D 场景质量整改回归（2026-11-22 追加）

### 9.1 问题清单先行

修改前建立 `QUALITY_AUDIT.md`，将用户报告的 6 类问题定位到代码级根因（模型绑定 / 坐标 / 碰撞导航 / 人群调度 / 资产 / 视觉），并先备份 `robot-backup-quality-20261122-153815` + git tag `pre-quality-overhaul`，再开始改动。

### 9.2 空间与统一坐标

| 项 | 结果 |
|---|---|
| 超市世界尺寸 | 由 23.8×15.3 m 扩大到 **29.92×23.97 m**（176×141 单位 @0.17 m/单位） |
| 唯一坐标源 | `storeData.js` 导出 `STORE / CAMERA / PHYSICS / shelves / layoutFixtures / buildNavNodes`；地板/墙/货架/收银/生成点/导航/相机全部由此派生 |
| 货架错位 | 18 个货区在各自单元内按确定性偏移错开（±1.8 / ±2.2 单位），长度/高度/类型各异，不再是整齐网格 |
| 通道 | 主通道约 2.7 m、次通道约 2.0 m；货架取货点全部落在导航节点上 |
| A* 一致性 | 18/18 取货点均在 `buildNavNodes()` 的 45 个节点上，`pickOffNav=0`；Held–Karp 4 站 / A* 6 段正常 |
| 2D 地图 | viewBox 与所有 `(STORE.height - y)` 变换同步扩大，无旧坐标残留 |

### 9.3 推购物车手部畸形 — 根因与修复

- **根因**：原实现购物车把手在车的 -Z 侧，而人物正面朝 -Z、车在人物前方；手锚点与把手世界坐标相差约 0.4 m，导致手悬空/穿过车篮。
- **修复**：把手移到购物车 +Z 近人侧；手掌锚点用与把手**同源的动态表达式**计算（`HANDLE_Y=.66+.29`、`HANDLE_Z=-.62+(.56/2+.06)=-.28`），前臂末端 palm 隐藏避免重影。
- **验证**：`verify-geometry.mjs` 静态验证手锚点与把手世界坐标误差 **0.000000 m**；肩/肘采用正角度向前下自然弯曲，无反向弯折。6 套参考图服装（店员绿马甲+工牌 / 米色衬衫 / 墨绿毛衣 / 藏青风衣 / 酒红开衫+眼镜 / 灰夹克）已落实。

### 9.4 开场分布与收银队列

| 测试 | 结果 |
|---|---|
| 渐进生成 | 行人从 0 逐步补到目标密度（低 7 / 中 14 / 高 22），非瞬间出现 |
| 安全间距 | 实测最小行人间距 0.58 m；生成点拒绝货架/墙/机器人/其他行人重叠 |
| 多生成点 | 6 个入口通道生成点、不同朝向、不同目标 |
| 完整行为链 | 实测 32 秒内 ENTER_STORE → WALK_TO_SECTION → BROWSING → GOING_TO_CHECKOUT → QUEUEING 全部出现 |
| 收银队列 | 4 个收银台各自独立 4 个排队位（容量上限），实测队列分配 1/4；队列满时顾客转浏览等待，不涌向同一坐标 |
| 机器人分离 | 顾客排队区在前场 y<26，机器人结账/出口通道在 y=26，互不占用 |
| 禁止手段 | 未使用隐藏 / 瞬移 / 删除人物解决拥堵；离店走独立通道 |

### 9.5 人机交互与视觉

- 横穿实测行为序列：`NORMAL_NAVIGATION → SLOW_DOWN → YIELD`；碰撞 0、碰撞事件 0、近距 2 次（如实计数）、0 控制台错误。
- 相机五视角：全场 / 等轴 / 俯视 / 跟随 / 特写，默认全场可看到完整超市。
- 视觉：冷柜玻璃门+内部冷光、生鲜木质展示台、金属线框购物车（含儿童座板与四轮）、收银台传送带+扫码器+显示屏、天花板灯带、区域招牌、排队位标识、机器人数字表情屏与 LiDAR。

### 9.6 参考资产清单

8 张用户参考图已归档到 `assets/references/`（见 `ASSETS.md`）。它们是 2D 渲染设计稿，不是带骨骼的 GLB/GLTF，按图比例/配色/结构程序化落实，未用静态图片冒充 3D 模型。

### 9.7 限制

- 程序化模型非照片级写实；人物为层级关节动画（无蒙皮骨骼 GLB），复杂手指未建模，手掌以椭球+拇指表示。
- 近景相机在入口处可能被门柱/标牌遮挡（场景真实遮挡，非渲染错误）。
- 无头浏览器数据不代表真实设备帧率。

---

## 10. V2.0 系统级升级（订单闭环 / 统一数据层 / 真实仿真）

日期 2026-11-22。目标：在保留既有功能下，补齐业务闭环、持久化、多机器人调度与 3D 同步。以下均为本地无头 Chrome 实测结果（脚本 `cdp-v2-tests.mjs`、`cdp-v2-tests-ped.mjs`、`cdp-v2-demo-jump.mjs`，日志 `v2-tests-logic.json`、`v2-tests-ped.json`）。

### 10.1 本轮修复的实际缺陷（非表面功能）

| 缺陷 | 根因 | 修复 |
|---|---|---|
| 刷新后订单/补货丢失 | 订单只存内存 | 新增 `systemCore.js`，统一 `localStorage` 持久化（订单/库存/补货记录/编号，`version=2`，无存储时降级内存） |
| 手动补货下拉框为空 | `initRestockControls()` 定义但从未调用 | 初始化及 `loadResearch()` 后均调用，且保留已选项 |
| 行人面板数据全为 0 / — | `renderPedestrianPanel` 中 `reduce` 返回 `{p,d}`，却读 `nearest.speed`（应为 `nearest.p.speed`），抛 `undefined.toFixed` 并中断后续初始化 | 展开行人字段 `current={...p,d}`，面板值全部来自真实仿真对象 |
| 真实商品目录加载不出来 | 上述 `setSafety` 异常在初始化链中抛出，中断 `loadResearch` 之后流程 | 见下一行 |
| 3D `setSafety` 抛 `ReferenceError` | 多机器人重构后仍引用已删除的裸变量 `safetyRing` | 改为遍历 `robotModels` 同步每个模型的安全环 |
| HTML 手动补货区块错位 | 多出一个 `</section>`，表单落在 `view-inventory` 外 | 修正标签结构 |
| 完成订单 KPI 恒为 0 | 只统计英文 `Completed`，实际 push 中文 `已完成` | 两种状态值都计入 |
| 部署站点缺新模块 | Pages 工作流 cp 列表未含 `systemCore.js` | 加入工作流复制清单 |

### 10.2 六项必测场景实测结果

| # | 场景 | 实测结果 |
|---|---|---|
| 1 | 完整订单配送 | **PASS**。下单 `NX-0001` → 分配 `AMR-03` → Held–Karp 精确顺序（4 货区）+ A* 6 段 → 取货扣减库存 → 配送 → 交接完成后 `returnReason=配送完成`，机器人沿真实路径返航至泊位 `13,62` 并恢复 `IDLE`（非瞬移、非停留配送点） |
| 2 | 配送中取消 | **PASS**。配送中（stage=2，位置 `45,94.2`）取消 → 订单状态 `已取消`、记录取消时间与进度 → 从真实位置 `28.7,98` 渐进退到 `24,90.1` 返航（非瞬移）→ 回泊位 `IDLE`，取消记录数 1 |
| 3 | 人工补货 | **PASS**。库存从 3 件补 7 件至 10 件 → 记录 `before=3, after=10, mode=手动, shelfId=1-4` → `saveInventory` + `syncShelfStock` 同步 3D；自动补货共用同一库存与记录表 |
| 4 | 行人高峰 | **PASS**。渐进补至 30 人；5000 帧（约 3 分钟仿真）内穿墙 0、穿货架 0；重叠采样 98/多帧（占比极低）；行为覆盖 `ENTER_STORE / BROWSING / WALK_TO_SECTION / GOING_TO_CHECKOUT / QUEUEING / EXITING`；**22 名行人经收银队列从右侧出口离店**，最大排队 14 人 |
| 5 | 人机交互 | **PASS**。机器人行为序列 `NORMAL_NAVIGATION → SLOW_DOWN → YIELD → RESUME …`；最小 TTC 0（安全停车）、最小距离 1.09 m；碰撞 0、碰撞事件 0；礼让计数 1，全程订单继续推进 |
| 6 | 数据持久化 | **PASS**。刷新前 `orders=2, restocks=1, persistence=localStorage`，刷新后数值完全一致；库存从统一数据层回填到商品对象 |

补充：**查看配送演示**入口（下单提示条 + 订单队列 + 历史「3D 回放」）实测均跳转 3D 超市、定位到订单机器人 `AMR-03`、路径已重建；0 运行时错误。

### 10.3 数据结构与算法变更

- **新统一数据层** `systemCore.js`：`hydrateInventory / saveInventory / nextOrderId / saveOrder / patchOrder / getOrderRecord / hydrateOrder / addRestock / listRestocks / persistenceStatus`；订单记录快照含商品、数量、金额、下单/开始/完成/取消时间、机器人、起终点、采样路径、取消前进度、配送耗时。
- **机器人舰队** `state.fleet`（3 台，独立泊位 `STORE.robotWaitSlots`）；`assignRobot` 按等待区到首个货区的 A* 距离 + 电量分配；新增 `beginReturn / stepReturn` 返航状态机（与订单配送共用行人、行为层与真实路径）。
- **订单状态流转**：待处理 → 待分配 → 配送中 →（已完成 / 已取消 / 异常），返航中作为机器人侧状态；`cancelOrderById` 同时处理排队中、执行中、取货中订单的安全中止。
- **3D 多机器人在途实例** `robotModels`（`setRobots` / `setShelfStock`），安全环与表情按模型同步。

### 10.4 仍未完成 / 已知限制

- 无后端与真实支付：全部为浏览器内仿真 + `localStorage`，跨设备/跨浏览器不同步；清除站点数据会清空历史。
- 「3D 回放」重建的是订单当时的路径规划与泊位，不逐帧重放历史行人位置（历史仅保存机器人采样路径点，未存行人轨迹）。
- 返航路径基于取消瞬间的静态障碍重算；返航途中新出现的行人不触发二次全局重规划（安全层仍会减速/停车让行）。
- 自动补货按库存阈值（<20%）触发，未接入真实销量预测模型；优先级字段为记录值，不参与调度排序。
- 人物仍为程序化层级关节模型，非 GLB 蒙皮骨骼；无逐指动作。
