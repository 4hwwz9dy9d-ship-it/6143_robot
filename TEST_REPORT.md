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

---

## 11. V2.1 精细化升级（单机器人 / 唯一出入口 / 取货朝向 / 经出口返航 / 加速 / 视觉）

日期 2026-11-22。脚本 `cdp-v21-tests.mjs`（日志见下方 11.2），截图 `v21-{overview,robot,supermarket}.png`。全部为本地无头 Chrome 实测。

### 11.1 本轮实际改动

| 项目 | 改动 | 文件 |
|---|---|---|
| 机器人数量 | 默认 1 台，后台可配置 1–2 台并持久化；两台使用独立泊位 [24,8]/[34,8]（间距 10 单位 ≈1.7 m，不重叠），第二台模型默认隐藏 | `systemCore.js`（getRobotCount/setSetting）、`storeData.js`、`app.js`（setRobotCount）、`scene3d.js`（setFleetCount） |
| 等待区位置 | 从紧贴入口的 [13,26/44/62] 移到入口前方左下 [24,8]/[34,8]，不占 y=26 行人主通道 | `storeData.js`、`scene3d.js`（地面标线） |
| 唯一入口/出口 | 行人生成点只保留左墙开口 y=26 附近 6 个点；`move()` 硬约束左墙仅入口开口可进、右墙仅出口开口可出；离店目标统一为 outsideExit | `pedestrian.js`、`storeData.js` |
| 购物车区 | 从 [24,8] 移到入口左下 [10,9]，不侵入 y=26 主通道，4 个独立购物车对象 | `storeData.js`、`scene3d.js` |
| 取货朝向 | 新增 `faceHeading/pickTier` 仿真数据；BROWSING 时人物真正转向货架；修正肩部旋转符号（旧版负角=向后伸，新版正角=朝 -Z 货架伸）；新增商品离架→移向购物篮的视觉道具 | `pedestrian.js`、`scene3d.js` |
| 经出口返航 | 完成后路径：交接点[170,26]→出口→墙外服务通道→左入口→初始泊位；内外两段仍由 A* 计算，外侧为真实坐标折线；取消订单仍按当前位置直接 A* 安全返回 | `app.js`（beginReturn viaExit）、`storeData.js`（outsideReturn）、`scene3d.js`（外侧铺装地面） |
| 仿真加速 | 1×/2×/3×/5×；每真实帧内按倍率执行多个 ≤1/60 s 子步，机器人、行人、购物动作、订单流程、返航共用同一仿真时间；导航/避障/TTC/碰撞检测/状态机/库存规则逐帧执行不变 | `app.js`（scaledSubsteps/setSimSpeed）、`index.html`、`ui.css` |
| 总览视觉 | 删除抽象装饰 SVG，改用用户提供的 AMR 渲染图；左上角换成用户 logo 图标；标签化信息层级 | `index.html`、`ui.css`、`branding.js`、`assets/brand/*` |
| 平面示意图 | 新增实时人流热力、行人方向箭头、机器人舰队位置与返航路径、入口/出口状态标签；与 3D 共用 `STORE` 坐标与同一仿真快照 | `index.html`、`app.js`（drawCrowd/drawRobot）、`ui.css` |
| 机器人控制页 | 用完整机身渲染图替换旧 SVG；统一图片容器比例；新增后台机器人数量配置卡片；保留全部实时状态与控制 | `index.html`、`ui.css`、`branding.js` |
| 素材替换接口 | 所有品牌图片路径集中在 `branding.js`，替换图片只改一处；3D 机器人仍为实时 Three.js 模型，不用静态图冒充 | `branding.js`、`assets/brand/` |
| 部署 | Pages 工作流复制 `branding.js` 与 `assets/` | `.github/workflows/expire-pages.yml` |

### 11.2 实测结果（11/11 PASS，0 运行时异常）

| 测试 | 实测数据 |
|---|---|
| T0 默认单机器人 | fleet=[AMR-01]，泊位=[24,8]，倍速控件 1/2/3/5，品牌图已加载 |
| T1 完整配送→经出口返航 | 订单 NX-0001 → 出口交接 [170,26] → 返航路径含 exit/outside(182)/front(-8)/entrance(8,26)，终点=[24,8]；状态 IDLE |
| T2 双机器人 | [24,8]/[34,8]，间距 10 单位；localStorage robotCount=2；刷新后仍 2 台 |
| T3 高峰唯一出入口 | 30 人 / 5000 帧：穿墙 0、越界 0；出现进店/选购/收银/离店全部状态 |
| T4 取货朝向 | BROWSING 行人 2 名全部带 faceHeading、pickShelf、pickTier（样例 1.732 rad / 2-5 / tier0） |
| T5 四档倍速 | 相同 120 真实子步下仿真时间分别 2/4/6/10 s，徽标与按钮选中态均正确 |
| T6 5×加速避障 | 状态含 NORMAL→SLOW_DOWN→YIELD→RESUME；碰撞 0、礼让 4、最小距离 1.36 m |
| T7 平面图/3D 一致 | 平面机器人坐标 [18,36.7] = 仿真 [18,36.7]；18 个热力区、7 条方向箭头 |
| T8 购物车位置 | 购物车区中心 [10,9]，相对入口 [8,26] 位于左下，未侵入 y=26 通道 |
| T9 运行时异常 | 0 |

### 11.3 仍未完成 / 已知限制

- 机器人素材是用户提供的高质量渲染图，用于界面展示；3D 场景内仍是程序化关节 AMR 模型（未做 GLB 蒙皮/贴图替换，避免静态图冒充实时模型）。如需在 3D 中直接使用该造型，需要提供可驱动的 3D 模型文件（glTF/GLB）。
- 外侧服务通道在 3D 中为地面铺装，仅在机器人返航时使用；当前俯视角度下会看到门店外侧多一条通道地面，属于业务需求（不穿墙返航）的可见代价。
- 行人取货动画为程序化道具位移 + 手臂动作，购物计数进入仿真指标；不扣减店铺订单库存，以免破坏订单/库存业务规则。
- 加速只增加每帧子步数量；极低性能设备上 5× 可能掉帧，但不会瞬移或跳过碰撞检测。

## 12. V2.1.1  hotfix：3D 机器人不动 & 总览主视觉替换
日期 2026-11-22。本地无头 Chrome 实测。

### 12.1 根因与修复
| 问题 | 根因 | 修复 |
|---|---|---|
| 3D 场景中机器人停在泊位不动、只有规划路径可见；跟随相机不动、轮子不转 | `stepSimulation()` 每帧只更新 `state.displayPosition`，从未把位姿写回 `state.fleet[active].position`；而 `scene3d.setRobots()` 读取的是舰队快照，因此 3D 模型始终收到泊位坐标。诊断实测：T+2s 时 `displayPosition=[24,14.34]`，`fleet.position=[24,8]`，gap=6.34，机器人里程恒为 0 | 在 `stepSimulation()` 位移结算处逐帧调用 `syncRobotPose(state.displayPosition, robotState(), state.order?.id)` 并累加 `active.distance`；3D 模型、状态灯、安全环、跟随相机、轮组转动全部读取同一舰队真源 |
| 第一页总览主视觉不是用户指定图片 | 原 `heroRobotImg` 指向 `amr-front.jpg` | 新增 `BRAND_ASSETS.heroVisual = './assets/brand/paper-logo.jpg'`；`index.html` 的 `data-brand` 改为 `heroVisual`；图片 1920×1026 已加载验证 |

### 12.2 实测结果
| 测试 | 实测数据 |
|---|---|
| 位姿同步（修复后） | T+0.5/1/1.5/2s 时 `displayPosition` 与 `fleet.position` 完全一致（gap=0）；机器人里程从 0 累加至 6.16 |
| V2.1 全量回归 | 11/11 PASS；T1 完整配送+经出口返航、T5 四档倍速、T6 5×零碰撞、T7 平面图一致全部保持通过 |
| 总览图片 | `heroRobotImg` src=`./assets/brand/paper-logo.jpg`，naturalWidth=1920，naturalHeight=1026 |
| 运行时异常 | 0 |

