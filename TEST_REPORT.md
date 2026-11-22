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
