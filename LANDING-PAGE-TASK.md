# Sidecar 落地页开发任务

## 任务目标

为 Sidecar 创建一个简洁、高级、具有独立软件气质的产品落地页。

落地页不仅用于介绍产品，还要承担以下职责：

- 展示 Sidecar 的核心价值；
- 提供最新版下载入口；
- 展示版本号和更新日志；
- 引导用户查看 GitHub 源码；
- 为后续版本更新通知和 GitHub Release 做准备。

整体目标不是做一个普通的 SaaS 营销页面，而是做一个让用户觉得“这个产品被认真设计过”的独立工具官网。

## 核心视觉方向

### Warm Editorial / Paper Premium

整体采用浅色系，但避免普通的纯白 SaaS 风格。

视觉关键词：

- 温暖米白；
- 纸张质感；
- 大量留白；
- 编辑感排版；
- 墨绿色文字和按钮；
- 柔和的浅绿色、浅蓝灰和淡黄色背景光；
- 安静的科技感；
- 真实产品界面；
- 高级但不冷漠。

页面应该像一个认真打磨过的独立软件官网，而不是模板或 AI 自动生成的营销页。

## 色彩系统

```text
主背景：#F5F2EA
纯白区域：#FFFDF8
浅灰区域：#ECEAE3
主文字：#1E211D
次级文字：#73766F
边框：#D9D8CF
品牌深色：#202A22
柔和绿色：#A8B99B
淡黄色：#E7E5A8
浅蓝灰：#C8D5D7
```

使用规则：

- 不使用紫色大渐变；
- 不使用高饱和霓虹色；
- 不使用纯黑背景；
- 主按钮使用深墨绿色；
- 背景光使用低透明度的柔和颜色；
- 颜色数量保持克制，不要让页面变得花哨。

## 字体和排版

中文字体优先使用：

- Noto Sans SC；
- PingFang SC；
- Microsoft YaHei。

英文标签可以使用：

- IBM Plex Mono；
- DM Mono。

少量英文装饰标题可以使用：

- Instrument Serif；
- Newsreader。

字体使用原则：

- 中文正文保持清晰易读；
- 英文小标签使用等宽字体，体现工具感；
- 不要整页使用衬线字体；
- 高级感主要来自留白、比例、排版和颜色，而不是复杂字体。

## 页面结构

### 1. 顶部导航

左侧显示：

```text
✦ Sidecar
```

右侧显示：

```text
产品    更新日志    GitHub    下载最新版
```

导航要求：

- 高度适中；
- 简洁；
- 滚动后可以变成轻微半透明的固定导航；
- 不要使用复杂下拉菜单；
- 下载按钮保持明显但不过度突出。

### 2. Hero 首屏

推荐文案：

```text
LOCAL-FIRST PROMPT WORKSPACE

把真正有用的 Prompt，
留在手边。

Sidecar 帮你捕捉、整理和持续迭代
那些值得重复使用的 Prompt。
```

按钮：

```text
下载最新版
查看 GitHub
```

布局要求：

- 左侧放文案和按钮；
- 右侧放浏览器窗口 Mockup；
- 使用左右非对称布局；
- 保持大量留白；
- 产品 Mockup 可以略微超出右侧边界；
- 不要使用居中的“标题 + 三张卡片”模板。

产品 Mockup 内容：

- ChatGPT 对话页面；
- AI 回复旁边的星标按钮；
- Sidecar Side Panel；
- Prompt 列表；
- 文件夹、标签和版本信息；
- 使用真实的 Sidecar 产品概念，不要放虚构的统计图表。

Mockup 风格：

- 白色或米白色表面；
- 1px 淡灰边框；
- 轻微阴影；
- 不使用过度玻璃拟态；
- 不使用发光霓虹边框。

### 3. 核心能力

不要使用普通的功能卡片，改用三个产品动作：

```text
Capture
保存值得留下的 Prompt

Organize
让它们随时可以被找回

Evolve
让每次使用都变成下一版
```

每项能力旁边展示真实产品局部视觉：

- Capture：星标按钮和保存反馈；
- Organize：文件夹、标签和搜索；
- Evolve：版本历史和改进结果。

### 4. 产品使用流程

```text
01 在对话中发现
02 点击星标保存
03 在 Sidecar 中整理
04 创建更好的版本
```

建议使用横向时间线或大编号布局。

