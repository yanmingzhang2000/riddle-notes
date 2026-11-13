# Riddle Notes 落地页前端开发指南

## 1. 产品定位

产品名称：

```text
Riddle Notes
```

产品副标题：

```text
Your private collection of useful prompts.
```

中文定位：

```text
你的 AI Prompt 私人收藏册。
```

Riddle Notes 是一个面向 ChatGPT Web 的本地 Prompt 收藏工具。

用户可以在 ChatGPT 回复旁点击星标，保存当前 Prompt、AI 回复和来源，然后在浏览器侧边栏中搜索、整理和管理。

当前产品是早期开发版，暂时只支持 ChatGPT Web，需要通过 Chrome 开发者模式手动加载。

落地页的任务不是把产品包装成一个庞大的 AI 平台，而是让用户快速理解：

1. Riddle Notes 是什么；
2. 它现在能做什么；
3. 用户为什么会想收藏 Prompt；
4. 如何获取和安装；
5. 数据保存在哪里。

## 2. 核心创意

视觉上融合两个元素：

### 活点地图感

表现为：

- 足迹；
- 路径；
- 连线；
- 位置标记；
- 漫游；
- 显现；
- 一张不断扩展的私人地图。

### 日记本感

表现为：

- 私人收藏；
- 墨迹；
- 手札；
- 页码；
- 纸张；
- 注释；
- 被保存下来的片段。

最终视觉不要做成直接复制电影道具的页面，而要做成一张“属于用户自己的 Prompt 地图”和一本“会持续积累的私人手札”。

## 3. 视觉方向

### 关键词

```text
Private magical notebook
Living map
Warm editorial
Quiet mystery
Ink and parchment
```

中文关键词：

```text
私密
神秘
纸张
墨迹
足迹
路径
收藏
```

整体风格应当高级、克制、有故事感，但不能像儿童魔法主题网站，也不能像普通 AI SaaS 官网。

## 4. 色彩系统

使用浅色纸张背景作为主基调。

```text
羊皮纸背景：#F4EFE3
浅纸张：#FBF8F0
旧纸灰：#E8E0D1
墨黑：#24241F
深棕：#463A2F
旧金色：#B18A45
鼠尾草绿：#899B83
地图蓝灰：#8799A0
暗红印章：#8A5B4B
```

使用规则：

- 主背景使用温暖米白和羊皮纸色；
- 主文字使用墨黑或深棕，不使用纯黑；
- 金色只用于页码、标记、细线和强调，不要大面积使用；
- 绿色和蓝灰用于地图路径、地点标记和辅助视觉；
- 避免紫色霓虹、蓝紫渐变和大面积玻璃拟态；
- 避免过度使用金色，否则会变成廉价魔法主题。

## 5. 纹理和材质

页面需要有轻微纸张感，但不能影响阅读。

建议：

- 使用非常低透明度的 SVG noise；
- 使用淡淡的纸张颗粒；
- 使用不规则但极轻的纸张边缘阴影；
- 卡片边框可以像纸页边缘，而不是厚重的 UI 边框；
- 产品 Mockup 可以使用“纸张卡片 + 墨色面板”的组合。

不要：

- 使用明显的旧纸污渍；
- 使用过度复古滤镜；
- 使用真实羊皮纸图片作为页面背景；
- 使用过多阴影和仿古装饰。

## 6. 字体方向

中文正文：

- Noto Sans SC；
- PingFang SC；
- Microsoft YaHei。

英文品牌名可以使用具有书籍感的衬线字体：

- Cormorant Garamond；
- Instrument Serif；
- Newsreader。

功能标签和页码可以使用等宽字体：

- IBM Plex Mono；
- DM Mono。

使用原则：

- `Riddle Notes` 可以有书名或手札标题的感觉；
- 中文正文必须清晰易读；
- 英文标签不要太多；
- 不要整页都使用复古衬线字体；
- 不要使用手写字体作为正文。

## 7. 页面整体结构

落地页控制在五个主要区域：

