import { claimOnboarding } from '@shared/onboarding';

/**
 * 首次使用引导 UI
 *
 * - 右下角轻量卡片，三步分页，无全屏遮罩，不抢占输入框焦点。
 * - 放在 Shadow DOM 里，页面样式不会影响引导，引导样式也不会泄漏到页面。
 * - 示意图用 SVG 绘制，不依赖外部图片，也不依赖各平台的页面元素。
 * - 全部用 createElement 构造，不使用 innerHTML，避免受页面 Trusted Types 限制。
 */

const HOST_TAG = 'riddle-notes-onboarding';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH =
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

const COLOR_AMBER = '#fbbf24';
const COLOR_AMBER_SOFT = '#fef3c7';

type Attrs = Record<string, string | number>;

// ---------------------------------------------------------------------------
// DOM 构造辅助
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: SVGElement[] = []
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

function svgText(attrs: Attrs, content: string): SVGTextElement {
  const node = svgEl('text', attrs);
  node.textContent = content;
  return node;
}

// ---------------------------------------------------------------------------
// 示意图
// ---------------------------------------------------------------------------

/** 示意图外框，所有示意图统一 280 x 120 */
function illustrationFrame(children: SVGElement[]): SVGSVGElement {
  return svgEl(
    'svg',
    { viewBox: '0 0 280 120', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgEl('rect', {
        x: 0.5,
        y: 0.5,
        width: 279,
        height: 119,
        rx: 10,
        fill: '#f9fafb',
        stroke: '#e5e7eb',
      }),
      ...children,
    ]
  );
}

/** 模拟文字行 */
function textLine(x: number, y: number, width: number): SVGElement {
  return svgEl('rect', { x, y, width, height: 6, rx: 3, fill: '#d1d5db' });
}

/** 模拟 AI 回复下方的灰色操作按钮 */
function actionIcon(x: number, y: number): SVGElement {
  return svgEl('rect', { x, y, width: 20, height: 20, rx: 5, fill: '#e5e7eb' });
}

/** 五角星，size 为渲染尺寸 */
function starShape(x: number, y: number, size: number, fill: string): SVGElement {
  return svgEl('g', { transform: `translate(${x} ${y}) scale(${size / 24})` }, [
    svgEl('path', { d: STAR_PATH, fill }),
  ]);
}

/** 高亮圆圈，带一圈向外扩散的光晕 */
function highlightCircle(cx: number, cy: number, r: number): SVGElement[] {
  return [
    svgEl('circle', {
      cx,
      cy,
      r,
      fill: COLOR_AMBER_SOFT,
      stroke: COLOR_AMBER,
      'stroke-width': 1.5,
    }),
    svgEl('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: COLOR_AMBER,
      'stroke-width': 1.5,
      class: 'pulse',
    }),
  ];
}

