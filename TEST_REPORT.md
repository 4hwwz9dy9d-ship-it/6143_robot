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
