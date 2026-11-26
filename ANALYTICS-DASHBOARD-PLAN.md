# Riddle Notes 埋点看板方案（草案）

> 状态：规划草案，未实施。来源：项目交接文档 + 本次会话中的决策、官方文档核实，以及对 `website/` 的代码阅读。
> 已读代码：仅 `website/`（`package.json`、`vite.config.ts`、`index.html`、`App.tsx`、`main.tsx`、`Header.tsx`、`Download.tsx`、`Footer.tsx`、`version.json`、`README.md`、`deploy-website.yml`，以及对 `components/*.tsx` 的隐私文案搜索）。
> 扩展侧（manifest、CSP、`service-worker.ts`）仍未读，相关内容仍为「未验证」。
> 本文不提交、不推送。

## 1. 已确认的决策

| 项 | 决策 |
|---|---|
| 埋点范围 | 安装与留存、落地页访问与下载点击、用户使用情况（三类都做） |
| 隐私承诺 | 修改承诺并告知用户 |
| 扩展侧上报 | **默认开启**（注意：这和我最初建议的「默认关闭、用户同意后才上报」不同，决定权在你） |
| 统计工具 | **Umami Cloud Hobby**（无 Cookie；自托管同样免费，MIT 协议） |
| 下载统计 | 改用 GitHub Release 下载，用 Release 计数作为主口径 |
| 看板位置 | 落地页上的一个隐藏路由，前期不放入口，数据好看了再公开（你的想法，见第 5 节） |
| 看板内容 | 直接用 Umami 自带看板，通过 Share URL + iframe 嵌入，不另外自建 |

## 2. 为什么选 Umami Cloud Hobby

对比对象：GoatCounter、Plausible。

- **Umami Cloud Hobby**：$0/月，每月 10 万事件，1 个站点，数据保留 6 个月。Hobby 档就有自定义事件、用户留存报表、漏斗和实时数据。**没有 API 访问**（API 从 Pro $20/月起），所以不能自己拉数据，只能用自带看板。符合「轻量化 + 简洁」。
- **GoatCounter**：免费、脚本很小，但偏页面浏览统计。安装和留存要靠自己约定虚拟路径，看板能力比 Umami 弱。它的批量接口需要 API Key，不能放进扩展。
- **Plausible**：官网定价页抓取失败（404），价格和事件文档**未核实**，所以没有纳入推荐。

## 3. 已核实的上报接口（来自 Umami 官方文档）

- 单条：`POST https://gateway.umami.is/api/send`（Umami Cloud）。批量：`POST /api/batch`，请求体是 JSON 数组。
- 两个接口都**不需要鉴权令牌**，扩展里不用放密钥。
- 请求必须带有效的 `User-Agent`，否则请求不会被记录。
- 请求体格式：`{ "type": "event", "payload": { hostname, url, website, name, data?, id?, ... } }`。
- 匿名 ID：在 payload 里加 `id` 字段，上限 50 字符。随机生成的安装 ID 满足要求。
- 会话关联：Umami 不用 Cookie，会话由 IP、User-Agent 和站点 ID 区分。设置 `id` 后，同一 ID 下的多个会话会关联显示。
- 计费口径：每个页面浏览算 1 个事件。事件的 `data` 里每保存一个属性，也各算 1 个事件。

## 4. 事件设计

原则：不带属性、不带内容，只上报事件名和计数。

**落地页（website/）**
- 页面浏览：用 Umami 统计脚本。
- `download_click`：点击下载按钮。用来和 Release 计数对照，口径不一致时以 Release 计数为准。
- 具体写法（给 `<a>` 加 data-umami-event 属性，还是调用 `umami.track`）以 Umami 官方文档为准，本次会话未核实。

**扩展（service worker 里发）**
- `install`：`runtime.onInstalled` 中，reason 为 install 时上报。
- `daily_active`：每天心跳一次，用来估算活跃和留存。
- `save_prompt`、`manual_note_create` 等：关键动作计数。入口可放在 `service-worker.ts` 的 `SAVE_PROMPT` 等消息处理处（具体位置未验证）。
- 不上报任何笔记内容、标题、链接。
- **不上报任何保险箱相关行为**，要在代码层面明确排除。保险箱的威胁模型就是数据不离开本机。