不要把四个步骤做成四个普通圆角卡片。

### 5. Local-first 区域

推荐文案：

```text
Your prompts stay close.

数据默认保存在浏览器本地。
不需要账号，也不需要把整个工作空间上传到服务器。
```

旁边展示：

```text
LOCAL-FIRST
IndexedDB

NO ACCOUNT
Ready to use

EXPORTABLE
Take your data with you
```

文案必须准确，不得夸大安全能力，不要使用“绝对安全”“军用级加密”等无法证明的表达。

### 6. 下载和版本区域

推荐文案：

```text
The latest version is ready.

Sidecar v0.1.0
2026.11.09
```

按钮：

```text
下载最新版
查看更新日志
```

该区域需要预留动态数据入口，后续从 `version.json` 读取：

- 当前版本号；
- 发布时间；
- 下载链接；
- 更新内容；
- GitHub Release 链接。

### 7. Footer

```text
Sidecar

A quiet place for your best prompts.

GitHub
Changelog
Installation
Privacy
Issues

© 2026 Sidecar
```

## 背景流动效果

浅色背景下不要做明显的彩色霓虹光球。

效果应该像“阳光在米白色纸面上缓慢移动”，而不是“网页里漂浮着几个渐变球”。

实现要求：

- 使用 Canvas 或 SVG；
- 使用 3～4 个低透明度的模糊光源；
- 光源颜色以浅绿色、浅蓝灰、淡黄色为主；
- 光源缓慢自动漂移；
- 鼠标移动时产生轻微跟随；
- 鼠标停止后继续缓慢恢复；
- 透明度控制在 0.08～0.16 左右；
- 不影响文字和产品 Mockup 的可读性；
- 只在 Hero 或少数重点区域使用；
- 移动端减弱或关闭；
- 支持 `prefers-reduced-motion: reduce`；
- 不得造成明显卡顿。

可以增加一层非常淡的纸张纹理，但不能让用户明显看到噪点。

## 动效规范

只保留以下几类动画：

1. 背景光源缓慢漂移；
2. 产品 Mockup 4～6px 的轻微鼠标视差；
3. 页面区块滚动进入时淡入并上移约 12px；
4. 按钮 hover 时上移 1～2px，边框或背景颜色轻微变化。

禁止：

- 逐字播放标题；
- 鼠标拖尾；
- 粒子爆炸；
- 大范围 3D 旋转；
- 滚动劫持；
- 过多弹窗；
- 连续跳动的元素；
- 每个区块都使用不同动画。

## 避免 AI 生成感

必须遵守以下规则：

- 不使用紫色渐变；
- 不使用机器人、大脑、发光球等 AI 常见插画；
- 不使用“AI 助力未来生产力”之类的抽象文案；
- 不虚构客户 Logo；
- 不虚构用户数量、增长数据或评价；
- 不使用十几个彩色功能标签；
- 不把所有内容做成圆角卡片；
- 不使用统一的三列模板化布局；
- 不使用过度玻璃拟态；
- 不使用高饱和霓虹色；
- 不添加无意义的复杂动画；
- 优先使用真实产品界面、真实功能名称和准确文案。

## 工程要求

建议将落地页放在独立的 `website/` 目录，不要破坏现有扩展项目：

```text
sidecar-mvp/
├── src/                 # Chrome Extension
├── public/              # Extension resources
├── website/             # Landing Page
│   ├── src/
│   ├── public/
│   ├── index.html
│   └── package.json
├── .github/workflows/
└── README.md
```

技术要求：

- React + Vite；
- CSS Variables；
- 原生 CSS 动画；
- Canvas 或 SVG 背景动效；
- 少量 SVG 图标；
- 不引入重型动画库；
- 不依赖外部图片作为核心视觉；
- 支持桌面端、平板和移动端；
- 添加 SEO title 和 description；
- 添加 favicon；
- 页面加载速度快；
- 版本和下载信息从 `version.json` 读取；
- 不影响 Chrome Extension 原有构建。

## 执行上下文

工作仓库：

```text
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp
```

任务文档：

```text
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\LANDING-PAGE-TASK.md
```

执行要求：

