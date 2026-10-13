# Travel Guide Studio Skill · 旅行攻略生成技能

[English](README.md) | **简体中文**

把旅行需求或已有攻略整理成**移动端友好的旅行手册**，并输出可交互 HTML 页面。技能自带页面模板、真实地图模块、数据合同和 Python 生成器；美化时保留参考攻略的核心功能。

[**GitHub Pages 展示与验收入口**](https://chenchen428.github.io/travel-guide-studio-skill/) · [杭州完整案例](https://chenchen428.github.io/travel-guide-studio-skill/hangzhou-guide.html#trip-map) · [下载技能包](https://chenchen428.github.io/travel-guide-studio-skill/downloads/travel-guide-studio.zip) · [SKILL.md](SKILL.md)

![我们设计的旅行手册桌面首页截图](docs/images/designed-desktop-home.jpg)

## 可以做什么

- 接收目的地、日期/天数、出发地、人数、预算和偏好，也可以复刻已有攻略 URL 或文档。
- 编排逐日时间轴，保留交通、餐饮、休息、强度、天气/预约/体力失效时的备选。
- 使用暖白、墨绿和陶土色的杂志式模板，输出手机与桌面均可读的页面。
- 提供真实地理地图、全程/逐日/备选路线、类别筛选、编号地点、地点详情、路段距离与耗时、全屏和定位入口。
- 提供准备清单、倒计时、搜索定位、来源等级说明、复制/拨号/地图外链、预算全部加项、主题保存、原生分享、离线下载和全程打印。

页面没有后台账号、跨设备同步、实时票务库存或预订付款能力。研究与行程编排由 Agent 完成；模板与生成器负责页面产出和本地交互。

## 案例与在线展示

### 杭州七日完整案例

[直接打开案例地图](https://chenchen428.github.io/travel-guide-studio-skill/hangzhou-guide.html#trip-map)

案例参考：[杭州国庆 7 日作战手册](https://nua2fynhvu1g.meoo.pub/#tab-trip)。设定为 2026-10-01 至 10-07、上海往返、3 人、7 天 6 晚，资料截至 **2026-09-29**。

| 保留的内容/功能 | 规模或说明 |
|---|---|
| 逐日时间轴 | 7 天，66 个时间段 |
| 地点和路线 | 159 处地点资料，81 个日路线站点 |
| 地图模式 | 全览 + 7 日 + 良渚/西溪/桂花 Plan B/千岛湖 4 组备选 |
| 地图类别 | 景点、寺庙、博物馆、餐饮、酒店、交通、演出、购物、公园 |
| 准备清单 | 5 项优先事项与 25 项预约事项，分别保存进度 |
| 预算 | 经济/舒适/品质 3 档、原稿全部 11 个加项、基线已含/重复计费提示 |
| 营业速查 | 28 处营业资料，保留最晚入场、闭馆与节假日说明 |
| 手机体验 | 375/390/430px 检查；底部六栏、横滑日期、手机地图与详情弹层 |

这是一份**历史案例**，展示页面和技能的能力，不能直接作为当前出行安排。天气是原稿预测；票价、营业和来源等级未在本次逐项重新查证。道路折线来自原稿预计算路网；山径、水面与缺少道路数据的段落明确标为直线口径，不表示实时路况。

<img src="docs/images/designed-mobile-home.jpg" alt="我们设计的手机首页" width="320"> <img src="docs/images/designed-mobile-itinerary.jpg" alt="我们设计的手机行程页" width="320">

### 苏州两天一晚草稿

[查看草稿页面](https://chenchen428.github.io/travel-guide-studio-skill/suzhou-draft.html) · [输入 JSON](examples/suzhou-draft.json)

用于展示“日期未定”输入的处理：日期为 `null`，候选地点与预算额度明确未核实；页面没有继承杭州事实。地图配置未提供，因此显示待补充，不把路线示意冒充完成的地图。这是数据合同和草稿输出案例，不是完整旅游建议。

## 在 Agent 中使用

适用于支持 `SKILL.md` 的 Agent。可将这个仓库作为一个技能目录，或下载技能 ZIP 后解压。

```bash
git clone https://github.com/chenchen428/travel-guide-studio-skill.git travel-guide-studio
```

如果使用 Codex，可将仓库放到 `~/.codex/skills/travel-guide-studio`，或将该目录内容复制到技能目录。无需安装 npm 包。

示例请求：

> 使用 $travel-guide-studio，将这份旅行攻略美化为移动端友好的页面。保留地图、路线、预算、准备事项和来源交互；给我生成的 HTML 和 review 页面。

> 使用 $travel-guide-studio，规划苏州两天一晚的轻松旅行，上海出发、3 人、日期未定。明确待确认事项，准备完整地图数据后再交付可验收页面。

[技能执行流程](SKILL.md) · [数据合同](references/data-contract.md) · [关联能力说明](references/capabilities.md)

## 直接生成页面

要求 Python 3.9+，生成器本身不依赖第三方库。

```bash
python3 scripts/render.py assets/example-trip.json travel-guide.html
```

修改 `assets/example-trip.json` 的结构为自己的旅行输入，再用同一命令生成。金额支持按每人、整套每晚、团队全程或每人每天计价；团队总额从分项相加，人均仅在显示时取整。

新目的地应重新核实事实、取得真实坐标与路线数据、配置自己的高德浏览器 JS Key，并适配主视觉。案例中继承的是参考页公开的浏览器配置；仓库不包含服务端 API Key 或安全密钥。不要把杭州坐标、历史规则或浏览器配置默认套用于其他城市。

```bash
python3 scripts/render.py examples/suzhou-draft.json suzhou-draft.html
```

打开页面即可阅读。高德底图在首次打开地图时联网加载；坐标与预计算路线已内嵌，断网仍能读资料。定位只在用户点击后通过浏览器权限获取。

## GitHub Pages 如何展示

展示页只呈现一个手机外壳和真实攻略效果，长篇说明留在中英文 README。GitHub Pages 从 **main 分支的 /docs** 发布：

- 首页：默认手机外壳中的可交互攻略，附源码与下载入口。
- `docs/hangzhou-guide.html`：杭州完整地图案例。
- `docs/suzhou-draft.html`：苏州日期未定草稿。
- `docs/skill/`：可通过 URL 读取的完整技能与配套资源。
- `docs/downloads/travel-guide-studio.zip`：仅包含技能文件的分发包。

直接读取在线技能入口：[SKILL.md](https://chenchen428.github.io/travel-guide-studio-skill/skill/SKILL.md)。相对引用的模板、脚本与合同同样可在线读取。

更新技能或案例后运行：

```bash
python3 scripts/build_pages.py
```

此命令重新生成两个案例，复制技能资源到 `docs/skill/` 并刷新下载 ZIP。提交并推送 `main` 后，GitHub Pages 自动重新部署；无需单独启动服务器或后端。

## 验收建议

在手机上打开 [杭州地图案例](https://chenchen428.github.io/travel-guide-studio-skill/hangzhou-guide.html#trip-map)：

1. 切换日期，再打开全屏地图查看全览、逐日与备选路线。
2. 拖动、缩放地图，切换类别，点击地点查看详情及导航入口。
3. 回到时间轴，检查备选与路线分支；搜索“九溪”并跳转对应时间段。
4. 勾选准备事项后刷新；调整预算人数、档位和加项，检查总额与重复计费提示。
5. 试用来源说明、名称复制、主题切换、保存与打印。

[详细验证记录](docs/verification.md)。定位会请求浏览器权限，分享目标由用户选择；测试不要求提交位置或发送给他人。

## 文件结构

```text
travel-guide-studio/
├── SKILL.md
├── agents/openai.yaml
├── assets/
│   ├── page-template.html
│   ├── example-trip.json
│   ├── route-map.js
│   └── route-map.css
├── references/
│   ├── capabilities.md
│   └── data-contract.md
├── scripts/
│   ├── render.py
│   └── build_pages.py
├── examples/suzhou-draft.json
├── docs/
│   ├── index.html
│   ├── hangzhou-guide.html
│   ├── suzhou-draft.html
│   ├── skill/
│   ├── downloads/
│   ├── images/
│   └── verification.md
└── README.md
```

## 来源说明

杭州案例内容、坐标与地图基础模块参考上面的公开攻略；版式、主视觉和技能数据合同在此项目中整理与适配。高德地图及社区资料归其相应来源，来源等级并不表示本次重新核实。原创湖山 SVG 是意象插画，不是实景照片。