**站点划分**
- Hobby 只有 1 个站点，落地页和扩展共用一个站点 ID，用 `url` 或事件名区分来源。

## 5. 看板位置：落地页上的隐藏路由

**你的想法**：落地页加一个单独的路由放看板链接，前期其他用户看不到，数据好了再放出来。

**做法**：`/stats` 页里用 iframe 嵌入 Umami 的 Share URL。这条路不需要 API，所以 Hobby 没有 API 也不影响。官方有「Embed analytics in your app」指南，支持这种做法。

**路由方案（均为推断，没试构建）**
1. **多页入口 `stats.html`（倾向）**：在 Vite 里加第二个入口，地址是 `/riddle-notes/stats.html`。不用装依赖，不依赖 404 回退，不放导航就等于不显眼。
2. **Hash 路由 `#/stats`**：不需要新依赖，但现有 `#top`、`#notebook`、`#install` 这些锚点要和它区分开，`App.tsx` 里要加判断。
3. **装 react-router，再加 `404.html` 回退**：改动最大，和「轻量化」不太搭。

**「前期不可见」只是不显眼，不是保密**
- 仓库是公开的（github.com/yanmingzhang2000/riddle-notes）。路由代码和 Share URL 一提交就能被任何人看到。
- Umami 文档写明 Share URL 永久有效，除非删除。泄露后只能删掉重建。
- 如果前期要真正不让别人看到，可以不把含 Share URL 的页面提交和部署，数据好了再上线。
- 以后想收紧，可以只公开部分视图（Share URL 可以选 流量 / 行为 / 增长 三类视图）。
- 推断：Hobby 只有 1 个站点，落地页和扩展的数据在同一个站点里，Share URL 只能按视图类别开放，不能按事件名过滤。公开 /stats 时，安装和留存数据可能一并可见，需要在 Umami 里确认。

**未验证**
- Umami Cloud 的 `/share/...` 页面能不能被 iframe 嵌入。文档说嵌入要在 Umami 实例上设置 `ALLOWED_FRAME_URLS`，而且是构建时变量，Cloud 上改不了。我探了 `cloud.umami.is` 首页的响应头，`frame-ancestors *`（允许任意站点嵌入）和 `x-frame-options: SAMEORIGIN`（只允许同源）同时存在，互相矛盾；只测了首页，没测真正的 `/share/...` 页面。2026-11-26 补测：用占位路径 `/share/placeholder/placeholder` 请求，返回 307 重定向到 `/`（`x-matched-path` 为 `/share/[...slug]`，说明路由存在，但无效的 share ID 被直接跳回首页）。它的响应头和首页一致，都同时含 `frame-ancestors *` 和 `x-frame-options: SAMEORIGIN`。这只是占位路径的响应，不是真实 Share 页面的响应头。按规范推断，浏览器在 CSP 带 `frame-ancestors` 时会忽略 X-Frame-Options，理论上可以嵌入，但没有在浏览器里验证。状态：**未验证，待真实 Share URL 实测**（先用 `curl -I` 查真实 Share URL 的响应头，再用浏览器 DevTools 看有没有 `Refused to display ... in a frame` 报错）。
- Hobby 档能不能创建 Share URL。定价页没把它列为付费功能，但也没明说。
- 最可靠的验证办法：你在 Umami Cloud 里建好 Share URL，我放一个最小的 iframe 页面，用浏览器实际打开看。
- 如果 iframe 不可行，退路是 /stats 页只放一个跳转到 Share URL 的链接，或者升级到 Pro 后用 API 自建看板。这两条都没评估过。

## 6. website/ 代码现状（已读代码确认）