```text
1. Hero：产品是什么
2. Prompt Map：收藏内容如何被找回
3. 三个核心功能：收藏、整理、版本
4. Local-first：数据在哪里
5. 安装和下载：如何开始使用
```

不要再做过多产品流程和营销区块。

## 8. Hero 首屏

### 标签

```text
PROMPT NOTES · CHATGPT WEB
```

或者中文：

```text
面向 ChatGPT 的 Prompt 收藏工具
```

### 主标题

```text
Riddle Notes
```

### 副标题

```text
Your private collection of useful prompts.
```

### 中文说明

```text
在 ChatGPT 回复旁点击星标，
把值得再次使用的 Prompt 保存下来。
```

### 补充说明

```text
支持 ChatGPT Web · 本地存储 · 开发版
```

### 按钮

```text
获取源码
查看安装步骤
```

不要使用：

```text
获取 v0.1.0
下载最新版
立即开始改变工作方式
```

因为当前下载的是源码 ZIP，还不是正式安装包。

### Hero 视觉

Hero 右侧展示一张“Prompt 地图手札”：

- 左边或底层是一张淡淡的地图；
- 地图上有 3～5 个 Prompt 足迹节点；
- 节点之间有细线连接；
- 右侧叠放一本打开的笔记页；
- 笔记页中展示 Prompt 标题、来源和标签；
- 其中一个节点有星标或金色墨点；
- 地图和笔记页之间形成“发现 → 保存”的关系。

不要直接复制电影中的活点地图，也不要使用原作纹章、字体、角色、台词或道具截图。

## 9. Prompt Map 区域

这是页面的核心特色区域。

标签：

```text
YOUR PROMPT MAP
```

标题：

```text
每一次收藏，都会留下一个位置。
```

说明：

```text
把散落在对话里的 Prompt，
整理成一张可以再次走回去的地图。
```

视觉表现：

- 使用一张不规则的地图区域；
- 显示“写作”“研究”“开发”“工作”等几个地点；
- 每个地点对应一个 Prompt；
- 路径线缓慢绘制；
- 鼠标移动时地图产生轻微视差；
- 点击节点可以高亮对应的 Prompt 卡片；
- 如果不实现真实交互，也要保证它只是视觉示意，不要伪装成真实数据。

## 10. 核心功能区

标签：

```text
THE NOTEBOOK
```

标题：

```text
收藏、整理、继续使用。
```

副标题：

```text
Riddle Notes 目前只做三件事。
```

### 收藏

```text
在 ChatGPT 回复旁点击星标，
保存当前 Prompt、回复和来源。
```

### 整理

```text
使用文件夹、标签和搜索，
找到已经保存的内容。
```

### 版本

```text
保留修改记录，
方便复制、比较和继续调整。
```

避免以下表达：

- 让每一次 AI 交互都成为下一次更好的起点；
- 让 Prompt 不断进化；
- 秒级定位历史对话；
- 重新定义你的 AI 工作流；
- 提升十倍生产力。

## 11. 使用流程

流程保持非常短，只展示三步：

```text
01 看到值得保存的回复
02 点击星标
03 在 Riddle Notes 中查看和整理
```

说明文字：

```text
不需要复制粘贴，也不需要注册账号。
```

不要做成四张大卡片，也不要写长段落。

## 12. Local-first 区域

标签：

```text
LOCAL NOTES
```

标题：

```text
你的收藏，保存在你的浏览器里。
```

说明：

```text
Riddle Notes 不要求账号。
收藏数据默认保存在当前浏览器，并支持 JSON 导出。
清除浏览器数据前，请先备份。
```

不要使用“绝对安全”“完全不会上传”等无法覆盖未来功能的表述。

## 13. 安装和下载区域

标签：

```text
DEVELOPMENT BUILD
```

标题：

```text
带走这本手札。
```

说明：

```text
当前版本还没有正式安装包。
下载源码并完成构建后，可以通过 Chrome 开发者模式加载。
```

按钮：

```text
下载源码
查看安装步骤
```

安装步骤：

