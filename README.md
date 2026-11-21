# NEXUS RETAIL — Autonomous Retail Intelligence Platform

**Smart Supermarket Operations & Robotic Simulation** · INT6143 Group 3

A static, GitHub Pages–ready teaching platform that connects a real Instacart product catalog, an offline-mined research dataset and an executable robot-navigation simulation. Light enterprise dashboards surround a dark 3D control center; all simulated elements are explicitly labelled.

## Live site

https://4hwwz9dy9d-ship-it.github.io/6143_robot/

Teaching window: until 2026-12-31 23:59:59 Beijing time. After that the scheduled workflow publishes `expired.html`.

## What is in the project

| Area | Contents |
|---|---|
| Overview | Hero, real-session KPIs, system status, order pipeline, zone preview |
| Order Management | Instacart English catalog search, cart, simulated payment, order queue, fulfillment table, Apriori recommendations |
| Inventory | Simulated stock, low/out-of-stock alerts, employee restock confirmation |
| Retail Analytics | Real Instacart statistics, order-hour chart, Apriori support/confidence/lift, K-means clusters, simulated crowd samples |
| 3D Supermarket | Irregular 18-zone store, modular gondolas/coolers/produce islands/carts/checkouts, Premium AMR, three camera modes, 2D/3D switch |
| Robot Control | AMR status, battery/load, navigation log, destination, fault drills |
| Route Optimization | Held–Karp visit order, A* segment costs, original/current comparison, cost benchmark |
| Simulation Center | Pedestrian, cart, aisle closure, overload, congestion and navigation-failure events |
| Research | Real data / calculated / simulated / assumed classification, algorithm and methodology notes in Chinese |
| Presentation Mode | Full-screen 3D view with HUD showing task, order, route and algorithm |

## Technology

- Vanilla JavaScript ES modules, no build step for the front end.
- Vendored Three.js + OrbitControls in `vendor/` (no paid third-party service).
- Procedural geometry and canvas textures — no external GLTF/GLB or image assets.
- Static JSON in `public/data/` produced by `scripts/build_data.py`.
- GitHub Pages deployment through `.github/workflows/expire-pages.yml`.

## Data and algorithm integrity

- **REAL DATA** — product names, departments and purchase links from the five supplied cleaned Instacart CSV files. The original CSVs live in `data/raw/` and are not published to Pages.
- **CALCULATED** — Apriori rules (real support / confidence / lift), K-means clusters, in-browser Held–Karp visit ordering and A* segment costs.
- **SIMULATED** — shelf coordinates, stock, crowd counts, obstacles, robot position, battery, travel time and all event triggers.
- **ASSUMPTIONS** — 1 USD = ¥7 teaching rate, ¥30 minimum order, 12 kg capacity, 20 units per shelf, fixed speed and braking distance.

Held–Karp is exact for ≤12 unique zones. Above 12 zones the interface explicitly switches to a nearest-cost heuristic and states that global optimality is not guaranteed. A* searches the aisle graph defined by `STORE.aisleXs`, `crossYs` and `verticalYs` in `storeData.js`; the 3D scene and the 2D map read the same file, so coordinates stay in sync. Shelves, walls and closures are non-traversable.

There is no trained vision classifier, no real-time inventory feed and no physical robot. The sensor adapter accepts an external provider through `window.INT6143_SENSOR.registerProvider(fn)` for future integration; the default provider is rule-driven simulation.

## Rebuild the offline research data

```bash
python scripts/build_data.py --source /path/to/cleaned_csv_folder
```

Outputs: catalog shards, search index, summary, rules, clusters, top products and top reorder products under `public/data/`. Running the script is optional for the website — the committed JSON is ready to serve.

## Local preview

```bash
python -m http.server 8099
# open http://127.0.0.1:8099/
```

ES modules require HTTP; opening `index.html` directly from disk will not work.

## Deployment

Push to `main`. The workflow copies the root page files, `vendor/` and `public/` into `_site`, then deploys with `actions/deploy-pages@v4`. No new files need to be registered when editing only the existing JS/CSS/HTML files. If a new root asset is added, add it to the `cp` line in `.github/workflows/expire-pages.yml`.

See `TEST_REPORT.md` for the functional regression record.