- **没有路由方案。** `package.json` 里只有 react、react-dom、lucide-react。`main.tsx` 直接渲染 `<App />`，`App.tsx` 是单页，依次是 Hero、Features、LocalFirst、Download。
- **现有导航全是页内锚点。** `Header.tsx` 用 `#top`、`#notebook`、`#install`。
- **GitHub Pages 上直接访问 `/stats` 大概率会 404。** `vite.config.ts` 的 base 是 `/riddle-notes/`，`public/` 里没有 `404.html`。没实际访问线上地址验证。
- **页面里目前没有任何统计或网络请求代码。** 对 `website/src` 搜 `fetch(`、`localStorage`、`<script`、`analytics` 等，无匹配。`index.html` 只有 `main.tsx` 一个脚本，也没有 CSP meta。GitHub Pages 自己的响应头没测。
- **下载是静态直链。** `version.json` 的 `extensionDownloadPath` 是 `./downloads/riddle-notes-extension.zip`，`Download.tsx` 第 24 行用 `<a href=... download>`。要改成 Release 链接，需要改 `version.json` 这个值，并给这个 `<a>` 加点击事件。跨域链接上 `download` 属性可能被浏览器忽略，需实测。
- **`sourceDownloadUrl` 指向 `archive/refs/heads/main.zip`。** 这类下载 Release 计数统计不到，要决定统不统计。
- **部署工作流仍是单个 job，没拆。** 构建、上传、部署都在 `deploy` 里。之前失败的原因我仍然没看到日志，不能确认是竞态。

**隐私文案要改的位置**（只搜了 `components/*.tsx`，其他文件没搜）
- `LocalFirst.tsx` 第 10 行：「Riddle Notes 不要求账号，收藏数据默认保存在当前浏览器。」
- `Hero.tsx` 第 93 行：「开发版 · 收藏数据只存在本地 · 需手动安装」
- `Hero.tsx` 第 82 行：「…收进你的本地手札」。这句只讲收藏存在哪，上报功能上线后仍然成立，一般不用改。
- 第 10 行和第 93 行说的是收藏数据存放位置，上报匿名计数后这点仍然成立。要补的是「会上报哪些匿名计数、可以怎么关闭」。
- `Footer.tsx` 目前没有隐私说明入口，可以在那里加一个。
- 还没搜的地方：`index.html` 的 meta 描述、`Features.tsx` 的文案、根目录 `PRODUCT-POSITIONING.md`、扩展内的文案。

## 7. 阶段计划

### 阶段 0：前置问题
- 落地页部署失败（run 45766124786），线上还是 11-18 的旧版。需要你在 Actions 页点 Re-run failed jobs，或把工作流拆成 build + deploy（`needs: build`）。我没动工作流。
- 推一个 `v*` 标签来触发 `release.yml`。目前远端没有任何 `v*` 标签。
- 在 Umami Cloud 注册并创建站点，拿到站点 ID。
- 在 Umami 里确认 Hobby 能不能创建 Share URL，以及 `/share/...` 页面能不能被 iframe 嵌入（见第 5 节）。

### 阶段 1：落地页埋点和下载统计
- 在 `website/index.html` 接入 Umami 脚本（脚本地址和属性以 Umami 后台给出的为准，未核实）。`/stats` 页本身是否要排除统计，待定。
- `version.json` 的 `extensionDownloadPath` 改指向 GitHub Release 的 zip，`Download.tsx` 的下载按钮加 `download_click` 事件。
- 决定 `sourceDownloadUrl`（main.zip）要不要统计。
- 注意：改 `website/` 后推送 main 会触发部署，推送前要先提醒你。

### 阶段 2：看板路由（`/stats`）
- 先按第 5 节验证 iframe 能否嵌入，再选路由方案（倾向 `stats.html` 多页入口）。
- 前期不加导航入口。数据好了再加到 `Header.tsx` 或 `Footer.tsx`。
- 提交前确认 Share URL 要不要进仓库（见第 5 节「不是保密」）。