/** 第 1 步：在 AI 回复下方的按钮行里找到星标 */
function illustrationFindStar(): SVGSVGElement {
  return illustrationFrame([
    textLine(16, 16, 210),
    textLine(16, 30, 236),
    textLine(16, 44, 160),
    actionIcon(16, 64),
    actionIcon(44, 64),
    actionIcon(72, 64),
    ...highlightCircle(120, 74, 17),
    starShape(108, 62, 24, COLOR_AMBER),
    svgEl('rect', { x: 146, y: 63, width: 46, height: 22, rx: 11, fill: COLOR_AMBER_SOFT }),
    svgText(
      { x: 169, y: 78, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#92400e' },
      '星标'
    ),
  ]);
}

/** 第 2 步：点击星标，出现"已收藏"提示 */
function illustrationClickStar(): SVGSVGElement {
  return illustrationFrame([
    textLine(16, 16, 210),
    textLine(16, 30, 236),
    actionIcon(16, 64),
    actionIcon(44, 64),
    actionIcon(72, 64),
    ...highlightCircle(120, 74, 17),
    starShape(108, 62, 24, COLOR_AMBER),
    // 鼠标指针
    svgEl(
      'g',
      { transform: 'translate(124 78)' },
      [
        svgEl('path', {
          d: 'M0 0 L0 16 L4 12.5 L6.8 19 L9.5 17.8 L6.8 11.5 L12 11.5 Z',
          fill: '#111827',
          stroke: '#ffffff',
          'stroke-width': 1,
          'stroke-linejoin': 'round',
        }),
      ]
    ),
    // 与真实收藏提示保持一致的 Toast
    svgEl('rect', { x: 66, y: 94, width: 148, height: 20, rx: 10, fill: '#1f2937' }),
    svgText(
      { x: 140, y: 108, 'text-anchor': 'middle', 'font-size': 11, fill: '#f9fafb' },
      '已收藏到：未分类'
    ),
  ]);
}

/** 第 3 步：点击工具栏图标，打开侧边栏查看收藏 */
function illustrationOpenPanel(): SVGSVGElement {
  const listRow = (y: number): SVGElement[] => [
    svgEl('rect', { x: 158, y, width: 102, height: 12, rx: 4, fill: '#f3f4f6' }),
    starShape(161, y + 1.5, 9, COLOR_AMBER),
    svgEl('rect', { x: 174, y: y + 3, width: 70, height: 6, rx: 3, fill: '#d1d5db' }),
  ];

  return illustrationFrame([
    // 浏览器工具栏
    svgEl('rect', { x: 12, y: 10, width: 256, height: 24, rx: 7, fill: '#ffffff', stroke: '#e5e7eb' }),
    svgEl('rect', { x: 20, y: 17, width: 150, height: 10, rx: 5, fill: '#f3f4f6' }),
    ...highlightCircle(252, 22, 11),
    starShape(244, 14, 16, COLOR_AMBER),
    // 左侧页面内容
    textLine(16, 48, 100),
    textLine(16, 62, 120),
    textLine(16, 76, 84),
    textLine(16, 90, 110),
    // 右侧 Side Panel
    svgEl('rect', { x: 150, y: 42, width: 118, height: 70, rx: 6, fill: '#ffffff', stroke: '#e5e7eb' }),
    svgEl('rect', { x: 158, y: 50, width: 50, height: 6, rx: 3, fill: '#9ca3af' }),
    ...listRow(64),
    ...listRow(80),
    ...listRow(96),
  ]);
}

// ---------------------------------------------------------------------------
// 引导步骤
// ---------------------------------------------------------------------------

interface OnboardingStep {
  title: string;
  description: string;
  illustration: () => SVGSVGElement;
}

const STEPS: OnboardingStep[] = [
  {
    title: '找到星标',
    description: '每条 AI 回复旁都有 Riddle Notes 的五角星按钮。',
    illustration: illustrationFindStar,
  },
  {
    title: '点击收藏',
    description: '点一下星标，Prompt 和 AI 回复会保存到本地。',
    illustration: illustrationClickStar,
  },
  {
    title: '查看手札',
    description: '点击浏览器工具栏的 Riddle Notes 图标，打开侧边栏查看、搜索和整理收藏。也可以直接创建手动笔记。',
    illustration: illustrationOpenPanel,
  },
];

// ---------------------------------------------------------------------------
// 样式（写入 Shadow DOM，与页面隔离）
// ---------------------------------------------------------------------------

const ONBOARDING_STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  .card {
    width: 320px;
    max-width: calc(100vw - 40px);
    background: #ffffff;
    color: #111827;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    overflow: hidden;
    animation: rn-in 0.3s ease;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 8px 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #374151;
  }
  .brand svg { width: 16px; height: 16px; }
  .header-right { display: flex; align-items: center; gap: 6px; }
  .progress { font-size: 12px; color: #6b7280; }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #6b7280;
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .icon-btn:hover { background: #f3f4f6; color: #111827; }

  .illustration-box { padding: 0 14px; }
  .illustration-box svg { display: block; width: 100%; height: auto; }

  .content { padding: 12px 14px 0; }
  .title { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #111827; }
  .desc { margin: 0; min-height: 40px; font-size: 13px; color: #4b5563; }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 14px;
  }
  .actions { display: flex; gap: 8px; }

  .link-btn {
    padding: 4px 2px;
    border: none;
    background: transparent;
    color: #6b7280;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .link-btn:hover { color: #111827; text-decoration: underline; }

  .btn {
    padding: 6px 14px;
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .btn-primary { border: 1px solid #0284c7; background: #0284c7; color: #ffffff; }
  .btn-primary:hover { border-color: #0369a1; background: #0369a1; }
  .btn-secondary { border: 1px solid #d1d5db; background: #ffffff; color: #374151; }
  .btn-secondary:hover { background: #f3f4f6; }

  button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }

  .pulse {
    transform-box: fill-box;
    transform-origin: center;
    animation: rn-pulse 1.8s ease-out infinite;
  }

  @keyframes rn-in {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes rn-pulse {
    from { transform: scale(1); opacity: 0.8; }
    to { transform: scale(1.6); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card, .pulse { animation: none; }
  }
`;

// ---------------------------------------------------------------------------
// 卡片
// ---------------------------------------------------------------------------

function createButton(
  label: string,
  className: string,
  onClick: () => void,
  attrs: Record<string, string> = {}
): HTMLButtonElement {
  const button = h('button', { type: 'button', class: className, ...attrs }, [label]);
  button.addEventListener('click', onClick);
  return button;
}

function createBrandStar(): SVGSVGElement {
  return svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [
    svgEl('path', { d: STAR_PATH, fill: COLOR_AMBER }),
  ]);
}

/**
 * 创建引导卡片。步骤切换时只更新内容，不重建按钮，键盘焦点会留在原按钮上。
 */
function createCard(onDismiss: () => void): HTMLElement {
  const lastIndex = STEPS.length - 1;
  let index = 0;

  const progress = h('span', { class: 'progress' });
  const illustrationBox = h('div', { class: 'illustration-box' });
  const title = h('h2', { class: 'title' });
  const description = h('p', { class: 'desc' });

  const skipButton = createButton('跳过', 'link-btn', onDismiss);
  const prevButton = createButton('上一步', 'btn btn-secondary', () => go(-1));
  const nextButton = createButton('下一步', 'btn btn-primary', () => {
    if (index === lastIndex) {
      onDismiss();
    } else {
      go(1);
    }
  });
  const closeButton = createButton('×', 'icon-btn', onDismiss, { 'aria-label': '关闭引导' });

  function go(offset: number) {
    index = Math.min(Math.max(index + offset, 0), lastIndex);
    update();
  }

  function update() {
    const step = STEPS[index];
    progress.textContent = `${index + 1} / ${STEPS.length}`;
    progress.setAttribute('aria-label', `第 ${index + 1} 步，共 ${STEPS.length} 步`);
    illustrationBox.replaceChildren(step.illustration());
    title.textContent = step.title;
    description.textContent = step.description;
    prevButton.hidden = index === 0;
    nextButton.textContent = index === lastIndex ? '完成' : '下一步';
  }

  const card = h('section', { class: 'card', role: 'region', 'aria-label': 'Riddle Notes 新手引导' }, [
    h('div', { class: 'header' }, [
      h('div', { class: 'brand' }, [createBrandStar(), 'Riddle Notes']),
      h('div', { class: 'header-right' }, [progress, closeButton]),
    ]),
    illustrationBox,
    h('div', { class: 'content', 'aria-live': 'polite' }, [title, description]),
    h('div', { class: 'footer' }, [
      skipButton,
      h('div', { class: 'actions' }, [prevButton, nextButton]),
    ]),
  ]);

  update();
  return card;
}

function renderOnboarding(): void {
  if (document.querySelector(HOST_TAG)) {
    return;
  }

  const host = document.createElement(HOST_TAG);
  const hostStyles: [string, string][] = [
    ['all', 'initial'],
    ['position', 'fixed'],
    ['right', '20px'],
    ['bottom', '20px'],
    ['z-index', '2147483000'],
    ['display', 'block'],
  ];
  hostStyles.forEach(([name, value]) => host.style.setProperty(name, value, 'important'));

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', {}, [ONBOARDING_STYLE]), createCard(() => host.remove()));

  document.documentElement.appendChild(host);
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/**
 * 在支持的 AI 网站上按需展示首次使用引导。
 * 平台不在白名单、已经展示过，或者出现任何错误时都静默跳过，不影响页面和星标功能。
 */
export async function showOnboardingIfNeeded(platformId: string): Promise<void> {
  try {
    if (document.querySelector(HOST_TAG)) {
      return;
    }

    const shouldShow = await claimOnboarding(platformId);
    if (!shouldShow) {
      return;
    }

    renderOnboarding();
  } catch (error) {
    console.warn('[Sidecar] Onboarding failed:', error);
  }
}
