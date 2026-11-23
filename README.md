# NEXUS RETAIL — Autonomous Retail Intelligence Platform

**Smart Supermarket Operations & Robotic Simulation** · INT6143 Group 3

A static, GitHub Pages–ready teaching platform that connects a real Instacart product catalog, an offline-mined research dataset and an executable robot-navigation simulation. Light enterprise dashboards surround a dark 3D control center; all simulated elements are explicitly labelled.

## Live site

https://4hwwz9dy9d-ship-it.github.io/6143_robot/

Teaching window: until 2026-12-31 23:59:59 Beijing time. After that the scheduled workflow publishes `expired.html`.

## What is in the project

| Area | Contents |
|---|---|
| Overview | Hero, real-session KPIs **derived from the persisted order table** (so completed / cancelled counts survive a reload), system status, order pipeline, zone preview |
| Order Management | Instacart English catalog search, cart, simulated payment, order queue with **one-click "去配送" (dispatch now)**, fulfillment table, Apriori recommendations |
| Order History | Persisted order archive with status filter / time sort, detail view, robot / route / timing records and **inline actions**: unfinished orders show **"去配送" (really dispatches the robot, not a replay) + "取消"**, finished ones show **"3D 回放"**. Pending orders are rehydrated into the queue after a reload, and cancelling works from all three states (queued / in delivery / persisted-only) |
| Inventory | Simulated stock, low/out-of-stock alerts, **manual + threshold-based auto restock** with a persistent restock log and 3D shelf sync |
| Retail Analytics | Real Instacart statistics, order-hour chart, Apriori support/confidence/lift, K-means clusters, simulated crowd samples |
| 3D Supermarket | 29.9 × 24.0 m store, 18 offset irregular zones (gondolas/glass-door coolers/produce islands/promo islands), a **right-rear corner that is no longer blocked**: the rightmost shelf column is narrowed to 9 units (centre `x = 163.5`, leaving a **1.86 m main aisle** on its left and a **1.25 m wall lane** on its right), and the two wall coolers that used to stack into that corner were moved onto the back wall — 27 fixtures, zero overlaps, no fixture on the right wall; 4 checkout lanes with **real FIFO queues** (cashier scanning with a fixed service time per basket) and counters modelled at **0.82 m counter height, 1.53 × 0.61 m** with belt / scan window / bagging area / monitor / card terminal, a **dedicated robot self-service pay station** (0.61 × 0.66 m body, 860 mm countertop, 12° touchscreen, status lamp) standing in the open floor **right of the charging dock** with ≥0.97 m clearance on both sides, premium AMR parked on the dock, six reference-based articulated pedestrian characters, five camera modes (full/iso/top/follow/close), 2D/3D switch |
| Pedestrian Control Center | Five pedestrian types, autonomous shopping behaviour, basket-size-driven routes, **queue → scan → leave** checkout loop, density/speed/mode controls, four preset scenarios, live safety telemetry. The header **"工作日高峰 / Peak weekday"** toggle also raises the live crowd to 30 shoppers so queues visibly build. **V3.1: pedestrians no longer orbit the robot** — deadlock detours route to a nav-node **behind** the robot (≥2.7 m away), the detour repulsion field is light enough not to pin people against shelves, yielding direction is shelf-aware (a blocked side is never chosen), the stopped robot hull is a solid obstacle pedestrians slide around, and only the sub-0.95 m emergency side-step retains full strength (collision-critical) |
| Human-Aware Navigation | Behaviour state machine, time-to-collision prediction, velocity-aware safety distance, predictive yielding, local avoidance and A* replan requests. **Motion model V3.1: no unexplained arcs** — heading changes ≤100° turn smoothly while driving, 100–150° turn **in place**, and a near-reversal (>150°, e.g. after a crowd detour) performs a scripted **reverse-then-spin** manoeuvre (backs up ≈1 m along the new route with the body held, then rotates in place). A person standing in the lane is answered by **stopping, not squeezing**: the robot parks, slides ≤0.45 m to the free side (sticky 2 s side choice, no jitter) to open a passing gap, and only re-plans (possibly reversing onto a colder aisle) after 4 s of continuous blockage |
| Fleet & Lifecycle | **1 robot by default, configurable to 2** (persisted, independent parking slots — slot 1 *is* the dock bay `[108,13.4]`, slot 2 the standby bay `[102,13.4]`). Distance/battery-based dispatch, full task lifecycle (accept → pick → **pay at the robot self-service station** → bill pushed to the platform → **operator confirms the order online** → **shortest A\* path straight back to the charging dock** — from the pay stop it is a single 12-unit (~2 m) leg, no exit loop), **cancel-in-delivery with safe re-planned return**, and an optional scripted "leave the store, 3 s outside staging, re-enter" demo still available through `__NEXUS.returnViaExit()`, and **automatic top-up on arrival**: the home slot is 0.92 m in front of the dock centre, leaving ≈0.16 m clearance so robot and charger never intersect. The next order always departs from the dock |
| Robot Control | AMR status, battery/load, navigation log, destination, fault drills, **backend fleet-size configuration** |
| Demo Speed | **1× / 2× / 3× / 5×** simulation-time scaling with fixed ≤1/60 s physics substeps; all planning, avoidance, TTC, state machines and inventory rules unchanged |
| Digital-Twin Map | Live heatmap, pedestrian heading arrows, full fleet positions, return path, gate status — same coordinates and snapshots as 3D |
| Route Optimization | Held–Karp visit order, A* segment costs, original/current comparison, cost benchmark, and an **experiment-driven mode that is not cosmetic**: real purchase frequency per zone is back-derived from the Apriori rules (`count / confidence`, log-normalised), fed into the A* edge cost (hot aisles +30%, cold aisles −20%, plus an admissible heuristic factor) and used to generate **detour candidates that fold back through genuinely low-demand aisles** when a corridor is blocked. Candidates come from zones that actually have sales samples; categories outside the 600-product candidate set are shown as **“样本外” (no sample)** rather than being passed off as “nobody buys here”. The 2D map outlines the data cold zones and the panel reports “average demand heat: regular X → experiment Y” |
| Simulation Center | Pedestrian, cart, aisle closure, overload, congestion and navigation-failure events |
| Research | Real data / calculated / simulated / assumed classification, algorithm and methodology notes in Chinese |
| Presentation Mode | Full-screen 3D view with HUD showing task, order, route and algorithm |