### 阶段 3：承诺与文案修改（先于任何扩展上报）
- 修改第 6 节列出的落地页文案，说明会上报哪些匿名聚合指标，以及怎么关闭。
- 同步更新 `PRODUCT-POSITIONING.md`。
- 扩展侧默认开启，所以必须做到：
  1. 首次运行有明确告知。
  2. 设置里有关闭开关。
  3. 保险箱相关行为在代码层面排除。
- 隐私说明要写明：随机安装 ID；Umami 服务端会收到请求的 IP 和 User-Agent，用来区分会话。

### 阶段 4：扩展侧上报
- manifest 新增统计域名的 host 权限（现状：只有 storage、activeTab、sidePanel、contextMenus，没有上报权限）。
- 在 service worker 里发请求，需确认与 MV3 默认 CSP 兼容（未验证）。
- 安装与留存：安装事件 + 每日心跳 + 随机安装 ID。
- 使用情况：只上报事件计数。

### 阶段 5：看板上线
- 直接用 Umami 自带看板。
- 核心指标：访问量、下载量（Release 计数）、安装数、7 日和 30 日留存、收藏次数。
- 数据够好之后，再决定要不要把 `/stats` 入口放出来。

## 8. 风险与未验证项

**未验证**
1. `User-Agent` 能否从 MV3 service worker 的 `fetch` 中正常发出。浏览器通常不允许脚本改这个头，但 service worker 默认会带 Chrome 自己的 UA，大概率够用。没有实测，需要在真实扩展里发一次请求确认。
2. Umami 的留存报表是否按 `id` 计算。文档只说 `id` 用来关联会话，没写留存报表用什么口径。7 日和 30 日留存能否直接用，要上线后看数据才知道。
3. Hobby 每月 10 万事件够撑多少用户。我没有测算。如果每天心跳一次，再加上收藏等事件计数，上线前需要估一下。
4. 手动记录的事件属性会按额外事件计费，所以事件尽量不带属性。
5. 价格、限制和合规细节来自 Umami 官网定价页和官方文档，上线前再核对一次。
6. Umami Cloud 的 Share URL 页面能否被 iframe 嵌入；Hobby 能否创建 Share URL（见第 5 节）。
7. GitHub Pages 的响应头，以及 `/stats` 直接访问是否 404，都没实测。
8. 部署失败的真实原因（是否为同一 job 内上传和部署的竞态）没看到日志，只是推断。
9. 涉及扩展侧代码的改动点（manifest、CSP、`service-worker.ts`）都还没有读过代码，需要在实施前核实。

**已知风险**
- 扩展 manifest 版本号现在是 1.0.0，新旧包一样，已装用户收不到更新提示。`update-manifest.json` 内容已过期，也不是合法 JSON。所以带上报功能的新版本，要先修复更新机制并升版本号。否则老用户既收不到新版本，也看不到新的隐私说明。
- 已经装过旧版的用户不会出现在安装统计里，历史数据没有基线。
- 没有应用商店，安装和留存只能靠扩展自己上报。
- Hobby 数据只保留 6 个月，且没有 API，不能导出到自己的系统做长期留存。
- 保险箱在真实 Side Panel 里没有验证过。它不属于埋点范围，但上报功能上线前最好一并确认。
- 全量测试里有 64 个既有失败，改动后需要区分哪些是新引入的。
- 落地页在 900px 宽度有一处横向溢出，改动前就有，未修。

## 9. 待办与确认项

- [ ] 修复落地页部署（阶段 0）。
- [ ] 注册 Umami Cloud，创建站点，拿到站点 ID。
- [ ] 在 Umami 里建 Share URL，并用最小 iframe 页面实测能否嵌入。
- [ ] 选定 `/stats` 的路由方案（倾向 `stats.html`）。
- [ ] 决定 Share URL 是否进入公开仓库，以及前期是否部署 `/stats`。
- [ ] 推 `v*` 标签，确认 Release 下载可用。
- [ ] 决定 `sourceDownloadUrl`（main.zip）要不要统计。
- [ ] 确认首次运行告知的形式，以及设置里关闭开关的位置。
- [ ] 估算事件额度。
- [ ] 实施前先读扩展侧代码，核实各改动点。