- 必须在上述 `sidecar-mvp` 目录中工作；
- 开始前先阅读本任务文档和现有 `README.md`；
- 先检查现有项目结构、`package.json`、Vite 配置和 Git 状态；
- 不要删除或重写现有 Chrome Extension 功能；
- 落地页代码放在独立的 `website/` 目录；
- 不要把落地页代码直接混入 `src/sidepanel/`；
- 不要修改现有扩展的视觉风格来代替落地页开发；
- 如果发现现有项目存在构建问题，记录问题并尽量修复，但不要扩大任务范围；
- 每完成一个主要阶段都要运行检查命令；
- 不要使用虚构的用户数据、评价、客户 Logo 或统计数字；
- 不要把 API Key、用户数据或本地数据库内容提交到仓库。

建议新增或修改的范围：

```text
website/                  # 落地页应用
website/src/              # 页面组件和样式
website/public/           # favicon、产品截图等静态资源
website/version.json      # 当前版本和下载信息
package.json              # 必要时增加 website 相关脚本
README.md                 # 必要时补充落地页开发说明
```

建议不要修改的范围：

```text
src/background/           # 除非确有必要，不要修改扩展后台逻辑
src/content/              # 不要因为落地页需求修改平台适配器
src/sidepanel/            # 不要把落地页组件放入扩展 Side Panel
src/db/                   # 不要修改数据库结构
```

本地验证命令：

```powershell
cd "C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp"
npm install
npm run build
npm run test
npm run lint
```

如果项目采用独立的 website package，请额外执行：

```powershell
cd "C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\website"
npm install
npm run build
```

## 交付物

完成后必须提供：

1. 修改和新增文件清单；
2. 本地预览方式；
3. website 构建命令；
4. Chrome Extension 原有构建结果；
5. 页面截图或录屏；
6. GitHub Pages 部署说明；
7. 当前版本信息从哪里读取；
8. 尚未完成的问题；
9. `build`、`test`、`lint` 的实际结果。

## 验收标准

- 用户在 5 秒内能理解 Sidecar 是什么；
- 第一屏能看到明确的下载入口；
- 页面整体为浅色米白风格；
- 页面具有高级感，但不像模板或 AI 自动生成；
- 背景动效自然、慢、低调；
- 产品 Mockup 能体现真实功能；
- 移动端布局正常；
- `prefers-reduced-motion` 生效；
- website 可以独立构建；
- 当前版本和下载信息可以从 `version.json` 加载；
- 输出本地预览截图或录屏；
- 最后说明如何部署到 GitHub Pages。

## 给 Kiro 的 Prompt