## 13. V2.2  场景精细化、机械臂、离店归位与订单联动
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v22-tests.mjs`（9/9 PASS）+ `cdp-v21-tests.mjs` 回归（11/11 PASS）。

### 13.1 本轮改动
| 项目 | 改动 | 文件 |
|---|---|---|
| 唯一出入口 | 删除 `layoutFixtures` 中店内 y=20 的「入口/出口」门框（与墙上真实开口形成两套），只保留左右墙 y=26 的单一开口与门楣标牌 | `storeData.js`、`scene3d.js` |
| 机械臂 | 机器人顶部新增关节式机械臂（底座/肩/上臂/肘/前臂/腕/双指夹爪），取货时按 picking 状态平滑伸出至机身正面 (-Z)，待机收回；实测 reach 0→1、肩 -1.15 rad、肘 0.55 rad | `scene3d.js` |
| 仅补货需协助 | 常规取货（含冷链/整箱饮料）改为机械臂自动完成，不再触发员工协助暂停；员工协助只发生在库存管理页的「补货」作业 | `app.js` |
| 行人避让 | 行人对机器人检测半径 2.8→3.0 m，引入让行方向锁定（yieldSide/yieldTimer 1.4 s）避免左右横跳围观；极近距离(<0.95m)全力侧移脱离；机器人对已让行行人放宽阈值减少无谓停车 | `pedestrian.js`、`robotBehavior.js` |
| 出口消失 | 行人一旦越过右墙开口外侧（x>width+6）立即从仿真与渲染移除并结算离店，避免墙外穿模 | `pedestrian.js` |
| 离店3秒归位 | 交接完成后机器人驶出右出口→门外整备 3 秒→沿外侧通道从入口回归泊位；waitAt 由 exitOuter 里程计算，倍速下同步 | `app.js`（beginReturn/stepReturn） |
| 收银场景 | 每个收银台常驻 1 名绿制服店员；新增 2 台自助结账机（kiosk）；促销岛 C 从 x=126 移到 x=99 避开排队区（原位置与排队区1穿模）；后墙分区招牌抬高至 2.72 m 避免与冷柜标签重叠 | `storeData.js`、`scene3d.js`、`ui.css`、`pedestrian.js` |
| 图片替换 | 总览主视觉改为 paper-logo-4.jpg，机器人控制页改为 amr-control.jpg，统一走 branding.js | `branding.js`、`index.html`、`assets/brand/*` |
| 订单联动 | 返航后不再自动推进队列；订单页「履约流水线」与 3D 页 playbar 均新增「继续下一单」手动按钮与「还有 N 单等待处理」提示；无下一单则机器人归位休息；两页可一键互跳 | `app.js`（startNextOrder/renderQueue）、`index.html`、`layout.js`、`ui.css` |

### 13.2 实测结果（V2.2 9/9 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 唯一出入口 | layoutFixtures 不含 entrance/exit kind，墙上开口 entrance/exit y=26 保留 |
| T1 常规取货免协助 | assistPending=false，日志中「需要员工协助」0 次 |
| T2 离店3秒归位 | waitAt=12，门外位置 [182,26] 处 waitLeft 2.98→0（180 子步=3 秒），路径含出口/外侧/入口 |
| T3 行人主动让行 | 高峰场景 pedestrianYields=11，让行标志生效 |
| T3b 出口消失 | 注入 x=180 的 EXITING 行人，一帧后即被移除，exits+1 |
| T4 收银场景防穿模 | 自助机 2 台、促销岛 C x=99、与所有排队区零重叠、收银台 4 个 |
| T5 图片替换 | 总览 src=paper-logo-4.jpg、控制页 src=amr-control.jpg，均加载成功 |
| T6 手动下一单 | 连下 2 单，配送+返航后 order=null、按钮可见；点击 startNextOrder 后新订单 NX-0004、队列 1→0、自动切到 3D 页 |
| T7 运行时异常 | 0 |
| 机械臂专项 | 待机 reach=0；picking 状态 reach≈1、肩 -1.15 rad、肘 0.55 rad |
| V2.1 回归 | 11/11 PASS，5× 加速零碰撞（最小距离 3.0 m） |

## 14. V2.3 机器人堵门修复：整备点远离出口 + 开口加宽
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v23-tests.mjs`（6/6 PASS）+ V2.2 回归 9/9 + V2.1 回归 11/11。

### 14.1 根因与修复
| 问题 | 根因 | 修复 |
|---|---|---|
| 机器人配送完成后堵住出口、行人围观像"故意围住" | 机器人门外整备点 `exitOuter=[182,26]` 与行人出店终点 `outsideExit=[182,26]` 完全重合，机器人停 3 秒正好堵在出店口正前方 | 新增独立整备点 `outsideReturn.staging=[182,6]`（外墙南段，距出店口 20 单位≈3.4m）；返航路径改为 出口→exitOuter→staging(停3秒)→rightSouth→frontSouth→entranceOuter→入口→泊位；`waitAt` 改指向 staging 里程 |
| 高峰出入拥挤 | 墙上开口半高 5.2（≈1.77m）偏窄 | entrance/exit 开口 halfHeight 5.2→6.6（≈2.24m），3D 门楣/2D 门框按同源常量自动更新 |

### 14.2 实测结果（V2.3 6/6 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 配置 | entranceHalf=exitHalf=6.6，staging=[182,6]，与出口 y=26 相距 20 |
| T1 返航路径 | 配送→交接后 returnLeg 含 staging[182,6]/出口[170,26]/入口[8,26]，waitAt=32 |
| T2 整备位置 | 触发整备时机器人 pos=[182,6]，waitLeft=2.98→0，距出店口 20 单位 |
| T3 门口畅通 | 整备 3 秒期间 doorDist=20（>10 阈值），门口无机器人占位 |
| T4 归位 | 整备结束沿外侧通道从入口回归泊位 [24,8]，状态 IDLE |
| T5 异常 | 0 |
| 回归 | V2.2 9/9、V2.1 11/11 全 PASS |

## 15. V2.4 回放bug修复 / 精细收银员 / 充电 / 数字孪生实时地图 / 实验驱动路径
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v24-tests.mjs`（8/8 PASS）+ V2.3 6/6 + V2.2 9/9 + V2.1 11/11 回归全通过，运行时异常 0。

### 15.1 改动清单
| 项目 | 改动 | 文件 |
|---|---|---|
| 回放 bug 根因 | "已完成"订单点 3D 回放→被当新单载入并 resetPlayback→playPause 用 `stage===0&&elapsed===0` 判定首单→`patchOrder(status:'配送中')` 把已终结状态永久改回配送中。修复：新增独立只读回放 `state.replay`，沿 `record.path` 插值驱动机器人；playPause 回放分支不进订单状态机、不 patchOrder；新增"退出回放"按钮；`systemCore.patchOrder` 加状态机守卫禁止终态→中途态 | `app.js`、`systemCore.js`、`index.html` |
| 回放保真 | 下单时持久化 `scenario/slot`；回放按 `deliverSeconds` 定时长（4~30s），倍速同步；回放中拖尾/进度/状态文案独立显示 | `app.js` |
| 精细收银员 | 收银台店员由粗糙圆柱堆叠改为复用 makePerson 完整人形骨架（球头五官/马尾/绿马甲白衬衫/工牌/关节手臂/皮鞋/地面投影），身高 1.09→1.64m，朝向修正面向顾客；加呼吸+扫视微动画 | `scene3d.js` |
| 机器人充电 | 全局电量同步到舰队真源；新增充电桩 `chargingDocks`（入口左下空地，含底座/立柱/充电枪/指示灯）；`startCharging/stopCharging/chargeLoop`（仿真时间 +6%/秒，倍速同步）；机器人控制页加"回坞充电"按钮，3D 页电量条首次接通；充电指示灯脉冲 | `storeData.js`、`scene3d.js`、`app.js`、`index.html` |
| 数字孪生平面图 | 总览区静态色块图替换为完整实时地图：通道/24 装置/18 品类着色货架/入口·收银·出口标签/行人热力/行人点/规划+已走双路径/机器人位置(回放紫·充电橙·常规绿)/实时状态标记；与 3D 共用 state 与 STORE 坐标 | `index.html`、`app.js` |
| 实验驱动路径 | Apriori 真实规则（13.1万购物篮/2.8万条规则）接入路径优化：`associationWeight` 按命中规则的置信度/提升度算共购强度，`buildPlan('mining')` 在 Held–Karp 段代价最多降 45%，让实验证实共购的货区排得更近；路径页新增"关联实验驱动"面板展示命中规则、常规 vs 实验方案对比、里程收益；可一键开关 | `app.js`、`index.html` |

### 15.2 实测结果（V2.4 8/8 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 UI 结构 | 数字孪生图层/充电按钮/实验面板/退出回放按钮全部存在 |
| T1 数字孪生地图 | 18 货架、24 装置、3 门标、机器人层有内容，实时标记生效 |
| T2 完成订单 | 配送→交接→返航完成，localStorage 状态='已完成' |
| T3 回放bug修复 | 回放已完成单：进入只读回放(400轨迹点)、orderChanged=false、播放到 progress=1 后状态仍='已完成' |
| T4 退出回放 | replay 清除、状态仍='已完成' |
| T5 充电 | 电量30%回坞→机器人 pos=[46,8]=充电桩、进入/退出充电正常 |
| T6 实验关联 | 28052 条规则/131209 篮；关联函数可用；开关启用后 method='Held–Karp 精确·实验关联加权' |
| T7 异常 | 0 |
| 回归 | V2.3 6/6、V2.2 9/9、V2.1 11/11 全 PASS |

## 16. V2.5 出口不再设计在机器人停留处 + 人机近距离对峙不再绕圈
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v25-tests.mjs`（9/9 PASS）+ V2.4 8/8 + V2.3 6/6 + V2.2 9/9 + V2.1 11/11 回归全通过，运行时异常 0。

### 16.1 根因与修复
| 问题 | 根因 | 修复 |
|---|---|---|
| 机器人「最后停留的地方」仍在出口，行人出店被堵 / 围观 | V2.3 只挪走了「交接后 3 秒整备点」，但机器人在 `STORE.exit=[170,26]` **无限期停留等待人工确认交接**，才是真正的长时间停靠点 | 新增店内取货交接区 `STORE.handoff=[153,44]`（纵向通道，距出口 24.8 单位≈4.2m）；订单终点、结账后 finish 段、路径末点、`end` 记录、到达判定全部改为 handoff；出口只承担通行，不承担任何停靠。2D/3D/twin 地图新增紫色「交接」地面标线与门标；全站「出口交接」文案改为「取货交接区」 |
| 整备点仍贴着右墙出口一侧 | `outsideReturn.staging=[182,6]` 虽距门口 20 单位，仍在出口所在右墙外侧 | staging 移到前墙外侧服务通道中央 `[88,-8]`，距出口 88.8 单位（≈15m）；返航路径改为 出口→exitOuter→rightSouth→**staging(停3秒)**→frontSouth→entranceOuter→入口→泊位；`waitAt` 改指向 staging 里程；导航图同步加边 |
| 人与机器人很近时「一直绕圈」 | V2.2 让行是「锁定一侧持续侧移」，机器人同时 YIELD/WAIT 停车；双方反复靠近—侧移—再靠近，形成局部极小值僵局，且没有超时脱离机制 | 双向脱离：① 行人侧新增僵局检测（持续近距离 >1.5s 或被阻挡 >0.9s）→ `beginDetour()` 明确**换个方向**，绕行点放在机器人前方 14 单位 + 同侧横向拉开 10 单位，到达后重新规划回原目标；DETOUR 期间不做方向锁定让行，但保留持续排斥场防止撞上静止机器人；冷却 6s 防反复。② 机器人侧 `RobotBehavior` 在侧向净空足够且已停滞/持续受阻时进入 `AVOIDANCE`，给真实侧向位移 1.15 单位并低速(.32/.55)绕过行人，不再长时间停车等对峙。③ 浏览中顾客被机器人贴近时提前结束浏览离开 |

### 16.2 实测结果（V2.5 9/9 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 配置 | handoff=[153,44] 距出口 24.8；staging=[88,-8] 距出口 88.8；泊位距出口 137~147；充电桩距出口 125.3；handoff fixture 存在 |
| T1 交接等待点 | 配送完成后 pos=[153,44]、toHandoff=0、toDoor=24.8、plan 末点=[153,44]，出口通道无机器人停靠 |
| T2 返航路径 | 含 staging[88,-8]/出口[170,26]/入口[8,26]，waitAt=175，stagingIndex=7，后续 [-8,-8]→[-8,26]→[8,26]→…→[24,8] |
| T3 整备位置 | 触发整备时 pos=[88,-8]、waitLeft=2.98→0、doorDist=100 |
| T4 归位 | 整备结束回到泊位 [24,8]，status=IDLE |
| T5 机器人绕行 | 可控注入偏前方行人：bypasses=24、AVOIDANCE 336/360 帧、侧向位移 1.15、speedFactor=.55（不长期停车） |
| T6 行人换方向 | 可控僵局：detours=1、出现 DETOUR、最终恢复到 WALKING 且回到原目标 [100,62]、最远脱离 3.55m |
| T7 高峰真实仿真 | 30 人 1200 帧：collisions=0、机器人前进 64.1 单位、detours=24、yields=28、behavior=NORMAL_NAVIGATION（不再堵在原地） |
| T8 异常 | 0 |
| 回归 | V2.4 8/8、V2.3 6/6、V2.2 9/9、V2.1 11/11 全 PASS |

---

## 17. V2.6 最终版：机器人泊位移到「收银排从右往左第 4 台左侧」+ 顾客真实排队结账
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v26-tests.mjs`（10/10）+ `cdp-v26b-peak.mjs`（7/7）+ 全量回归，运行时异常 0。

### 17.1 需求与落点
| 需求原话 | 实现 |
|---|---|
| 机器人最后停的位置 = 那一排收银员「从右往左数第四个收银员的左边」 | 收银通道 `LANE_XS=[132,144,156,168]`（降序第 4 台 = `LANE-1`，x=132）。泊位改为 `robotWaitSlots[0]=[122,8]`，距收银台左缘 6.5 单位（1.1m），车身右缘 124.1 不触台面；第二泊位 `[110,8]` 向左延续 |
| 这样不会挡住最后要结账的顾客 | `LANE-1` 队列站位在 x=132 的纵向长条内，与泊位最近距离 10.2 单位；高峰 30 人实测机器人—排队顾客最小间距 **8.89 单位**（1.51m），零侵入 |
| 顾客要有真实结账环节，买得快的去排队 | 新增购物篮规模 `basket`（1–3 个货区）+ 件数 `items`；`fast` 顾客 72% 只逛 1 个货区，高峰场景 42% 只逛 1 个。逛完即 `GOING_TO_CHECKOUT` |
| 结账要有确定时长，等一会儿就走 | `STORE.checkoutService={base:2.0,perItem:.34,min:2.0,max:5.2}`；`serviceSeconds()` = base + 件数×perItem + 篮量×.12，实测 3.82–5.20 s。服务结束 `finishCheckout()` → 顾客立即 `EXITING` 出店消失 |
| 尤其是人多的时候要体现出来 | 每条通道按容量 4 的 FIFO 队列 + 队首计时 + 整体前移；`#scenarioPeak`「工作日高峰」按钮现在同时驱动行人密度（30 人 / crowded 模式），不再只改路径代价 |

### 17.2 关键缺陷修复（不是加表面功能）
| 现象 | 根因 | 修复 |
|---|---|---|
| 收银台长时间空转、队伍不动 | 顾客在 `GOING_TO_CHECKOUT` 途中被 V2.5 的僵局脱离逻辑 `DETOUR` 拐去绕机器人，永远走不到队尾 | 排队路径加 `queueBound` 守卫：`GOING_TO_CHECKOUT / QUEUEING` 期间不做 DETOUR；服务时长同步骤短（perItem .5→.34，max 6.5→5.2）。90 s 内结账人次 8 → 22 |
| 行人被导航带进机器人泊位 | `buildNavNodes` 只有「收银台→y=26 主通道」的边，缺少**排队通道内部纵向边**，A* 只能借道泊位附近 | 补 `lane.slots` 相邻节点纵向边：泊位附近侵入 0 次，机器人—排队最小间距 4 → 8.89 单位 |
| 平均等待把步进时间也算进去（avgWait 24.5 s） | 计时起点用了入队时刻而非站位到达时刻，且把快进步长计入 | 新增 `queueArrivedAt`，`finishCheckout` 用 `queueArrivedAt || queueJoinAt`；实测 avgWait 4.3–4.8 s，与 4 台并行服务的理论值一致 |
| 2D 地图排队区/泊位/交接区渲染成黑方块 | `ui.css` 缺 `.fixture-queue / .fixture-robotwait / .fixture-handoff` 样式，SVG `fill` 落到默认黑 | 补齐三组虚线样式（暖橙 / 青绿 / 紫），并与既有重复规则合并 |
| 4 号通道 `n/4` 徽标压住「出口」标牌 | 徽标固定画在通道 x 上 | 距出口 < 6 单位时左移 6 单位绘制 |
| 机器人圆点盖住「机器人泊位」标签 | 标签与本体同坐标 | 标签 y 偏移 −24 |

### 17.3 实测结果（V2.6 10/10 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 泊位几何 | 从右往左第 4 台 = LANE-1 x=132；泊位 [122,8]；gap=10；台左缘 128.5 > 车身右缘 124.1；`clash=[]`（不压收银台/排队区/促销岛/自助机）；最近排队位 10.2 |
| T1 启动位姿 | pos=[122,8] = fleet[0].waitSlot；孪生平面图有机器人图元 |
| T2 收银闭环 | 150 s：served=22、queued=8、avgWait=4.7、maxQueue=14、4 条通道全忙；`fifo=true`、`idx=true`（队内序号连续）、`orphan=0`（无人卡死）、`exits=20` |
| T3 服务时长 | 配置 [2.0, 5.2]；5 件→3.82 s，14 件→5.20 s（封顶）；篮量 1/2/3 均覆盖 |
| T4 小篮先结账 | 小篮 14 人 vs 大篮 6 人；小篮平均逛 1.0 个货区，大篮 1.67 个 |
| T5 不侵入队列 | 全程机器人—顾客最小间距 8.89 单位；最近者状态 `GOING_TO_CHECKOUT`（在通道里，不在泊位） |
| T6 面板 | 4 行通道 + 合计行；含「结账中 · 剩余 x.x s」倒计时 |
| T7 订单闭环 | 泊位出发 → 交接 [153,44] → 返航回 [122,8]、status=IDLE |
| T8 充电 | 真实行驶回坞 [122,8]→[116,8]（充电桩就在两泊位之间）→ 补电 → 驶回 [122,8] |
| T9 异常 | 0 |

### 17.4 高峰联动实测（V2.6b 7/7 PASS，走真实 UI 点击路径）
| 测试 | 实测数据 |
|---|---|
| P0 初始 | density=low、mode=shopping、target=7、queued=0 |
| P1 点「工作日高峰」 | density=high、mode=crowded、target=30；两个下拉框与「4 高峰拥堵」预设高亮同步 |
| P2 人流 | 14 s 内拉到 30 人并稳定维持 |
| P3 队列 | 同时排队峰值 16 人；单通道最长 4 人（= 容量，不超员）；4 条通道全忙 |
| P4 结账放行 | 100 s 内结账 23–24 人次、平均等待 4.6–4.8 s，仍有 5–10 人在队；`EXITING` 状态可见 |
| P5 回落 | 切回平常客流后密度/模式回落、不再补人；90 s 内含结账中顾客自然离店，在场 30→13 人、排队 6 人、结账 24→45 人次 |
| P6 异常 | 0 |

### 17.5 回归
V2.5 9/9、V2.4 8/8、V2.3 6/6、V2.2 9/9、V2.1 11/11、行人专项 8/8、V2.0 订单/持久化 8/8 全 PASS（V2.5/V2.4/V2.1 的泊位断言已同步为 `[122,8]`、充电断言同步为 `[122,8]→[116,8]→[122,8]`）。

> 说明：V2.0 脚本 `cdp-v2-tests.mjs` 的 T1 用 `advance(3,60)` 固定推进 40 次（120 s 仿真）等订单走完；V2.6 起机器人从 `[122,8]` 出发、四站巡回 + 让行，实测走完需 ~121 s 刚好越过预算。已把推进预算放宽到 90 次（270 s），属测试脚手架预算问题，非功能缺陷。

### 17.6 已知限制
- 收银服务时长为仿真秒，受倍速影响（5× 时观感变快）；件数与篮量共同决定，未做「扫码逐件」动画。
- 通道容量固定 4 人；满员时顾客继续浏览而不是排到通道外，超过 30 人的极端密度未做队列溢出建模。
- 高峰↔平常切换时已在场的顾客不会消失，只停止补人，因此人数回落是渐进的（实测 90 s 内 30→13）。

---

## 18. V2.7 最终停靠点改为充电桩：确认取货 → 回桩补电 → 下一单从桩上出发
日期 2026-11-22。本地无头 Chrome 实测，脚本 `cdp-v27-tests.mjs`（10/10）+ 全量回归，运行时异常 0。

### 18.1 需求与落点
| 需求原话 | 实现 |
|---|---|
| 最后机器人回到充电桩就行了，不然会挡住需要买东西的人 | 常驻停靠点从「收银排左侧泊位 `[122,8]`」改为**充电桩对接位 `[116,13.4]`**；桩体中心仍是 `[116,8]`，对接位在其正前方 5.4 单位（≈0.92 m），车体半深 2.41 + 桩座半宽 2.06 → **边缘净空 0.93 单位（≈0.16 m）**，停靠不穿模。对接位四周 16 单位内无收银台/排队位/促销岛/自助机 |
| 先去收银台，然后平台收到消息，点击确认，然后机器人回到充电桩 | 订单终点仍是收银台结账 → 店内取货交接区 `[153,44]`；到达后 `awaitingPickup` 触发，面板标题改为「结账完成 · 等待确认取货」，`orderMessage` 明确「平台已收到结账完成消息」；按钮文案 `✓ 确认取货 · 机器人回充电桩`。点击后 `beginReturn(..., {target: dockSlot, purpose:'charge'})`，抵达即 `attachCharger()` |
| 接到下一单要从充电桩继续出发 | 1 号停靠位 = 对接位；`resetPlayback()` 起点、`order.start`、Held–Karp 首段起点全部取自 `fleet[0].waitSlot`（=桩位）。充电中派单也允许（`assignRobot` 纳入 `CHARGING`）；播放键一次点击即「结束充电 + 从桩上出发」 |
| 还是要按数据挖掘结果做最优路径 | 规划器未改：`buildPlan` 起点换成桩位后仍走 Held–Karp；`miningToggleBtn` 打开后方法名为「Held–Karp 精确 · 实验关联加权」，起点仍为 `[116,13.4]`（T7b 实测） |
| 机器人和充电桩不要穿模，在取货的时候 | ① `attachCharger()` 不再把机器人瞬移到桩体坐标（旧代码直接落在桩上，是穿模根因），改为落在 `dockSlot`；② 桩体标记为实体 fixture，行人避障与 3D 都不再穿过；③ 桩体不再是导航图节点，机器人/行人路径不会穿过桩体；④ 机械臂只向车头 -Z 伸出且最大水平伸展 0.30 m，小于车体半深 0.41 m，取货时夹爪始终在车体轮廓内；⑤ 实测全程机器人中心到最近货架边界最小 3.2 单位（> 半车长 2.41） |

### 18.2 本轮修复的实际缺陷（不是改文案）
| 现象 | 根因 | 修复 |
|---|---|---|
| 机器人停在桩上时与桩体穿模 | `chargingDocks[0].waitSlot` 与桩体 `position` **同一个坐标**，`attachCharger()` 直接把机器人放到桩体中心 | 新增 `dockSlot`，桩体与车位分离；`attachCharger/startCharging/stopCharging/beginReturn/确认交接` 全部改用 `dockSlot` |
| 桩上补电的机器人接不到新单 | `assignRobot()` 只认 `IDLE/ASSIGNED`，桩上状态是 `CHARGING` → 新订单进队列但无人可派，`state.order` 为空，播放键无反应 | 候选集合加入 `CHARGING`（桩上待命=可派单） |
| 充电时按播放键只是「暂停充电」，要按两次才能出发 | `playPause()` 对 `charging.active` 无条件 `stopCharging(); return` | 若有待执行订单，一次点击直接「结束充电并继续履约」；无订单时才作为暂停充电 |
| 桩上充电时无法看历史回放 | 回放播放逻辑排在充电分支之后 | 回放分支前置（只读观看优先于充电暂停） |
| 行人可以穿过充电桩 | 充电桩不在 `layoutFixtures`，行人 `blockedByFixture` 只认货架/wall/promo/checkout/kiosk | 新增 `kind:'charger'` fixture，行人避障与 2D 绘制共用；3D 仍用专用模型（fixture 循环跳过该 kind，避免叠加方块） |
| 2D 图看不到充电桩、泊位标签被机器人圆点盖住 | 充电桩从未在 2D 画过；泊位标签固定 y-24 | 新增 `.fixture-charger` 实线样式；停靠位标签上移 −52、充电桩标签下移 +24 |
| 桩体与机器人名牌重叠 | 两者都在 y≈0.9–1.06 | 桩名牌下压到 0.78；机器人初始朝向改为面向桩体（`rotation.y=π`） |

### 18.3 实测结果（V2.7 10/10 PASS）
| 测试 | 实测数据 |
|---|---|
| T0 对接位净空 | slot=[116,13.4]、桩心=[116,8]、centerGap=5.4、半车长 2.41、桩座半宽 2.06 → **edgeGap=0.93 单位**；最近实体（收银台/排队位/促销岛/自助机）16 单位 |
| T1 初始位姿 | pos=[116,13.4]=fleet[0].waitSlot，孪生图有机器人图元 |
| T2 平台消息驱动 | 履约 119 s 后 `awaitingPickup=true`、pos=[153,44]、面板可见、按钮文案「✓ 确认取货 · 机器人回充电桩」 |
| T3 取货不穿模 | 全程车体中心到最近货架边界最小 **3.2 单位**（> 半车长 2.41，无侵入） |
| T4 返航目标 | `returnLeg.purpose='charge'`、target=[116,13.4]、路径含出口[170,26]/整备点[88,-8]/入口[8,26]，全程 441.6 单位 |
| T5 回桩补电 | 到达 pos=[116,13.4]、leg=null、`charging=true`、状态 CHARGING |
| T6 补电 | 42% → 52%（1.6 s 实时），停在桩上不动 |
| T7 下一单从桩出发 | NX-0002 分配给 AMR-01、`charging=false`、规划首段=[116,13.4]、运行中 |
| T7b 数据挖掘 | 打开实验驱动后 method=「Held–Karp 精确 · 实验关联加权」，起点仍 [116,13.4] |
| T8 异常 | 0 |
| 回归 | V2.6 10/10、V2.5 9/9、V2.4 8/8、V2.3 6/6、V2.2 9/9、V2.1 11/11、行人 8/8、订单/持久化 8/8、V2.6b 高峰联动 7/7 |

### 18.4 需要同步修改的旧断言（需求变更而非回归）
| 套件 | 旧期望 | 新期望 |
|---|---|---|
| V2.6 T1/T7/T8 | 初始/返航/充电回 `[122,8]` | 初始/返航/充电回 `[116,13.4]`，抵达即 CHARGING |
| V2.5 T4 | 整备后归位 `[122,8]` | 归位充电桩 `[116,13.4]`（status=CHARGING） |
| V2.4 T5 | 回坞后停 `[116,8]`、停止充电回泊位 | 回坞停 `[116,13.4]`、停止充电后**留在桩上** |
| V2.1 T1/T2 | 返航后 `IDLE`、双泊位间距 >9 | 返航后 `IDLE/CHARGING`、双停靠位间距 >7（实测 8.1，AABB 不重叠） |
| 订单专项 T1d | 返航后 `IDLE` | `IDLE/CHARGING` 均视为已归位待命 |

### 18.5 已知限制
- 只有 1 个充电桩；第二台机器人的停靠位 `[110,8]` 在桩旁但不接入补电（电量只随里程下降）。
- 确认取货后仍保留 V2.2 的「出右出口 → 外侧整备 3 秒 → 从左入口回归」动线，全程 441 单位、约 1× 下 40 s；这是此前明确要求的离店整备演示，未因终点改变而删除。
- 对接位与桩体净空 0.16 m，属于真实充电对接的贴近距离；若需要更大的视觉间隙，可把 `dockSlot` 的 y 再加大 1–2 单位。

---

## 19. V2.8 收银员手臂方向修复（「手装反了」）+ 五官露出
日期 2026-11-22。视觉核对脚本 `cdp-v28-cashier.mjs / cdp-v28-review.mjs / cdp-v28-scan.mjs`（近景·侧面·背面·扫码连拍·等轴·主通道平视），逻辑回归全 PASS，运行时异常 0。

### 19.1 现象与根因
| 现象 | 根因 |
|---|---|
| 收银员两只手从**背后**伸出来，肘部反折，看着像「手装反了」 | `makePerson` 的模型正面是 **−Z**，绕 X 轴必须用**正角**才是朝前伸（行人选购分支 V2.1 已按此修正并留了注释）。但收银员的静态摆姿用了 `shoulder.rotation.x = −.16`、`elbow.rotation.x = −.34`，扫码动画更是 `−.58 / −.72`：上臂被甩到背后，前臂再向后折，手掌正好从后背穿出。 |
| 排队等结账的顾客同样是「手背在身后」 | 行人状态机 `QUEUEING` 分支也是 `−.06 / −.22`，属同一处符号错误 |
| 正面看不到眼睛，头像后脑勺 | 头发是**整圈球冠**且下沿 `theta=0.56π`（低于眉毛 1.535），而眼睛在 1.565、半径被 0.113 的发球完全包住；五官等于被埋进头发里 |

### 19.2 修复
| 位置 | 改动 |
|---|---|
| 收银员站姿 | `shoulder.x=+.30`（上臂前倾）、`shoulder.z=±.13`（双手向身前收拢）、`elbow.x=+.42`（前臂继续前伸）、`palm.x=−.34`（掌面下扣）→ 双手落在收银台上方 (z≈−0.29 m, y≈0.78 m)，不再从背部穿出 |
| 扫码动画 | 右手抬起对准扫码窗再落回：`shoulder.x = .30 + .46·scan`、`elbow.x = .42 + .26·scan`，`scan = sin(3.6t+φ)`；左手恒定稳在台面上（只随呼吸微动）。节奏从 7.2 rad/s 降到 3.6 rad/s，扫码动作更像「拿起来扫一下」而不是高频抖动 |
| 排队顾客 | `QUEUEING` 改为 `shoulder.x=+.10`、`elbow.x=+.22`、`z=±.05`：手自然垂在身前 |
| 走路手臂 | 前臂由 `−.08` 改为 `+.08`，与「正角=朝前」一致 |
| 发型 | 拆两件：头顶发冠（`theta ≤ 0.50π`，下沿正好在头部赤道，不会悬空）+ 后脑/两侧发片（`phi 328°→212°`，只包住后 240°，正面留出整张脸） |
| 五官 | 眼睛下移到 `y=1.542`（发际线 1.555 以下）、尺寸 .023×.014；鼻子下移到 1.518 并加大到 r=.019；眼镜片随之下移 |

### 19.3 核对方式
| 视角 | 结论 |
|---|---|
| 正面近景（`v28-cashier-front.png`） | 双手在身前、左右对称，无背后穿出；脸上能看到两只眼睛 |
| 侧面近景（`v28-cashier-side.png`） | 上臂从肩部前倾 → 肘 → 前臂指向收银台，关节方向自然；鼻子有凸起 |
| 背面近景（`v28-cashier-back.png`） | 背后干净，没有任何手掌/前臂穿出 |
| 扫码连拍（`v28-scanb-*.png`） | 队首结账时右臂抬起又落回，左臂稳在台面；顾客队列站在身前 |
| 等轴 / 主通道平视（`v28-iso.png`、`v28-aisle-1.png`） | 全场 30 人无一例手臂反折；头发不再盖住脸 |

### 19.4 回归
V2.7 10/10、V2.6 10/10、V2.5 9/9、行人专项 8/8、订单/持久化 8/8 全 PASS，运行时异常 0（本轮只改 `scene3d.js` 的人形骨架与动画，不涉及路径/队列/订单逻辑）。

### 19.5 附：新增调试接口（仅用于自动化视觉核对，不影响仿真）
`__NEXUS.debugCamera(from, at)` 摆放自由相机、`__NEXUS.debugWorld(point, height)` 把门店坐标换算成世界坐标、`__NEXUS.debugCheckout(list)` 直接查看某组结账状态下的店员动画。

---

## 20. V2.8 机器人专用自助收银台 + 结账流程改造 + 收银台加高
日期 2026-11-22。需求原话：「在充电桩的右边设置一个机器人专门机器人自助收银台，布局不要太挤在收银台1和充电桩之间，稍微建模好点，别太潦草……最后的位置不要在文具和宠物用品之间，最后拿完所有东西要先去机器人自助收银台买单，等我们线上确认订单以后再回到充电桩……收银台太矮了，不符合逻辑，怎么样桌子最高处也应该和肚子持平吧。」

测试脚本 `cdp-v28c-tests.mjs`（T0/T0b/T1–T8，10 项）**10/10 PASS**；回归 V2.6 10/10、V2.7 10/10、V2.5 9/9、V2.4 8/8、V2.3 6/6、V2.2 9/9、V2.1 11/11、行人专项 8/8、订单/持久化 8/8；运行时异常 0。

### 20.1 布局：为什么把充电桩左移，而不是硬塞在中间
原来充电桩在 `x=116`，收银台 1 左缘在 `127.5`，两者之间只有 11.5 单位（≈1.96 m），扣掉桩体半宽 2.06 与机器人车宽 3.65 单位后几乎没有可站立通道，自助收银台一旦插进去就会把「桩—台」通道压到人侧身都过不去。所以本轮先把桩体左移，再把自助收银台放在桩的**右侧空地**：

| 元素 | 坐标（门店单位） | 折算尺寸 / 净空 |
|---|---|---|
| 充电桩 CHG-1 | `[108, 8]`（原 `[116, 8]`） | 桩体半宽 2.06 单位（0.35 m） |
| 机器人自助收银台 RPOS-1 | `[120, 10]` | 机身 3.6 × 3.9 单位 = **0.61 × 0.66 m** |
| 机器人买单位 RPOS-1.stop | `[120, 15.4]` | 机身正前方 5.4 单位 = 0.92 m |
| 收银台 1 左缘 | `127.5` | 距自助收银台右缘 5.7 单位 = **0.97 m** |
| 充电桩↔自助收银台 | `108 → 120` | 两侧机身净空 **1.38 m** |
| 促销岛 C | `99 → 94` | 再让出 1 m，桩左侧也有通道 |

T0 实测：`pay=120,10 charger=108,8 左净空 1.38m 右净空 0.97m 机身 0.61×0.66m`，几何冲突检测 `clash=[]`。**不再挤在收银台 1 与充电桩之间**，两侧都留出了 ≥0.97 m 的通行/绕行空间。

### 20.2 建模：按三视图做一台「能看」的自助收银台
三视图（1600 × 600 × 650 mm 机型）被拆成 6 层，共 40 余个部件，全部程序化生成（无外部模型）：

| 层 | 内容 |
|---|---|
| 脚轮 | 4 只 `r=.032` 轮 + 轮座，可调脚杯造型 |
| 底座 | 圆角底板 0.56 × 0.62 m，收进 20 mm，视觉上有「抬起」感 |
| 下柜体 | 0.56 × 0.60 m 圆角柜体 + 前维护门板 + 竖向把手 + 门缝压条 |
| 台面 | **860 mm** 白色圆角台面（前出檐 90 mm）+ 前沿不锈钢包边，机器人可以把篮子推上去 |
| 上部机身 | 内收 0.50 × 0.44 m 机头：扫码窗（红光标）、小票出口、状态灯（teal/amber） |
| 屏幕 | 后倾 **12°**（`head.rotation.x=.21`）的 0.44 × 0.30 m 触摸屏 + 顶部状态灯条 |
| 背面 | 4 条散热格栅、线缆接口排（4 个圆口）、维护门 + 把手——从背面看也不是「空壳」 |

机身上方挂 `机器人自助收银台` 标签，`tagGroup(g,'robotpay',{id})` 使其可被「点选查看详情」和 2D/3D 联动识别。

### 20.3 建模：收银台太矮（0.28 m → 0.82 m）
| 项 | 之前 | 现在 |
|---|---|---|
| 台面高度 | 通用 fixture 盒体 `h=.28`（**28 cm**，连膝盖都不到，确实不合逻辑） | **0.82 m** 台面 + 50 mm 厚白色圆角面板，视觉顶面 ≈0.87 m |
| 平面尺寸 | 7 × 4 单位（1.19 × 0.68 m，比例偏方） | **9 × 3.6 单位 = 1.53 × 0.61 m**（真实收银通道比例） |
| 柜体 | 一个实心盒子 | 踢脚 + 圆角柜体 + 三扇柜门 + 竖向铝拉手 + 门缝压条 |
| 台面细节 | 无 | 传送带（带面 + 两侧铝型材）、扫码窗（红光标）、打包区（不锈钢面）、店员侧显示器（立柱+屏幕）、顾客侧刷卡器（斜面 + 屏）、台号牌 |

高度为什么定 0.82 m 而不是 0.90–1.05 m：本场景人形高 1.62 m（眼高 1.542 m），收银员摆姿后手掌落在 **0.78 m**。台面定 0.82 m 让手掌正好搭在台面上方 2–4 cm（扫码动画抬落也在这个区间），视觉上恰好到店员**腹部/腰带位置**——与用户「桌子最高处和肚子持平」的要求一致；若按现实商用柜台抬到 0.95 m 以上，反而会让店员手掌陷进台面里，出现新的穿模。侧视截图 `v28b-checkout-row.png` 可核对：四台柜台顶面齐腰腹，柜门与地面投影关系正常。

### 20.4 流程：取货 → 自助收银台买单 → 平台账单 → 线上确认 → 回桩
| 步骤 | 改动 |
|---|---|
| 订单终点 | `STORE.handoff` 从「文具—宠物用品之间的 `[153,44]`」改为 `robotPayStations[0].stop = [120,15.4]`；`handoff` 仅作兼容别名保留，避免全链路改名 |
| 路径规划 | `buildPlan()` 的终点段统一指向买单位：`pay[j] = leg(stops[j].point, payPoint)`，Held–Karp 代价矩阵最后加上 `pay[...]`；**仍从充电桩 `[108,13.4]` 出发**，仍是「Held–Karp 精确 + Apriori 实验关联加权」 |
| 导航图 | `bottomXs` 加入买单位 x；新增边 买单位↔纵向主通道、买单位↔`robotWaitSlots`（≤14 单位内互连），A* 可直接规划到台前 |
| 到站行为 | `arrive()` 最后一段触发 `PAYING`：`state.awaitingPickup=true`、机械臂伸出（`reach=1`，叠加 `sin(2.2t)` 抬落）、自助收银台状态灯转**琥珀色脉冲**、面板标题「机器人自助收银台 · 等待线上确认」、按钮「✓ 确认订单 · 机器人回充电桩」 |
| 结算 | 平台账单按订单金额推送（日志：账单已推送平台，等待线上确认），KPI 脚注改「已线上确认并回充电桩」 |
| 线上确认 | `confirmHandoff()` 语义改为「线上确认订单」→ 灯效复位 → `beginReturn(..., {target: dockSlotPoint(), purpose:'charge'})` → 经右出口/外侧整备/左入口回 `[108,13.4]` → `CHARGING` 自动补电 |
| 下一单 | 仍从充电桩对接位出发（`fleet[0].waitSlot`） |
| 2D 平面图 | 新增 `.fixture-robotpay` 图元（`#cfeee6 / #16796a`）+ 「机器人自助收银」与「买单位」标签；标签下移 30 避开与「充电桩」重叠；删掉重复的充电桩门点 |
| 文案 | `nextName()` 返回「机器人自助收银台」；`progressText` → 「等待线上确认订单」；Held–Karp 流程图末端标签改「自助收银」 |

### 20.5 不穿模
| 校验 | 结果 |
|---|---|
| 机器人与桩体 | 对接位 `[108,13.4]` 距桩体中心 5.4 单位（0.92 m），车体半深 2.35 单位 + 桩底座半宽 2.06 单位 → 净空 1.0 单位（0.17 m），T3 确认 `CHARGING` 时无重叠 |
| 机器人与自助收银台 | 买单位距台体中心 5.4 单位，车头距台面前沿 **0.19 m**；860 mm 台面对齐机械臂肩高 0.80 m + 水平伸展 0.30 m，`reach=1` 时夹爪落在台面上方，不插进机身（`v28c-pay-robot.png`） |
| 行人与自助收银台 | 实体白名单加入 `robotpay`，行人不穿模；T5 高峰 30 人时 `inside=0` |
| 排队区 | T4 `overlapQueue=false / overlapPay=false`——收银台放大到 1.53 × 0.61 m 后仍未压到排队区与自助收银台 |

### 20.6 断言变更（需求变更，非回归）
| 套件 | 变更 |
|---|---|
| V2.6 T1/T7/T8 | 泊位断言从硬编码 `116` 改为读 `fleet[0].waitSlot`（桩位已移到 108） |
| V2.7 T1/T2/T4/T5/T7/T7b | 同上；终点断言改为 `STORE.handoff` / 买单位 |
| V2.5 T1 | 期望值改为 `x≈120 且 y<26`（终点不再是 `[153,44]`） |
| V2.2 T4 | 促销岛 C 阈值 `promoC <= 99` → `<= 94` |
| V2.1 T2 | 净空阈值 `gapUnits > 5`（桩体左移后通道更宽） |

### 20.7 遗留
- 只有 1 台自助收银台（`RPOS-1`），`robotPayStations` 是数组，加第二台只需追加一条、`buildNavNodes()` 与 2D 图元会自动跟随。
- 自助收银台目前不参与「多人同时买单」的排队逻辑——它是机器人专用位，人类的 4 条 FIFO 队列仍在收银台 1–4。
- 停靠位 2（`[102,13.4]`）仍不接补电，仅作战备泊位。

---

## 21. V2.9 就近回桩 + 人群挡路自主改道
日期 2026-11-23。需求原话：「就近回归充电仓就行了呀，没必要绕一圈，还有，不一定要根据规划路线走，一旦人多了挡住路了，要有自己的思考去规避行人，而不是死板的就着一条路走。」

测试脚本 `cdp-v29-tests.mjs`（T1–T7）**7/7 PASS**；回归 V2.8 10/10、V2.7 10/10、V2.6 10/10、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11、行人专项 8/8、高峰专项 7/7、订单/持久化 8/8；运行时异常 0。

### 21.1 「绕一圈」的根因与改法
| 项 | 之前 | 现在 |
|---|---|---|
| 触发点 | `confirmHandoff()` 调 `beginReturn(..., viaExit=true, ...)` | `viaExit=false` |
| 返航路径 | 自助收银台 → 右出口 → 门外整备 3 秒 → 左入口 → 充电桩，**459 单位（≈78 m）** | 自助收银台买单位 `[120,15.4]` → `[108,13.4]`，**12.2 单位（≈2.1 m）**、只有 2 个点 |
| 时长 | 约 1× 倍速下 40 s（含 3 s 整备等待） | 约 3 s |
| 离店整备演示 | 默认执行 | 保留为**可选演示**：`__NEXUS.returnViaExit()`；该动线被标记 `viaExit`，不参与自主改道，不会被改道逻辑覆盖 |

### 21.2 机器人为什么原来只会「贴着一条线走」
两处硬伤，都是本轮排查出来的：

| 问题 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 重规划起点取「全图最近节点」 | 机器人在路段中间时，最近节点可能在**身后**；每 4.5 s 重规划一次就把它拽回去，实测卡在 `[69.6,62]` 附近左右横跳 80 s 以上、20 次改道零前进 | `nearestNode(position)` 只看距离、不看方向 | 改为 `nextNodeAhead(leg, at)`（当前路段的下一个节点）+ `prevNodeBehind()` 作为「往回绕」的候选 |
| 拼接路径丢掉最近节点 | 路径第一段变成「当前位置 → 第二个节点」的**斜线**，会横穿货架 | `[from, ...fresh.points.slice(1)]` 把 `fresh.points[0]` 删了 | `stitchPath(from, path)`：保留最近节点，仅重合时去重 |
| 人群场从未刷新 | 「暴露人数」恒为 0，改道判据形同虚设 | 写了 `refreshCrowdField()` 却没调用 | `decideCrowdReroute()` 开头先 `refreshCrowdField(snapshot)` |

### 21.3 自主改道：算法与阈值
| 环节 | 做法 |
|---|---|
| 实时人群场 | 行人快照按 **4 地图单位**栅格化（`crowdField`）；只有动态改道时 `liveCrowdOn=true`，保证初始规划可复现、不会因某帧行人位置抖动 |
| 边代价 | 正常代价 + `crowdAround(边中点) × 18`；即 3 人并排堵住一条纵向通道 ≈ 多绕 54 单位，A* 才会真的换通道 |
| 前视判定 | 沿行进方向 **15 单位（≈2.7 m）**、走廊半宽 **2.1 单位（≈0.36 m）** 内数人；≥2 人即认为「通道被挡」 |
| 候选路径 | 同时从前节点与后节点各规划一条，按 `暴露人数 × 18 + 长度` 打分取优（否则「前方节点就在人堆里」时会先一头扎进人群） |
| 采纳条件 | ① 平时：至少少穿 **2 人**，且长度 ≤ **1.25 倍 +6**；② 已被堵死（局部层连续 4 s 走不动）：允许「大改道」≤ **2.4 倍 +30**，但每段路只决策一次并 `committed` 锁定 |
| 防抖 | 冷却 **4.5 s** + 每段路最多 **2 次** + 改道后 `legDistance=0` 重算；`leg.committed` 后不再改 |
| 暴露人数 | 每条边在 1/4、1/2、3/4 处采样累加（只看中点会漏掉「堵在段口」的人） |
| 可见性 | 日志 + 状态栏「自主绕行」；调试接口 `__NEXUS.crowdProbe()` 返回 `ahead / lastTry{verdict, exposureBefore/After, lengthBefore/After}`；机器人面板新增「人群自主改道 N 次」 |

### 21.4 局部选空隙（不等人让路）
原来只有「侧向净空已经 ≥ 0.82 m 才绕行」这一条，等于**人站在车道中间时机器人只会停**。本轮在 `robotBehavior.js` 加了选空隙：

```
required = 车半宽 + 人体半径 + 0.20 m      // 与人体中心的最小横向间距
shortfall = required - |横向偏移|           // 差多少才过得去
steer = 远离该行人一侧的 min(shortfall + 0.12, 0.45) m
```
横向最多 **0.45 m**（2 m 通道内仍留得下车身与安全间隙），保持 **0.9 s** 后回落，`speedFactor>0` 才生效，避免左右摆。配合行人侧的让路/绕行，形成「人让一点、车偏一点」的双向避让。

### 21.5 新增仿真事件：人群堵路
仿真中心与 3D 页事件栏新增 `人群堵路`：在机器人当前通道正前方 **1.8–2.6 m** 内放 5 位「正在理货/交谈」的顾客（真实行人个体，有半径与避让规则），停留 20–27 s。这群人**不会**因为机器人靠近就散开（`planted` 标记），所以通道是真的被堵住，用来观察机器人「等 → 侧向选空隙 → 仍过不去 → 自主改道」的完整决策链。

### 21.6 实测
| 场景 | 结果 |
|---|---|
| 确认后返航（T2） | `[120,15.4] → [108,13.4]`，12.2 单位、2 个点、不含出口/整备点/入口，3 s 到桩并 `CHARGING`（T3） |
| 人群堵路（T4） | 机器人 `[99,33.3]` 前方 5 人停留 → 判据 `exposureBefore 7.33 → exposureAfter 1.67`、路径 `129.6 → 115.1`（+12%），改走 `[99,26] → [72,26] → [45,26] → [45,44] → [45,62] → [45,80]`，**穿过人群数从 7.33 降到 1.67**；`verdict=accepted`，日志与状态栏同步 |
| 改道后（T5） | 仍能完成 4 个货区取货并停在自助收银台，无卡死、无碰撞 |
| 通道畅通（T6） | 整单跑完改道次数 0（不乱改道） |
| 离店演示（V2.3 T1c/T2/T3） | 显式触发时仍为 `staging[88,-8]`、门上 `doorDist=100`、等待 3 s、从入口回桩 |

### 21.7 断言变更（需求变更，非回归）
| 套件 | 变更 |
|---|---|
| V2.7 T4 | 「含出口整备路线」→「就近最短路径，且不含出口/整备/入口」 |
| V2.5 T2/T3 | 整备等待断言 → 「waitAt=0 且全程远离出口（minDoor=63.1）」 |
| V2.3 T1 | 「含 staging/出口/入口」→ 默认不含；新增 T1c 用 `returnViaExit()` 验证该演示动线仍可用 |
| V2.2 T2 | 同时断言「默认就近」与「显式触发时门外整备 3 s」 |
| V2.1 T1 | 「经出口+外侧通道返航」→「就近回桩到 `[108,13.4]` 并补电」 |

### 21.8 遗留
- 改道只在「A* 真能找到更少穿人的路」时发生；本店通道图是正交网格，两侧绕行代价往往很高，所以**高峰期更多表现为减速+选空隙通过**，而不是每次都换通道——这与真实 AMR 的取舍一致，但演示时可先用「人群堵路」事件制造确定性阻塞。
- 局部选空隙只做单侧 0.45 m 的一次性选择，没有做多步轨迹推演（TEB/MPC）；如需更接近工业级，可在此扩展。

## 22. V3.0 五项修复：KPI 口径 / 订单生命周期 / 去配送语义 / 实验驱动真的绕冷区 / 右后角布局
日期 2026-11-23。需求原话：「还有总览的数据是更新，有很多单都完成了但是不更新上面的数字。订单历史中取消该订单无效，点了没用，有bug，待配送的订单可以取消掉，如果还没进行的订单就不是3D回放，而应该是去配送的按键才合理。还有启用实验驱动规划，就有自己的思考，可以折返走没有人或者数据上很少有人买的一块区域避开行人走，我不希望路径优化是个摆设。还有这个角落里看起来太不和谐了四个柜子都堆一起，角落里也可以放呀，帮我那一块重新布局，不要太挤，要行人和机器人都可以通过。」

测试脚本 `cdp-v30-tests.mjs`（T0–T8，11 条断言）**11/11 PASS**；回归 V2.9 7/7、V2.8 10/10、V2.7 10/10、V2.6 10/10、V2.6b 7/7、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11、订单/持久化 8/8、行人专项 8/8；运行时异常 0。

### 22.1 总览 KPI「不更新」的根因
| 现象 | 根因 | 修复 |
|---|---|---|
| 完成多单后顶部数字仍是 0，刷新后归零 | KPI 只数内存里的 `state.completed`（每次刷新清空，且只有本页确认的订单会进数组） | 新增 `orderCounts()`（`systemCore.js`）直接遍历持久化订单表；`app.js` 的 `orderStats()` 以持久化记录为准，再叠加内存里尚未落库的事件 |
| 之前别的视图完成的单不计入 | 同上，`state.completed` 是页面级数组 | 同上，`orderStats()` 成为唯一口径，`renderLiveOps()` 的 `opsOrders / opsDone / kpiOrders / kpiCompleted` 全部走它 |
| 用户无法判断数字含义 | 脚注只写「回充电桩」 | 脚注改为「已线上确认并回充电桩 · 历史共 N 单」，把分母摊开 |
| **刷新后「进行中」还是 0**（第二处漏渲染） | `restorePendingOrders()` 把待配送单回填进 `state.queue` 之后没有触发重渲染，KPI 停在上一次「0 单」的快照上，直到用户切视图才更新 | 初始化链改为 `if (restorePendingOrders()) renderAll();` |

实测（T1/T2/T5/T5b）：提交 2 单 → `kpiOrders=2`；刷新 → 队列恢复 2 单且 `kpiOrders` 仍为 `2`（T2 新增断言 `kpiOrders === stats.active`）；完成 1 单 → `kpiCompleted=1`、`stats={active:0, completed:1, cancelled:1, total:2}`；**刷新后仍为 1**，脚注「历史共 2 单」。最终验收（3 单：完成 / 取消 / 待配送）：`active 1 / completed 1 / cancelled 1 / total 3`，刷新后四项与「历史共 3 单」完全一致。

### 22.2 订单历史「取消」点了没用
根因：`cancelOrderById()` 只处理两种情况——「在队列里」和「当前正在执行」；第三类**只存在于持久化记录里的待配送单**（例如刷新后未回填、或历史里的早期订单）直接落到 `return false`，界面毫无反应。

改法（三个分支 + 行内按钮）：
```js
function cancelOrderById(id, reason = '用户取消订单') {
  const index = state.queue.findIndex(o => o.id === id);
  if (index >= 0) { /* ① 队列中：splice + saveOrder + 日志 */ }
  if (state.order && state.order.id === id) { /* ② 执行中：patchOrder + beginReturn */ }
  const record = getOrderRecord(id);
  if (record && !orderFinal(record)) {          // ③ 只在持久化记录里
    patchOrder(id, { status: '已取消', cancelledAt, cancelProgress: record.progress, note: reason });
    state.completed.push({ id, status: '已取消' });
    state.queue = state.queue.filter(o => o.id !== id);
    renderAll(); refreshDetail(); return true;
  }
}
```
同时补掉连带 bug：`submitOrder()` 原来写 `saveOrder(state.order || order)`，**排队的第二单从未落库**（所以刷新后历史里有、队列里没有）；改为逐单 `saveOrder()`。并新增 `restorePendingOrders(limit=6)`：刷新后把未终结的持久化订单回填成「待分配」队列，`配送中/返航中` 一律降级为待分配，避免脏状态。

实测（T2/T3/T3b）：提交 2 单 → 刷新 → 队列恢复 `["NX-0001","NX-0002"]`，两行都是「去配送 + 取消」；点 NX-0002 的取消 → 队列 `→["NX-0001"]`、`stats.cancelled=1`、行状态变「已取消」；**再刷新仍是已取消且不回队列**。

### 22.3 「3D 回放」与「去配送」的语义
| 订单状态 | 之前 | 现在 |
|---|---|---|
| 待分配 / 待配送 | 显示「3D 回放」（点了只是看动画） | 「**去配送**」——点了就 `playPause()` 真的出发，机器人在 3D 场景里动起来 |
| 已完成 / 已取消 | 「3D 回放」 | 「3D 回放」（真回放，`startReplay`） |
| 行内危险操作 | 无 | 未终结时才出现「取消」（`.link-danger`，文字型下划线，和队列里的取消一致） |

实测（T4）：点「去配送」后 `started=true`、`replay=false`、`playLabel=暂停履约`，12 s 内机器人实际位移 **46.9 单位**。

### 22.4 实验驱动规划不能是摆设（本轮技术核心）
三处叠加，逐层修掉才让「有数据依据的绕行」真的发生：

| 层 | 问题 | 修复 |
|---|---|---|
| 数据 | 只有共购规则参与**访问顺序**，没有真实「哪个货区卖得多」 | `buildZoneHeat()`：从 Apriori 规则反推前件购买次数（`count / confidence`）→ 按品类汇总 → `log1p` 归一化到 0–1；实测生鲜 1.0、乳品 0.911、饮品 0.834 … 海鲜 0.494、文具 0.527 |
| 边代价 | 只有客流与长度，冷热货区一个价 | `cost += length × (heat − .45) × 0.55`；即热区边 +30%、冷区边 −20%，足以在两条平行纵向通道之间做取舍 |
| 启发式 | `heatAt()` 对 20 单位内所有货区做**加权平均**，冷热互相抵消（实测 `miningHeat === regularHeat === 0.346`，怎么算都一样） | 改成「最近货区热度 × 线性衰减」（半径 24 单位），再配合 **A\* 启发式可采纳性修复**：mining 模式边代价最低可到 0.85× 长度，若启发式仍用纯欧氏距离就变成高估、A\* 会提前收敛回热通道，因此 `hFactor = mining ? .8 : 1` |
| 改道 | 只在原路径附近找替代，永远不会「折返绕去另一条道」 | 人群挡路时追加候选：`当前位置 → 冷区 → 目标`，**起点必须是当前路段的下一节点**（用当前位置会拼出斜穿货架的直线，v2.9 踩过的同一个坑）；采纳门槛在 mining 下放宽到 `1.5× +10`（urge 时 `3.4× +45`），每段最多 3 次 |
| 决策 | 只比 `暴露人数 × 18 + 长度` | 同等避让效果（少穿人数差 ≤ 1.2 人）时**优先选更冷的路线**，让「避开人群」和「避开热货区」同向 |
| 可见性 | 只在日志里写一句 | 2D 图虚线圈出数据冷区并标注；面板给出「路径平均需求热度：常规 X → 实验驱动 Y」与冷区依据 |

实测（T6，同一起点同一目标，长度完全相同 443.2）：
- 常规：`[99,26] → [99,44] → [99,62]`，平均热度 **0.236**
- 实验驱动：`[99,26] → [72,26] → [72,44] → [72,62]`，平均热度 **0.234**

实测（T7，机器人 `[72,37]` 前方植入 5 位顾客）：
```
exposureBefore 6.33 → exposureAfter 2.67   length 129.6 → 92
verdict = accepted     heatBefore 0.188 → heatAfter 0.284（这次选了更短更少穿人的，不是最冷的）
cands: via[126,44] heat .137 / via[45,44] heat .256 / via[99,44] heat .103 …
```
即：候选里**真的存在**更冷的折返方案（如 `[126,44]`，热度 0.137），只有在「少穿人也不吃亏」的时候才会被选中——这是有意的权衡：**先保证真的躲开人，再在效果相当时选冷区**，而不是为了「看起来在绕冷区」去撞人。

### 22.5 冷区的口径修正：样本内 vs 样本外
初版把「没进 600 件候选集」的品类（个人护理、清洁用品、母婴、宠物…）按最低热度 `0.08` 计入，界面上直接标成「数据冷区 · 个人护理」。这等于把「没有销量样本」说成「证实没人买」，站不住。本轮改成两级：

| 类别 | 判定 | 界面上 | 用途 |
|---|---|---|---|
| 样本内低需求（海鲜 543 次、文具 823 次、家庭日用 3,534 次、肉类 9,763 次） | `frequency > 0` | 深青虚线 + 「**数据冷区 · 海鲜**」 | 绕行候选**优先**取这些；面板列出次数 |
| 样本外（个人护理、清洁用品、母婴、宠物） | `frequency === 0` | 浅色点划 + 「**样本外**」 | 仅作占位（保守低热度），面板明确写「不算已证实没人买，只是缺少证据」 |

代码上：`zoneKnown` 集合 + `sampledColdZones(n)`（只取有样本的）；改道候选池优先用 `sampledColdZones(4)`，样本不足 2 个时才拿样本外补齐。

### 22.6 右后角落布局重排
原状：最右一列（col 5）货架宽 13 单位、几乎贴着右墙（净空 0.5–0.9 m），右墙又塞了两台靠墙冷柜，四台柜体在角落里叠成一坨，行人和机器人都过不去。

改法（`storeData.js`）：
```js
const lastCol = d.col === 5;                      // 最右一列
const w  = lastCol ? 9 : d.w;                     // 13 → 9 单位
const cx = lastCol ? 163.5 + jitterX * .35 : colCenter(d.col) + jitterX;
```
- 右墙两台靠墙冷柜改到**后墙**：`杂货侧柜 x=65`、`冷藏侧柜 x=166`，右墙整面让空；
- 后墙冷柜组重排为 `A(40) / 杂货(65) / B(90) / C(140) / 冷藏(166)`，柜间留缝 1 单位。

实测（T0）：`overlaps = []`（27 个柜体/货架两两不重叠）、**主通道 1.86 m**（机器人 0.61 m 宽，余量充足）、**靠墙通道 1.25 m**（行人单人通过绰绰有余）、`rightWall = []`（右墙不再挂柜体）。后墙柜体只到 `y=134.5`，最后一排货架 `yMax≈124`，留 10.5 单位（≈1.8 m）纵向间距。

### 22.7 断言变更（需求变更，非回归）
| 套件 | 变更 |
|---|---|
| V3.0 T7 | 不断言「一定选中最冷的那个候选」，而断言「候选池里算出了冷区方案（`coldCandidates>0`）且最终更少穿人」——见 22.4 的权衡说明 |
| V2.7 T7b | 切换实验驱动不再打断运行中配送（改为只在未运行时 `resetPlayback`），测试补「先暂停再切换」 |
| V3.0 T6 | 2D 冷区断言从「有 3 个虚线框」细化为「有 3 个虚线框，且标注来自有样本的冷区」 |

### 22.8 遗留
- 冷区绕行目前是「路网节点旁的货区」粒度，没有做「通道中段停一下」的连续避让；如果要做，需要在 `buildNavNodes()` 增加货运通道中线节点。
- `heatAt()` 的 24 单位半径对中间那排货架的判定偏保守（两侧热区都会衰减到它），真实门店可用 RTLS 实测人流校准这个半径。
- 未进 600 件候选集的 6 个品类（约 12% 库存单位）仍缺销量样本；补采后 `HEAT_FLOOR` 占位会自动消失，无需改代码。

## 23. V3.1 运动与避让行为重做：不画半弧 / 停车让位 / 倒车换向 / 行人不围机器人
日期 2026-11-23。需求原话：「我不要莫名其妙转个半弧线……人多的时候，启用实验驱动规划，进行自己的考量可以倒车换个方向去找没有人或者少人的路，而不是莫名其妙抖一抖，有一种情况就是前面有人可以选择停下来（不要推着人走），或者实在太堵走别的路，还有行人也别太无脑，围住机器转。」

### 23.1 「半弧线」与「抖一抖」的三个来源与修法
| 来源 | 旧行为 | 新行为 |
|---|---|---|
| 朝向从位移增量反推（`scene3d.placeRobot`） | 改道/掉头时机器人边走边转，轨迹是连续大弧 | 仿真层显式维护 `state.heading`，3D 直接读取（`robotFleetSnapshot().heading`）；掉头不再靠位移推断 |
| 大角度也边走边切 | 90° 以上的方向变化全走弧线 | `advanceWithHeading()`：≤100° 边走边转（路口顺滑小弧）；100–150° **原地转向**（不平移）；>150° 进入两阶段掉头机动 |
| 「挤缝转向」无保持时间 | 前方有人时横着蹭 0.45 m 且左右换边（抖） | 移除行进中的挤缝；改为「停车让位」（见 23.2），方向带 2 s 粘滞 |

### 23.2 前面有人：先停车、让位、不推人
- 机器人与挡道行人净空不足 → **直接停车等待**（`WAIT`，速度 0），不再横着挤过去；
- 停稳后向远离行人一侧**平移让位 ≤0.45 m**（`parkShift`，仅在 `speedFactor=0` 时生效，方向粘滞 2 s）——车不动、人先过，腾出让行空间；
- 持续受阻 >4 s → 请求改道（`decideCrowdReroute`），实在堵死走别的路。

### 23.3 倒车换向（用户点名的行为）
`state.maneuver` 两阶段：**reverse**（保持车头朝向、车尾沿新路线退约 1 米，速度 0.55×）→ **spin**（原地转向新路线，2.4 rad/s）→ 交回正常控制。被行人刹停时不盲倒（车尾视角外），只原地转。实测（`cdp-v31-motion.mjs`）：改道反向后 240 帧采样 reverse 71 帧 + spin 35 帧，最大单步位移 0.077 单位，无连续弧线。

### 23.4 行人不围机器人
| 问题 | 修法 |
|---|---|
| 绕行点在机器人**前方**，行人从机器人面前斜切（像围着转） | 绕行点放机器人**后方**，并吸附到导航图节点（离机器人 ≥16 单位 ≈2.7 m、离人 8–46 单位、按「离人+离原目标」打分）——路线必然可走且真正拉开距离 |
| 绕行期间的机器人排斥场太强，把人钉在 2.2 m 边界上卡死（货架+排斥夹角） | 排斥强度 0.5+1.6·gain → 0.12+0.55·gain，近距冲刺 1.5→0.7；实测对峙场景 7 s 内脱离 6.06 m（此前 2.23 m 卡死） |
| 让行方向只看期望方向，可能选到货架堵死的一侧，人在「货架—机器人」之间反复蹭（5× 高峰碰撞来源） | 让行方向感知货架：`blockedByFixture` 探测两侧，堵死的一侧自动换边 |
| 近距离 (<0.95 m) 让行被弱化后 5× 高峰出现 5 次碰撞 | 保留近距离快速侧移脱离（防碰撞关键动作），只削弱中距离的持续绕圈分量 |
| 停着的机器人车体被行人当空地 | `move()` 增加 robot hull 硬约束：行人沿车体边缘滑过，物理上无法进入车体（含 hull 内推出） |

### 23.5 回归
V3.0 11/11、V2.9 7/7、V2.8 10/10、V2.7 10/10、V2.6 10/10、V2.6b 7/7、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11（T6 修复后零碰撞）、行人专项 8/8、订单持久化 8/8，运行时异常 0。

### 23.6 遗留
- 倒车距离固定 6 单位（≈1 m），没有根据通道宽度自适应；窄于 1.6 m 的货道理论上应缩短。
- `parkShift` 只考虑了行人与货架，没有考虑对面收银排队区（排队区有独立容量约束，重叠概率低）。
- 行人绕行点打分没有把「机器人未来 3 秒路径」计入，极端情况下绕行方向与机器人改道方向相同（两者都有让行与 hull 约束兜底）。

## 24. V3.2 离店动线：结完账就走，高峰不堵门口
日期 2026-11-23。用户截图反馈：高峰时七八个人在出口门口挤成一坨互相顶，结完账也出不去。

### 24.1 根因
所有离店行人共用同一条路线 `[sideX,26] → (170,26) → (170,20) → 店外`——全店的人流都汇聚到**门中点这一个坐标**再折 90° 直角出门；行人互斥全强度（1.35×）在门前互相推挤，形成肩并肩的死结（实测门内最近人距 0.22 单位 ≈3.7 cm，即截图里的贴脸团）。

### 24.2 修法（`beginExit`）
| 措施 | 效果 |
|---|---|
| **每人一条过门车道**：过门 y 在开门宽度内按行人 id 散列摊开（26±4 单位 ≈0.7 m），到门前 x=158 就已切到自己的车道，直着穿门 | 人流摊满整个门宽，不再向单点汇聚；门内最近人距 0.22 → **2.44 单位**（≈0.41 m） |
| **离店提速 +18%**：结完账就往外走、不闲逛 | 12 人压力测试排空 17 s → **12.4 s**（−27%） |
| **门口同向互斥减弱**：两个都在离店且都在 x>158 的人，互斥 1.35× → 0.75×（仍不重叠） | 密集人流顺滑通过，不再互相顶成结 |
| 车道偏移用 **id 散列**而非种子随机数 | 不消耗共享 RNG 流，后续行为序列与旧版一致，回归方差不变 |

兜底离店（失去队列归属的顾客、路线走完的路人）同样走 `beginExit`，不再各自导航到门中点。

### 24.3 回归
V3.0 11/11、V2.9 7/7、V2.8 10/10、V2.7 10/10、V2.6 10/10、V2.6b 7/7（两连跑，served 23/21 与基线持平）、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11、行人专项 8/8，运行时异常 0。高峰 75 s 视觉抽查：出口区人流散开通过，无堵门密集团。

> 注：V2.6b P4 曾因过门车道消耗种子随机数导致一次 served=6 的假失败，改为 id 散列后两连跑 7/7。

## 25. V3.3 通道净空 + 风险守门 + 订单详情操作 + 回放行人
日期 2026-11-23。用户四点反馈：①经常卡死，通道要保证推车行人与机器人能走（布局可以有窄有宽但不能卡）；②机器人应会走人少的最后一排；③实验驱动的风险值 4.7→5.1 反而升高，与研究目的相悖；④已取消订单要能删除/再来一单；⑤回放期间行人不动。

### 25.1 通道净空（卡死根因）
审计（59 组相邻实体间隙）：**26 条低于 2.0 m**，机器人+推车行人会车需 ≈1.78 m——后排货架与后墙冷柜之间最窄 1.16 m，前场促销岛与充电桩之间 1.1 m，都是截图卡死点。
| 措施 | 结果 |
|---|---|
| **单元净空钳制**：货架边缘与左右通道中心线至少留 6 单位（≈1.02 m） | 任意「货架↔货架」通道 ≥12 单位 ≈**2.04 m**，同时保留 ±1.8 单位错位 → 通道 2.0–2.6 m 有宽有窄、不呆板 |
| 第三排 ROW_CENTERS 116→114、h≤16（其余排 h≤18）；后墙冷柜贴墙（y 137→139） | **最后一排通道 ≥2.09 m**——这是高峰人最少的备选路线，机器人可走 |
| 促销岛 C 缩小左移（w 10→8、x 94→90.5）、促销岛 B 左移（x 72→70） | 前场真通道全部 ≥1.87 m |
| 机器人缩小：radius .36→.30 / 宽 .62→.55 / 长 .82→.72 | 会车需求 1.78→1.66 m；布局零重叠 |
| 复核回退：自助收银台 x=123 改回 **x=120**——原位置两侧净空本就达标（左 1.31 m/右 0.97 m），右移反而与收银台 01 只剩 0.46 m（V2.8 T0 抓住） | 「充电桩↔自助收银」1.31 m 缝隙北侧是开阔区，非真通道 |

实测：高峰 30 人整单配送完成 130–165 s 仿真秒，最大死滞 4.25–5 s（正常礼让），零卡死。

### 25.2 风险值方向修正（研究目的=降风险）
三层：
1. **风险模型去平均化**：旧版对 20 单位内所有货区取平均人流，每条通道风险都≈全场均值，分不出冷热；改为「最近货区人流 × 距离衰减」——紧邻繁忙货区的通道显著更高、后排显著更低；
2. **实验驱动风险权重 1.3→2.2**，且关联折扣只作用于「长度+时间」分量、**风险不打折**；
3. **两级风险守门**：逐段——实验选的走法若比同端点常规走法风险高则退回该段；方案级——实验关联重排后整体风险若仍高于常规方案（如演示单 5.7→6.9），整体回退常规并在 method 明说「风险守门：实验顺序会推高风险（5.7→6.9），已回退常规走法」。

**保证：当前方案的风险值永远 ≤ 原方案**（14–16 组货区×时段扫描，最大 dRisk = 0.00，个别场景真下降）。对比面板说明同步更新。

### 25.3 订单详情：删除记录 / 再来一单
- 已取消订单详情新增「**删除记录**」（`systemCore.removeOrder`，仅允许删除已终结订单；同步从 state.completed 扣减，KPI 随之修正）；
- 已取消订单新增「**再来一单**」：按原商品明细生成新订单（新 id、`reorderedFrom` 溯源），走正常分配/排队/落库流程。

### 25.4 回放行人冻结修复
`pedestrianLoop` 让位条件是 `state.running`，而回放期间 `state.running=true` 但主仿真心跳 `animate()` 在回放时直接返回——两边都以为对方在推进行人 → 冻结。改为 `(state.running && !state.replay)`。实测回放激活时 3 秒内行人位置发生变化。

### 25.5 回归与断言更新
V3.0 11/11（T6 断言改为「风险不升 + 路径变化或明示守门」）、V2.9 7/7（T1 停靠点断言复核后维持 120）、V2.8 10/10（T0 抓住右移挤点，回退后过）、V2.7 10/10（T7b 接受守门文案变体）、V2.6 10/10、V2.6b 7/7（served 23）、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11、行人 8/8、订单 8/8，异常 0。

## 26. V2 数据挖掘体系升级（监督学习 / CF / 需求分析）

### 26.0 目录默认视图：「全部部门」→「高热度商品」
目录共 49,688 件商品，逐件展示不现实且旧「全部部门」选项名不副实。默认选项改为**高热度商品（默认）**：按真实购买频次展示前 50 件，并在目录上方实时说明覆盖范围（`catalogScope`）；搜索与部门/货区精确筛选保留不变。

### 26.1 技术验收清单（10 项）
1. **新增文件清单**
   - `scripts/train_reorder_model.py`（复购预测 + 完整评估体系）
   - `scripts/build_recommendations.py`（Item-based CF + 离线评估）
   - `scripts/build_demand_analysis.py`（频次回归 + 补货优先级）
   - `public/data/ml/reorder-model.json`、`cf-recommendations.json`、`demand-analysis.json`
   - 前端：`index.html`（导航+页面骨架+CF/补货卡）、`instacart.js`（`loadMl`/`renderMlDashboard`/`renderCfRecommendations`）、`app.js`（集成+`ensureProduct`+`renderRestockPriority`）、`layout.js`（视图注册）
2. **实际训练样本数**：训练 269,882 行 / 测试 90,837 行 / 共 360,719 行（20,000 抽样用户：15,013 训练 / 4,987 测试）；每订单保留全部正样本 + 固定采样 15 个负样本。
3. **划分方式**：user_id 的 MD5 哈希 4 桶取 3（≈75/25）；同一用户只在同一侧，训练/测试用户不相交。CF 同理：5 桶取 4 构建相似度（104,906 篮）、1 桶评估（26,303 篮，有效评估 18,636 篮）。需求回归：product_id 哈希 75/25（22,572/7,428 件）。
4. **输入特征列表**（25 项）：订单上下文 4（order_number / dow / hour / days_since_prior，中位数填补）+ 商品静态 4（估算价格 / 重量 / 热量 / 是否食品）+ 训练划分流行度 2（log10 频次、复购比例）+ 部门 one-hot 15。**不含 reordered、不含全量频次/复购率。**
5. **目标标签**：样本 =（用户，候选池商品）对；label = 1 当该商品出现在用户订单且该行 `reordered=1`（真实复购行为）。
6. **实际评估指标**（测试集，与流行度基线对比）：

   | 模型 | CV AUC（5 折） | Accuracy | Precision | Recall | F1 | 测试 AUC |
   |---|---|---|---|---|---|---|
   | 逻辑回归 | 0.7555±0.0028 | 0.7355 | 0.3466 | 0.6277 | 0.4466 | 0.7514 |
   | 随机森林 | 0.7610±0.0040 | 0.7570 | 0.3703 | 0.6125 | 0.4616 | **0.7617** |
   | 决策树 | 0.7315±0.0047 | 0.7421 | 0.3523 | 0.6159 | 0.4482 | 0.7484 |
   | 多数类基线 | — | 0.7114（全预测不复购） | — | — | — | — |
   | 流行度基线 | — | — | — | — | — | 0.7464 |

   CF（vs 热门基线，同一评估集）：P@5 **0.0639** vs 0.0583、R@10 **0.1739** vs 0.1480、NDCG@10 **0.1248** vs 0.1063——CF 全面超过热门基线。
   需求回归（随机森林，对数空间）：R² 0.1317、MAE 1.0607；计数空间 MAE 38.74（中位数基线 39.46）。**结论如实呈现：属性对频次解释力有限，预测任务不可靠，因此补货优先级采用真实历史信号（频次×复购率）而非模型输出。**
7. **Data Leakage 检查说明**：①label 用 reordered 字段，特征不含该字段与该行信息；②候选池与流行度特征仅用训练划分用户订单计算；③用户哈希划分保证双侧不相交；④未使用任何"未来订单"信息（无跨订单历史特征——数据集行项目只覆盖每位用户最后一单，prior 订单无商品明细，页面已如实说明该限制及模型相对流行度基线提升有限的成因）。
8. **前端页面位置**：左侧导航新增「监督学习 / SUPERVISED LEARNING」（`#ml`）；订单管理页购物篮推荐下方新增「协同过滤推荐」卡；库存管理页底部新增「补货优先级分析」表。
9. **结果 JSON 位置**：`public/data/ml/`（3 个文件，懒加载，加载失败只禁用新页面不影响既有功能）。
10. **运行与复现方法**（固定种子 6143，可完全复现）：
    ```bash
    cd 6143_robot
    python scripts/train_reorder_model.py        # 复购模型（约 40 s）
    python scripts/build_recommendations.py      # CF（约 8 s）
    python scripts/build_demand_analysis.py      # 需求回归（约 3 s）
    python -m http.server 8099 --bind 127.0.0.1  # 浏览器打开 #ml 视图
    ```