```text
1. 下载源码并解压
2. 在项目目录运行 npm install 和 npm run build
3. 打开 chrome://extensions，开启开发者模式
4. 点击“加载已解压的扩展程序”，选择 dist 文件夹
```

版本信息：

```text
当前版本 v0.1.0 · 支持 ChatGPT Web
```

当前版本包含：

- ChatGPT Web 对话收藏；
- 文件夹、标签和搜索；
- Prompt 版本记录；
- JSON 数据导出。

## 14. Footer

```text
Riddle Notes

Your private collection of useful prompts.

GitHub
更新记录
安装说明
Issues

© 2026 Riddle Notes
```

不要使用：

```text
Made with ❤️ for the AI community
```

## 15. 动效设计

### 地图路径动画

- 地图路径使用 SVG path；
- 页面进入时路径从起点缓慢绘制；
- 节点依次出现；
- 动画时长 1.2～2 秒；
- 不要让路径无限循环快速移动；
- 路径动画只播放一次，或者极慢地循环。

### 鼠标跟随

- 鼠标移动时，地图底图最多产生 4～8px 位移；
- 笔记页产生反方向 2～4px 位移；
- 使用缓动，不要直接跟随鼠标坐标；
- 鼠标停止后慢慢回到原位；
- 只在桌面端启用。

### 墨迹显现

- 标题或 Prompt 卡片可以使用轻微 opacity + translateY 动画；
- 像文字从纸面上显现出来；
- 不要使用打字机逐字动画；
- 不要使用闪烁、发光或文字变形。

### 页面滚动

- 区块进入时淡入并上移 12px；
- 地图节点可以按照顺序出现；
- 动画时长 500～800ms；
- 不使用滚动劫持；
- 不使用夸张的 3D 翻转。

### Reduced motion

必须支持：

```css
@media (prefers-reduced-motion: reduce) {
  /* 关闭路径、视差和自动漂移动画 */
}
```

## 16. 响应式要求

### 桌面端

- Hero 左文案、右地图手札；
- 地图节点和笔记页完整展示；
- 页面最大宽度建议 1120～1240px；
- 保持较大留白。

### 平板端

- Hero 改为上下排列；
- 先标题和按钮，再展示产品视觉；
- 地图元素减少到 2～3 个节点；
- 不要让 Mockup 遮挡主标题。

### 移动端

- 导航变成抽屉菜单；
- 背景动画减弱或关闭；
- 地图和笔记页改为纵向叠放；
- CTA 按钮宽度适应屏幕；
- 安装步骤保持清晰可读；
- 不要在移动端显示复杂地图路径。

## 17. 工程结构

建议落地页独立放在：

```text
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\website
```

建议组件：

```text
website/src/
├── App.tsx
├── index.css
├── components/
│   ├── Header.tsx
│   ├── Hero.tsx
│   ├── PromptMap.tsx
│   ├── Features.tsx
│   ├── Flow.tsx
│   ├── LocalNotes.tsx
│   ├── Install.tsx
│   └── Footer.tsx
└── data/
    └── version.json
```

要求：

- 不修改 Chrome Extension 的核心代码；
- 不把落地页组件放到 `src/sidepanel`；
- 版本、下载地址和更新记录从 `version.json` 读取；
- GitHub 地址必须使用真实仓库地址；
- 不提交 API Key 或用户数据；
- 页面必须支持 GitHub Pages 的 `/sidecar/` 子路径；
- 资源路径不能写死为根路径 `/`；
- 确保 favicon、OG 图片和静态资源真实存在。

## 18. 验收标准

- 首屏能快速理解 Riddle Notes 是什么；
- 主标题使用 `Riddle Notes`；
- 副标题使用 `Your private collection of useful prompts.`；
- 页面同时体现地图路径和日记手札两个元素；
- 视觉是浅色、纸张、墨迹和低调神秘感；
- 不直接复制任何 Harry Potter 角色、纹章、字体、台词或道具；
- 文案简洁，不夸大当前功能；
- 明确说明当前只支持 ChatGPT Web；
- 明确说明当前需要手动安装；
- 下载按钮指向真实源码或 Release；
- 移动端布局正常；
- `prefers-reduced-motion` 生效；
- website 可以独立构建；
- GitHub Pages 子路径访问正常；
- 页面没有空链接、占位链接或错误年份。