## Technology

- Vanilla JavaScript ES modules, no build step for the front end.
- Vendored Three.js + OrbitControls in `vendor/` (no paid third-party service).
- Procedural geometry and canvas textures for the 3D scene — no external GLTF/GLB. User-supplied robot renders and logo are used only in 2D UI panels via the single replacement interface `branding.js` (`assets/brand/`).
- `pedestrian.js` owns pedestrian behaviour; `robotBehavior.js` owns local human-aware decisions. A* in `app.js` remains the global planner.
- `systemCore.js` is the single persisted data layer (orders / inventory / restock log / fleet setting) backed by `localStorage` with in-memory fallback.
- `scaledSubsteps()` in `app.js` implements demo speed by increasing the number of fixed small physics substeps per rendered frame, never by teleporting or disabling collision checks.
- Static JSON in `public/data/` produced by `scripts/build_data.py`.
- GitHub Pages deployment through `.github/workflows/expire-pages.yml`.

## Data and algorithm integrity

- **REAL DATA** — product names, departments and purchase links from the five supplied cleaned Instacart CSV files. The original CSVs live in `data/raw/` and are not published to Pages.
- **CALCULATED** — Apriori rules (real support / confidence / lift), K-means clusters, in-browser Held–Karp visit ordering and A* segment costs.
- **SIMULATED** — shelf coordinates, stock, crowd counts, obstacles, robot position, battery, travel time and all event triggers.
- **ASSUMPTIONS** — 1 USD = ¥7 teaching rate, ¥30 minimum order, 12 kg capacity, 20 units per shelf, fixed speed and braking distance. Simulation design values (not a real safety certification): 1 unit = 0.17 m; store 29.92 × 23.97 m; robot 0.62 × 0.82 m; 0.78 m/s nominal speed, 2.0 m warning zone, 0.80 m buffer, 0.55 m/s² braking; main aisle ≈ 2.7 m, secondary ≈ 2.0 m; four checkout lanes × four queue slots (FIFO, one cashier each; simulated service time 2.0 s + 0.34 s/item, clamped to 2.0–5.2 s) with counters 1.53 × 0.61 m at 0.82 m counter height (matched to the 0.78 m palm height of the 1.62 m procedural staff so hands rest on, not inside, the top); the rightmost shelf column is 9 units deep with a 1.86 m main aisle and a 1.25 m wall lane, so both pedestrians and the robot can pass; demand heat is a derived research quantity, not a measurement — it is back-derived per zone from the Apriori rules (`count / confidence`, log-normalised to 0–1) and zones with no sales sample fall back to a `0.08` floor that the UI labels **“样本外”**; the experiment-driven edge weight is ±30%/−20% around a 0.45 neutral heat, the cold-aisle tie-break tolerates a 1.2-pedestrian difference in exposure, and detours in that mode may run up to 1.5 × route length (3.4 × when the robot has been blocked for 4 s); one charging dock at `[108,8]` with a 0.70 m plinth, robot parking 0.92 m from its centre leaving ≈0.16 m clearance; crowd-aware rerouting thresholds — 2 pedestrians inside a 2.7 m × 0.7 m corridor ahead, alternative must cut ≥2 pedestrians and stay within 1.25 × route length (2.4 × when the robot has been blocked for 4 s); lateral gap steering capped at 0.45 m; one robot self-service pay station at `[120,10]` (0.61 × 0.66 m body, 860 mm countertop) with the robot's payment stop 0.92 m in front of it and ≥0.97 m clearance to the dock and to counter 1. All world coordinates come from `storeData.js` (`STORE`, `CAMERA`, `PHYSICS`), shared by the 3D scene, 2D map, A* graph and pedestrian system.

