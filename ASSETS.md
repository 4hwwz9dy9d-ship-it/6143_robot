# 参考资产清单 / Reference Asset Inventory

本清单明确：用户提供的参考图已归档、每张对应什么设计、哪些已落实为 3D 资产、哪些仍受限。**参考图是 2D 渲染设计稿，不是可直接导入 Three.js 的带骨骼 GLB/GLTF 模型**；项目按图的比例、配色、结构做程序化精细建模，不把图片当作模型使用。

| 文件 | 参考内容 | 落实状态 |
|---|---|---|
| `assets/references/01-staff-green-vest.jpg` | 店员：绿色马甲 + 白衬衫 + 工牌 + 黑裤 | 已落实为角色 look 0（绿马甲+工牌+深灰裤） |
| `assets/references/02-male-beige-shirt.jpg` | 男顾客：米色衬衫 + 白内搭 + 深棕裤 + 白鞋 | 已落实为角色 look 1 |
| `assets/references/03-female-green-sweater.jpg` | 女顾客：墨绿毛衣 + 米色裤 | 已落实为角色 look 2 |
| `assets/references/04-female-navy-trench.jpg` | 女顾客：藏青风衣 + 黑裤 + 棕靴 | 已落实为角色 look 3（长风衣下摆） |
| `assets/references/05-senior-burgundy-cardigan.jpg` | 老年顾客：酒红开衫 + 眼镜 + 银发 | 已落实为角色 look 4（眼镜+银发+矮身高） |
| `assets/references/06-male-gray-jacket.jpg` | 男顾客：灰夹克 + 牛仔裤 | 已落实为角色 look 5 |
| `assets/references/07-supermarket-fulfillment-diorama.jpg` | 大型超市等轴布局：多区货架、主通道、促销岛、冷柜、收银/打包区、标识牌 | 已落实为扩大后的 29.92×23.97 m 空间、错位货架、中央促销岛、后墙冷柜、独立收银排队区、天花板照明与区域招牌 |
| `assets/references/08-supermarket-retail-diorama.jpg` | 中型超市：木质生鲜台、玻璃冷柜、收银台、购物车、机器人、地面分区 | 已落实为生鲜展示台、玻璃门冷柜+内部冷光、收银传送带设备、金属购物车、机器人、分区地面材质 |
| `assets/brand/cashier-ref.jpg` | 用户提供的收银员四视角参考：黑发女性、绿色马甲 + 白衬衫 + 黑长裤 + 工牌 + 马尾 | V2.4 已落实：收银台常驻店员改用完整人形骨架（球头五官/马尾/关节手臂/马甲工牌/皮鞋），替换原粗糙圆柱模型 |
| 机器人设计图（上一轮提供） | 石墨底盘 + 哑光白机身上盖 + LiDAR + 双目 + 屏幕 + 货台 + 状态灯 | 已落实为 AMR 模型（含数字表情屏、LiDAR、双目、轮组、安全环） |

## 未直接落实的部分与替代方案

- **真实 GLB/GLTF 骨骼人物**：图片不是模型文件。当前用层级关节（肩/肘/髋/膝）程序化建模 + 行走/待机/浏览/推车/转向/停止动画。若提供合法授权的带骨骼 GLB，可在 `scene3d.js` 的 `makePerson()` 中替换模型与动画，导航/碰撞/队列逻辑无需改动。
- **照片级写实材质**：当前为 Premium Semi-Realistic 风格（PBR 标准材质 + 程序化纹理），非离线渲染级写实。
- **复杂手指骨骼**：手掌以椭球 + 拇指几何表示，无逐指骨骼；但推车时手掌锚点与把手世界坐标误差 0.000000 m，视觉上稳定贴合。
- **GLTF 懒加载 / LOD**：当前全部程序化生成，商品用 InstancedMesh，人物复用共享几何；无外部模型加载，因此不需要 GLTF 懒加载。

## 去水印说明

参考图仅作为项目内建模参考文件存放，**不作为页面展示素材**；站点页面不含任何"AI 生成"字样或水印。

## V2.1 新增品牌素材（用户提供）

| 文件 | 内容 | 用途 |
|---|---|---|
| `assets/brand/logo.png` | 用户提供的「超市机器人 / INT6143 · GROUP 3」logo（已去白底透明） | 后续可直接用于标题/演示；当前导航使用圆形图标版本 |
| `assets/brand/logo-mark.png` | logo 左侧圆形徽标（透明底） | 左上角导航品牌图标 |
| `assets/brand/amr-front.jpg` | 用户提供的 AMR 正面完整机身渲染图（干净裁切） | 总览右侧展示、机器人控制页头像 |
| `assets/brand/amr-side.jpg` | AMR 带货篮侧视渲染图 | 备用展示（第二台机器人） |
| `assets/brand/amr-back.jpg` | AMR 背面渲染图 | 备用展示 |
| `assets/brand/amr-face.jpg` | 表情屏特写条 | 备用展示 |
| `assets/brand/paper-logo-4.jpg` | 用户提供的「论文logo设计 (4)」深蓝背景等轴场景图：机器人沿虚线路径穿越四组货架 | 第一页总览主视觉（`heroVisual`，V2.2 替换） |
| `assets/brand/amr-control.jpg` | 用户提供的「论文logo设计 (2)」机器人特写：白色机身 + 双目表情屏 + 顶置 LiDAR + 四轮底盘 | 机器人控制中心页主图（`controlVisual`，V2.2 替换） |
| `assets/brand/paper-logo.jpg` | 上一版总览图（等轴场景，浅色背景） | 备用（已由 paper-logo-4.jpg 取代总览位） |

**替换接口**：以上路径全部集中在 `branding.js` 的 `BRAND_ASSETS`。用户后续提供正式图片时只改这一处，不需要改 `index.html` / `app.js`。界面图片是说明图，不会冒充 3D 实时渲染；3D 中的机器人仍由 `scene3d.js` 实时生成。