## 19. 给 Kiro 的开发 Prompt

```text
请在以下项目中重新设计 Riddle Notes 落地页：

工作目录：
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp

落地页目录：
C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\website

请先阅读：
- RIDDLE-NOTES-LANDING-PAGE-GUIDE.md
- website/src/
- website/version.json
- website/index.html

产品名称改为：
Riddle Notes

产品副标题：
Your private collection of useful prompts.

产品定位：
这是一个面向 ChatGPT Web 的本地 Prompt 收藏工具。用户在 ChatGPT 回复旁点击星标，保存 Prompt、AI 回复和来源，然后在浏览器侧边栏中搜索、整理和管理。

当前是早期开发版，只支持 ChatGPT Web，需要通过 Chrome 开发者模式手动加载。

请把落地页视觉重做为“活点地图 + 私人日记本”的感觉：

- 浅色羊皮纸和米白色背景；
- 墨黑、深棕、旧金色、鼠尾草绿和地图蓝灰；
- 纸张、墨迹、页码、注释、足迹、路径和地图节点；
- Hero 右侧展示一张 Prompt 地图和一本打开的笔记页；
- 地图节点代表不同 Prompt；
- 笔记页展示 Prompt 标题、来源和标签；
- 不要使用机器人、大脑、紫色渐变或普通 AI SaaS 卡片；
- 不要直接复制 Harry Potter 的角色、纹章、字体、台词或电影道具。

页面文案必须简洁、具体、诚实。

Hero 使用：

标题：
Riddle Notes

副标题：
Your private collection of useful prompts.

说明：
在 ChatGPT 回复旁点击星标，把值得再次使用的 Prompt 保存下来。

按钮：
获取源码
查看安装步骤

状态：
支持 ChatGPT Web · 本地存储 · 开发版

功能区只保留三个功能：

1. 收藏：在 ChatGPT 回复旁点击星标，保存当前 Prompt、回复和来源。
2. 整理：使用文件夹、标签和搜索，找到已经保存的内容。
3. 版本：保留修改记录，方便复制、比较和继续调整。

使用流程压缩为三步：

01 看到值得保存的回复
02 点击星标
03 在 Riddle Notes 中查看和整理

本地数据区域只保留：

你的收藏，保存在你的浏览器里。

Riddle Notes 不要求账号。收藏数据默认保存在当前浏览器，并支持 JSON 导出。清除浏览器数据前，请先备份。

安装区域必须明确说明：

- 当前没有正式安装包；
- 下载源码并本地构建；
- 通过 Chrome 开发者模式加载；
- 当前只支持 ChatGPT Web。

动效要求：

- SVG 地图路径缓慢绘制；
- 地图节点依次显现；
- 鼠标移动时地图和笔记页有 4～8px 的轻微视差；
- 墨迹式淡入动画；
- 不使用逐字打字机效果；
- 不使用粒子爆炸、霓虹发光或夸张 3D 动效；
- 移动端降低动画；
- 支持 prefers-reduced-motion。

工程要求：

- 只修改 website/ 目录和必要的落地页配置；
- 不修改 Chrome Extension 的核心功能；
- 确保 GitHub Pages 的 /sidecar/ 子路径正常；
- 资源路径不能写死为根路径；
- 替换所有占位 GitHub 链接；
- 修复所有空锚点和不存在的资源；
- 确保 favicon 和 OG 图片真实存在；
- 版本信息从 version.json 读取。

完成后执行：

cd "C:\Users\yanmingzhang\Desktop\Code\产品学习\sidecar-mvp\website"
npm run build

最后输出：

1. 修改和新增文件清单；
2. 文案变化摘要；
3. 视觉和动效变化摘要；
4. GitHub Pages 子路径测试结果；
5. 桌面端、平板端和移动端检查结果；
6. 构建结果；
7. 仍然存在的问题。
```
