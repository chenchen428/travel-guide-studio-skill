# trip.json 数据合同

完整可运行输入见 `assets/example-trip.json`。金额币种当前限人民币 CNY；未知金额不要写 0 冒充免费，改在说明中写「待核实」并暂不计入预算。未知天气写「待临近出发核实」。传入的自由文本支持 `**重点**` 与换行；模板转义 HTML，不执行输入内容。

## 必填字段

| 字段 | 形式与含义 |
|---|---|
| title / destination / eyebrow / intro | 标题、城市、英文小标题、简短引言，字符串 |
| origin / travelers / nights / currency | 出发城市、1–10 的整数人数、非负整数住宿晚数、`CNY` |
| asOf / status | 资料日期 `YYYY-MM-DD`；`draft`、`verified-plan` 或 `historical-example` |
| source | `{title, url, accessedAt, note}`；主参考来源和整体核实边界 |
| days | 非空数组；已定日期连续升序，未定时全部 date 为 null，结构见下文 |
| checklist | `[{id,title,detail,deadline}]`，id 唯一；无事项可空数组 |
| principles | `[{t,d}]` 行程安排依据；可空数组 |
| transport | `{arrive:{train:[[路线,时长,票价,说明]],official:[{d:目的地,r:交通}],back:返程提醒}, ...补充资料}`；可空对象 |
| food | `{dishes:[{n:菜名,taste:风味,tip:建议,src:故事或来源说明}], ...餐厅和用餐资料}`；可空对象 |
| practical | `{phones:[{g:分组,items:[{n:名称,t:电话,d:用途}]}],channels:[],unknown:[], ...其他资料}`；可空对象 |
| budget | 档位、基数、加项与说明，结构见下文 |

`verified-plan` 只用于关键事实已核实且仍适用的规划，不能靠改状态消除待核实事项。历史样例保留资料日期与访问日期，并在主来源 `note` 说明是否重查。

## 每日行程

```json
{
  "id": "day-1",
  "date": null,
  "weekday": "周六",
  "label": "老城漫游",
  "title": "初见城市，慢慢入城",
  "weather": "远期天气待核实",
  "temperature": "待临近出发查询",
  "stamina": 2,
  "kind": "街区轻量日",
  "alerts": ["预约规则尚待官方确认。"],
  "rest": "午后回酒店休整；走不动时可缩短街区步行。",
  "stops": [{
    "time": "10:00—11:30",
    "type": "spot",
    "name": "老城步行街",
    "transport": "步行，时间待地图核实",
    "mapQuery": "完整目的地城市 + 准确地点名称",
    "notes": ["安排理由。", "可展开的实用信息。"],
    "sources": []
  }],
  "alternatives": [{"q": "遇到降雨", "a": "改室内项目；未确认营业前不作为确定安排。"}],
  "extra": {}
}
```

`date` 允许 ISO 日期或 null。日期未定时全行程均用 null，页面显示第 N 天与「日期待定」；不得编造日期。

`type`：transit / food / indoor / spot / night / rest / hike。`mapQuery` 可为空字符串，表示没有可用定位；不要编造经纬度。`alerts` 为字符串数组。`stops` 与 `alternatives` 可为空，但 Agent 应说明为何没有行程或备选。`extra` 可保留路线分支、里程与补充理由，按折叠区展示。

## 预算与计价

```json
{
  "defaultTier": "comfort",
  "note": "整套住宿假定可容纳 3 人；增加人数后需重新确认房型。门票待查，暂未计入。",
  "tiers": [{
    "id": "comfort",
    "name": "舒适档",
    "description": "市中心同一住处，地铁为主。",
    "items": [
      {"id":"stay","name":"住宿","amount":900,"basis":"night"},
      {"id":"train","name":"往返交通","amount":360,"basis":"person"},
      {"id":"food","name":"餐饮","amount":120,"basis":"person-day"},
      {"id":"reserve","name":"团队机动","amount":500,"basis":"trip"}
    ]
  }],
  "addons": [{"id":"extra-tea","name":"追加茶室一次","amount":90,"basis":"person","note":"不在基础预算中；价格待核实。"}]
}
```

