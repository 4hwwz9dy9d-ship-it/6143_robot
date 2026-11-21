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
| Held–Karp produced exact visit order for 4 zones | PASS (`Held–Karp exact visit order`) |
| A* planned 6 legs (entrance → 4 zones → checkout → exit) | PASS |
| Robot followed path; progress advanced 0% → 100% | PASS |
| Cold-chain item triggered employee-assistance gate | PASS (2/4 stops, robot stopped) |
| Employee confirmation resumed task | PASS |
| Checkout and exit handover reached | PASS (`Awaiting exit handover`) |
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