### 26.2 数据挖掘结果与机器人应用的连接（第六阶段）
- Apriori 关联规则 → 订单页「购物篮推荐」（既有）；K-means → 商品聚类分析（既有）；
- **CF 共现相似度 → 订单页推荐面板**（新增，与 Apriori 并列；点击可加购，商品按需从部门分片解析）；
- **复购预测 + 需求频次回归 → 库存管理「补货优先级分析」**（新增；优先级=历史频次×复购率，模型预测仅作对照列，页面明示历史频次≠未来需求、线上订单≠门店销量）；
- 客流分析 → 动态路径规划、需求 → 补货系统（既有链路保持）。

### 26.3 无监督学习保留核查（第五阶段）
Apriori（真实 support/confidence/lift，131,209 个训练购物篮，28,052 条规则）与 K-means（真实肘部法/轮廓系数/PCA 投影）全部保留且未被本轮改动触碰。

### 26.4 测试与回归
- 新增探针 `cdp-v34-ml-probe.mjs`：①页面 0 JS 错误；②目录默认视图=高热度商品（50 件+范围说明）；③监督学习页完整渲染（模型对比 29 表行、3 条 ROC 曲线、3 张混淆矩阵、CF 查询 500 商品、查询返回 10 近邻）；④CF 面板推荐可加购（购物车金额正确 ¥25.13）；⑤库存页补货优先级 10 行。
- 新增 harness `run-test.mjs`（headless Chrome 9222 自包含起停）。
- 回归：V3.0 11/11（T6 风险守门正常）、V2.9 7/7、V2.8c 10/10、V2.7 10/10（T7b 守门文案正常）、V2.5 9/9、V2.4 8/8、V2.3 7/7、V2.2 9/9、V2.1 11/11、行人 8/8、订单 8/8。
- 已知环境项：V2.6 T7/T8 在沙箱 headless 下失败（机器人高峰偶发长礼让），git stash 基线（无本轮改动）**同样失败**——非本轮引入；机制上 blockedTime>4s 触发 A* 重规划、>9s 请求人工介入，4 次探针运行订单全部完成（`finished=true`）。本轮未改动机器人运动/避障代码；建议在桌面环境复验数值（headless 渲染时钟会放大礼让时长，实测波动 3.75–13.5 s）。