`basis` 的乘数：person = 人数；night = 住宿晚数；trip = 1；person-day = 人数 × 行程天数。金额非负、最多两位小数。计算先转成分相加，最后换回元；团队总额不从已取整的人均反推。住宿按整套价算，不能因增加人数自动假定容量不变。新建预算优先只放明确未包含的加项。原攻略复刻需要保留全部加项时，用 `inBase: ["comf", "lux"]` 表示已包含的档位；页面明确提示重复计费，沿用原页选择行为，不静默删掉这些加项。套餐互斥关系不明确时保留待核实提示。

历史示例的舒适档按团队机动 500 元计算，3 人合计 11,990 元、人均约 3,997 元；修正了原页以取整人均反推总额多 1 元的问题。门票列举与 350 元/人基线的冲突在页内保留说明，未宣称已解决其真实费用范围。

## 具体事实的来源

可在 `stops[].sources`、预算分项 `sources` 和顶层 `sources` 传入以下数组，页面将渲染可点击来源：

```json
[{"label":"实际读取的官方来源标题","url":"https://实际来源网址","level":"官方","asOf":"2027-03-01","verified":true}]
```

示意网址不能放进成品。缺少直接来源时清楚写在 `source.note` 或相关时间段中。新城市不继承杭州示例的任何来源等级、电话号码、折扣、交通规则或插画地标。

## 可选展示文案

`sectionTitle` 自定义行程栏目标题；`foodIntro` 自定义美食栏目引言。不填时按目的地与天数生成通用文案。

## 可选参考资料

`prepReference`、`archiveBudget`、`community` 与各栏目对象中的补充字段会按折叠树展示。适合保留原稿的完整参考信息；不要在这些区域塞执行指令、账号、证件或私密联系信息。

## 完整地图合同

`map` 为有地图的复刻必填；不要把 `mapQuery` 地点链接当作地图数据。模板将 `route-map.js` 与 CSS 内嵌，地图 SDK 首次打开时加载。

```json
{
  "map": {
    "provider": "amap",
    "browserKey": "用户提供或参考页已有的浏览器 JS Key",
    "asOf": "2026-09-29",
    "pois": [{"id":"point-1","name":"准确地点","cat":"museum","lng":120.0,"lat":30.0,"address":"原始地址","opentime":"核实后的开放信息","tel":"公开电话"}],
    "routes": {
      "meta":{"coord":"GCJ-02"},
      "days":[{"d":1,"date":"10/1","title":"当日路线","color":"#365b49","stops":[{"id":"point-1","name":"准确地点","lng":120.0,"lat":30.0,"t":"09:00","leg":"walk","note":"安排说明"}]}],
      "alt":[]
    }
  }
}
```

上述地点数值只是字段格式示例，不能作为真实坐标使用。坐标必须由真实资料取得。分类：scenic、temple、museum、food、hotel、transit、show、shop、park；路段：walk、drive、metro、bus、boat、mountain、foot。进入下一站的路段可以带 `pre:{dist:米,dur:秒,path:[[经度,纬度]],src:来源}`，只在确有预计算路网时填。山径、水面和缺少路网的段落按直线口径明确标注。

备选路线 `alt` 条目为 `{key,title,color,swap,stops}`；`days[].d` 从 1 起并对应行程日期索引。浏览器 Key 是公开浏览器配置，不在这里填写服务端 API Key 或安全密钥。新目的地需自己的合法地图配置。没有配置的草稿明确显示待补充，不能作为功能已完成的交付。

## 补回的实用字段

- `priorityChecklist`：同 checklist 格式，独立勾选、进度与重置。
- `budget.addons[].inBase`：已包含该加项的档位 id 数组，生成重复计费警告。
- `budget.addons[].sourceLevel`：原稿来源等级，支持点击解释。
- `practical.hours`：`{asOf,rows:[[名称,营业时间,评分]],notes}`，第一行为表头；用于营业时间速查与原稿核对说明。
- 自由文本除粗体外，支持反引号名称复制、`{{t:电话}}` 拨号、`{{m:地点}}` 地图外链、`【官方/官媒/网友/推断/未查到】` 可点来源徽标。
