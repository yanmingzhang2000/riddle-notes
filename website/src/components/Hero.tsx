import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, BookOpen, MousePointer2, Star } from 'lucide-react'

interface HeroProps {
  version: {
    extensionDownloadPath: string
    installationGuide: string
  }
}

export default function Hero({ version }: HeroProps) {
  const moveArtifact = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    const x = (pointerX / bounds.width - 0.5) * 12
    const y = (pointerY / bounds.height - 0.5) * 10
    event.currentTarget.style.setProperty('--map-x', `${x}px`)
    event.currentTarget.style.setProperty('--map-y', `${y}px`)
    event.currentTarget.style.setProperty('--note-x', `${x * -0.5}px`)
    event.currentTarget.style.setProperty('--note-y', `${y * -0.5}px`)
    event.currentTarget.style.setProperty('--spot-x', `${pointerX}px`)
    event.currentTarget.style.setProperty('--spot-y', `${pointerY}px`)
    event.currentTarget.style.setProperty('--spot-opacity', '1')
  }

  const resetArtifact = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--map-x', '0px')
    event.currentTarget.style.setProperty('--map-y', '0px')
    event.currentTarget.style.setProperty('--note-x', '0px')
    event.currentTarget.style.setProperty('--note-y', '0px')
    event.currentTarget.style.setProperty('--spot-opacity', '0')
  }

  return (
    <section id="top" className="hero">
      <div className="hero__wash" aria-hidden="true" />
      <div className="container hero__layout">
        <div className="hero__copy">
          <p className="eyebrow">RIDDLE NOTES · MULTI-PLATFORM AI</p>
          <p className="hero__brand-name">Riddle Notes</p>
          <h1>
            <span>跨平台 AI Prompt</span>
            <span>收藏夹</span>
          </h1>
          <p className="hero__subtitle">Your private collection of useful prompts.</p>
          <p className="hero__lead">
            在 ChatGPT、Claude、Gemini、WorkBuddy、DeepSeek<br />
            等 AI 助手回复旁点击星标，把 Prompt 和回复收藏起来。
          </p>
          <div className="hero__actions">
            <a className="button button--ink" href={version.extensionDownloadPath} download>
              <ArrowDownToLine size={16} aria-hidden="true" />
              下载安装包
            </a>
            <a className="button button--paper" href={version.installationGuide} target="_blank" rel="noreferrer">
              <BookOpen size={16} aria-hidden="true" />
              查看安装步骤
            </a>
          </div>
          <p className="hero__meta">开发版 · 支持 ChatGPT, Claude, Gemini, WorkBuddy, DeepSeek · 需要手动安装</p>
        </div>

        <div
          className="capture-story"
          onPointerMove={moveArtifact}
          onPointerLeave={resetArtifact}
          aria-label="在 ChatGPT 回复旁点击星标后，Prompt 保存到 Riddle Notes 手札的动画示意"
        >
          <div className="source-map-layer" aria-hidden="true">
            <svg viewBox="0 0 720 500">
              <path className="source-map-contour" d="M-20 138c102-92 198-75 276-14s153 57 236-8 166-64 254 7" />
              <path className="source-map-contour source-map-contour--sage" d="M10 417c101-80 196-61 279-2s154 44 226-18 145-70 231-29" />
              <path className="source-map-contour" d="M130-20c17 80 73 122 135 149s96 85 94 157 55 132 148 183" />
            </svg>
            <div className="map-awakened" aria-hidden="true">
              <svg viewBox="0 0 720 500">
                <path d="M72 388c84-67 156-63 225-16s134 44 205 5" />
                <path d="M402 69c-33 62-37 111-8 156" />
              </svg>
              <span className="map-whisper map-whisper--writing">写作</span>
              <span className="map-whisper map-whisper--code">代码</span>
              <span className="map-whisper map-whisper--archive">私人索引 · 014</span>
            </div>
            <div className="source-landmark source-landmark--chatgpt">
              <span className="platform-mark platform-mark--chatgpt">
                <svg viewBox="1.68 1.75 16.65 16.5" aria-hidden="true">
                  <path d="M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z" />
                </svg>
              </span>
              <span className="source-landmark__copy"><strong>ChatGPT</strong><small>当前支持</small></span>
            </div>
            <div className="source-landmark source-landmark--claude">
              <span className="platform-mark platform-mark--claude">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#DDBE97" d="M4.75 12c0-4 3.25-7.25 7.25-7.25s7.25 3.25 7.25 7.25-3.25 7.25-7.25 7.25S4.75 16 4.75 12z" />
                  <path fill="#5F443D" d="M12 8.25c-.75 0-1.5.25-2 .75-.5.5-.75 1.25-.75 2s.25 1.5.75 2c.5.5 1.25.75 2 .75s1.5-.25 2-.75c.5-.5.75-1.25.75-2s-.25-1.5-.75-2c-.5-.5-1.25-.75-2-.75zm-1 2c0-.25.25-.5.5-.5s.5.25.5.5-.25.5-.5.5-.5-.25-.5-.5z" />
                  <path fill="#5F443D" d="M8.25 12c0-1.75.75-3.25 2-4.25-1.25-1-3-1.5-4.75-1.25C3.75 8 3.25 10 3.75 12s1.5 3.75 3.25 4.5c1.75.75 3.75.25 5-1-.75-1.25-1.25-3-1.25-4.5zM15.75 12c0 1.75-.75 3.25-2 4.25 1.25 1 3 1.5 4.75 1.25 1.75-.25 3.25-2.25 2.75-4.25s-1.5-3.75-3.25-4.5c-1.75-.75-3.75-.25-5 1 .75 1.25 1.25 3 1.25 4.5z" />
                </svg>
              </span>
              <span className="source-landmark__copy"><strong>Claude</strong><small>当前支持</small></span>
            </div>
            <div className="source-landmark source-landmark--gemini">
              <span className="platform-mark platform-mark--gemini">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <defs><linearGradient id="gemini-mark" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse"><stop stopColor="#4E82EE" /><stop offset=".48" stopColor="#8A79D6" /><stop offset="1" stopColor="#D989B5" /></linearGradient></defs>
                  <path fill="url(#gemini-mark)" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
                </svg>
              </span>
              <span className="source-landmark__copy"><strong>Gemini</strong><small>当前支持</small></span>
            </div>
            <div className="source-landmark source-landmark--workbuddy">
              <span className="platform-mark platform-mark--workbuddy"><b>W</b></span>
              <span className="source-landmark__copy"><strong>WorkBuddy</strong><small>当前支持</small></span>
            </div>
            <div className="source-landmark source-landmark--deepseek">
              <span className="platform-mark platform-mark--deepseek">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#F5F5F5" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
                  <path fill="#3B82F6" d="M12 7l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" />
                  <path fill="#60A5FA" d="M12 10.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
                </svg>
              </span>
              <span className="source-landmark__copy"><strong>DeepSeek</strong><small>当前支持</small></span>
            </div>
          </div>

          <div className="source-browser">
            <div className="source-browser__bar">
              <span className="window-dots"><i /><i /><i /></span>
              <span className="source-browser__address">chatgpt.com/claude.ai/gemini.google.com</span>
              <span className="source-browser__state">5平台支持</span>
            </div>
            <div className="source-browser__body">
              <div className="source-browser__site"><span>ChatGPT / Claude / Gemini</span><i>多平台支持</i></div>
              <div className="source-message source-message--user">
                <span className="source-avatar">Y</span>
                <p>请 Review 这份产品需求方案，指出关键缺口。</p>
              </div>
              <div className="source-message source-message--reply">
                <span className="source-avatar source-avatar--ai">AI</span>
                <div>
                  <p>可以直接保存这段内容：</p>
                  <blockquote>检查目标用户、核心场景、范围边界、依赖风险和验收标准，并给出修改建议。</blockquote>
                  <div className="source-message__tools">
                    <span>复制</span>
                    <span className="story-star">
                      <Star size={14} aria-hidden="true" />
                      <em>已收藏</em>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <MousePointer2 className="story-cursor" size={25} aria-hidden="true" />
          </div>

          <svg className="capture-route" viewBox="0 0 720 500" aria-hidden="true">
            <path className="capture-route__under" d="M120 305C185 325 255 392 338 410C405 424 466 340 520 250" />
            <path className="capture-route__line" pathLength="1" d="M120 305C185 325 255 392 338 410C405 424 466 340 520 250" />
            <circle className="capture-route__traveler" r="5">
              <animateMotion dur="1.6s" repeatCount="1" begin="2.7s" fill="freeze" path="M120 305C185 325 255 392 338 410C405 424 466 340 520 250" />
            </circle>
          </svg>

          <div className="capture-node" aria-hidden="true">
            <i>✦</i>
            <span><strong>产品评审</strong><small>新收藏</small></span>
          </div>

          <article className="story-notebook">
            <div className="story-notebook__cover" aria-hidden="true" />
            <div className="story-notebook__page story-notebook__page--left">
              <span className="story-notebook__label">RIDDLE NOTES</span>
              <p>PRIVATE<br />PROMPT<br />COLLECTION</p>
              <span className="story-notebook__page-number">13</span>
            </div>
            <div className="story-notebook__spine" aria-hidden="true" />
            <div className="story-notebook__page story-notebook__page--right">
              <header><span>NOTE 014</span><Star size={14} aria-hidden="true" /></header>
              <div className="saved-note-reveal">
                <p className="saved-note-reveal__kicker">SAVED FROM CHATGPT</p>
                <h2>产品需求方案 Review</h2>
                <p className="saved-note-reveal__source">来源 · ChatGPT Web</p>
                <div className="saved-note-reveal__rule" />
                <p className="saved-note-reveal__excerpt">检查目标用户、核心场景、范围边界、依赖风险和验收标准，并给出修改建议。</p>
                <div className="saved-note-reveal__tags"><span>产品</span><span>评审</span></div>
              </div>
              <footer><span>RIDDLE NOTES</span><span>14</span></footer>
            </div>
          </article>

          <p className="capture-story__caption"><span>点击星标</span>，Prompt 会出现在你的手札里。</p>
        </div>
      </div>
    </section>
  )
}