```text
你现在需要在 Sidecar 项目仓库中开发落地页。

工作仓库绝对路径：
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp

任务说明文档绝对路径：
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\LANDING-PAGE-TASK.md

请先进入上述仓库目录，阅读 LANDING-PAGE-TASK.md 和 README.md，检查现有 package.json、Vite 配置、项目结构以及 Git 状态，然后再开始开发。

本任务只负责创建产品落地页，不要把落地页做进 Chrome Extension 的 Side Panel，也不要删除或重写现有扩展功能。

落地页代码必须放在独立的 website/ 目录中。不要直接修改 src/sidepanel/、src/content/、src/background/ 或 src/db/ 来实现落地页。

请为 Sidecar 创建一个独立的高级产品落地页，目录为 website/。

这不是普通后台页面，而是一个面向真实用户的产品官网。视觉目标是：

“安静、克制、高级、有独立工具气质，不要看起来像 AI 自动生成的网站。”

## 视觉方向

采用 Warm Editorial / Paper Premium 风格。

整体使用浅色米白背景，不使用深色主背景，也不要做成普通白色 SaaS 模板。

视觉关键词：

- 温暖米白；
- 纸张质感；
- 大量留白；
- 编辑感排版；
- 墨绿色文字和按钮；
- 柔和的浅绿色、浅蓝灰和淡黄色背景光；
- 安静的科技感；
- 真实产品界面；
- 高级但不冷漠。

配色：

- 主背景 #F5F2EA；
- 纯白区域 #FFFDF8；
- 浅灰区域 #ECEAE3；
- 主文字 #1E211D；
- 次级文字 #73766F；
- 边框 #D9D8CF；
- 品牌深色 #202A22；
- 柔和绿色 #A8B99B；
- 淡黄色 #E7E5A8；
- 浅蓝灰 #C8D5D7。

避免紫色大渐变、高饱和霓虹色、纯黑背景、机器人插画、AI 大脑、发光球体和过度玻璃拟态。

## 页面结构

1. 顶部导航
   - Sidecar 品牌；
   - 产品；
   - 更新日志；
   - GitHub；
   - 下载最新版。

2. Hero 首屏
   - 小标题：LOCAL-FIRST PROMPT WORKSPACE；
   - 主标题：把真正有用的 Prompt，留在手边；
   - 产品描述；
   - 下载最新版按钮；
   - 查看 GitHub 按钮；
   - 右侧展示真实的浏览器窗口 Mockup；
   - Mockup 展示 ChatGPT 对话、星标按钮和 Sidecar Side Panel。

3. 核心能力
   - Capture：保存值得留下的 Prompt；
   - Organize：让它们随时可以被找回；
   - Evolve：让每次使用都变成下一版。
   不要使用普通三列圆角卡片，优先展示真实产品局部视觉。

4. 产品流程
   - 01 在对话中发现；
   - 02 点击星标保存；
   - 03 在 Sidecar 中整理；
   - 04 创建更好的版本。

5. Local-first 区域
   - 数据默认保存在浏览器本地；
   - 不需要账号；
   - 支持导出；
   - 文案必须准确，不得夸大安全能力。

6. 下载和版本区域
   - 当前版本号；
   - 发布时间；
   - 最近更新内容；
   - 下载最新版按钮；
   - GitHub Release 链接；
   - 更新日志链接。

7. Footer
   - GitHub；
   - 更新日志；
   - 安装说明；
   - 隐私说明；
   - Issues。

## 背景动效

Hero 区域实现“纸面上的柔和光影”效果：

- 使用 Canvas 或 SVG；
- 3～4 个低透明度模糊光源；
- 浅绿色、浅蓝灰、淡黄色为主；
- 光源缓慢自动漂移；
- 鼠标移动时只产生轻微跟随；
- 禁止明显的霓虹光球；
- 禁止粒子爆炸；
- 禁止抢过文案和产品 Mockup；
- 移动端减弱或关闭；
- 支持 prefers-reduced-motion；
- 确保页面流畅，不造成明显卡顿。

效果应该像“阳光在米白色纸面上缓慢移动”，而不是“网页中漂浮着渐变球”。

## 交互细节

- 产品 Mockup 只做 4～6px 的轻微鼠标视差；
- 页面区块滚动进入时淡入并轻微上移；
- 按钮 hover 时只做细微颜色变化和 1～2px 上移；
- 不使用逐字动画；
- 不使用鼠标拖尾；
- 不使用滚动劫持；
- 不使用过多弹窗；
- 不让每个区块都拥有不同动画。

## 工程要求

- 落地页放在独立 website/ 目录；
- 使用 React + Vite；
- 使用 CSS Variables；
- 使用原生 CSS 动画和 Canvas/SVG；
- 不引入重型动画库；
- 不依赖外部图片作为核心视觉；
- 支持桌面端、平板和移动端；
- 添加 SEO title、description 和 favicon；
- 页面版本和下载信息从 version.json 读取；
- 不破坏现有 Chrome Extension 构建；
- 增加独立的 website build 命令。

## 执行和交付要求

- 开始前先检查现有项目结构，不要假设文件一定存在；
- 如果需要新增依赖，说明原因并保持依赖数量克制；
- 不要提交 API Key、用户数据或本地数据库内容；
- 不要使用虚构用户数据、客户 Logo、评价或统计数字；
- 不要为了实现落地页而修改扩展业务逻辑；
- 完成后运行扩展原有的 build、test、lint；
- 运行 website 的独立 build；
- 输出新增和修改文件清单；
- 输出本地预览方式；
- 输出页面截图或录屏；
- 输出 GitHub Pages 部署说明；
- 输出所有命令的实际执行结果；
- 如果构建被 Node.js/npm 环境阻塞，必须明确报告，不要声称构建成功。

## 验收标准

- 用户在 5 秒内能理解 Sidecar 是什么；
- 第一屏能看到明确的下载入口；
- 页面是浅色米白风格；
- 页面高级、克制，不像模板或 AI 生成页面；
- 背景动效自然、慢、低调；
- 产品 Mockup 体现真实功能；
- 移动端布局正常；
- prefers-reduced-motion 生效；
- website 可以独立构建；
- 当前版本和下载信息可以从 version.json 加载；
- 输出本地预览截图或录屏；
- 最后说明如何部署到 GitHub Pages。
```