The supplied images are **2D design references** (turnaround sheets / architectural renders), not rigged GLB/GLTF files, so they cannot be imported directly into Three.js. They are archived in `assets/references/` with an inventory in `ASSETS.md`. Robot and six pedestrian characters are procedural, following the referenced proportions, palettes and structures with hierarchical joints; the cart-shopper's palm anchors are derived from the cart handle's own coordinates (zero world-space error). Replacing them with real GLB assets later does not require changes to the navigation or behaviour layer. See `QUALITY_AUDIT.md` for the issue list and `TEST_REPORT.md` §9 for the regression record.

Held–Karp is exact for ≤12 unique zones. Above 12 zones the interface explicitly switches to a nearest-cost heuristic and states that global optimality is not guaranteed. A* searches the aisle graph defined by `STORE.aisleXs`, `crossYs` and `verticalYs` in `storeData.js`; the 3D scene and the 2D map read the same file, so coordinates stay in sync. Shelves, walls and closures are non-traversable.

There is no trained vision classifier, no real-time inventory feed and no physical robot. The sensor adapter accepts an external provider through `window.INT6143_SENSOR.registerProvider(fn)` for future integration; the default provider is rule-driven simulation.

## Rebuild the offline research data

```bash
python scripts/build_data.py --source /path/to/cleaned_csv_folder
```

Outputs: catalog shards, search index, summary, rules, clusters, top products and top reorder products under `public/data/`. Running the script is optional for the website — the committed JSON is ready to serve.

### NEXUS RETAIL 2.0 offline research scripts

All scripts read `data/raw/*.csv` (or versioned JSON already in `public/data/`) and write compact, versioned JSON under `public/data/ml/` and `public/data/lab/`. All use seed 6143 and record real `seconds`; no metric is hardcoded. Each script runs standalone in < 90 s with Python 3.13 + pandas/numpy/scikit-learn installed.

```bash
# V2 core ML (reorder / CF / demand regression)
python scripts/train_reorder_model.py
python scripts/build_recommendations.py
python scripts/build_demand_analysis.py

# NEXUS 2.0 data-mining lab
python scripts/build_data_profile.py             # → lab/data-profile.json
python scripts/build_association_analysis.py     # → lab/association-analysis.json
python scripts/build_recommendation_analysis.py  # → lab/recommendation-analysis.json
python scripts/build_clustering_analysis.py      # → lab/clustering-analysis.json
python scripts/build_congestion_classifier.py    # → lab/congestion-classifier.json
python scripts/build_travel_regression.py        # → lab/travel-regression.json
python scripts/build_traffic_forecast.py         # → lab/traffic-forecast.json
python scripts/build_anomaly_detection.py        # → lab/anomaly-detection.json
```

The front end loads these files lazily (`miningLab.js` → `loadMiningLab()`), and each file is isolated: a missing JSON only disables its own panel. The four-section navigation (OPERATIONS / DATA MINING / INTELLIGENT ROBOTICS / RESEARCH LAB) is defined in `index.html` + the `titles` whitelist in `layout.js`. See `DEVELOPMENT_REPORT.md` for the complete 2.0 delivery and verification record.

## Local preview

```bash
python -m http.server 8099
# open http://127.0.0.1:8099/
```

ES modules require HTTP; opening `index.html` directly from disk will not work.

## Deployment

Push to `main`. The workflow copies the root page files, `vendor/` and `public/` into `_site`, then deploys with `actions/deploy-pages@v4`. No new files need to be registered when editing only the existing JS/CSS/HTML files. If a new root asset is added, add it to the `cp` line in `.github/workflows/expire-pages.yml`.

See `TEST_REPORT.md` for the functional regression record.
