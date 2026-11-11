import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, BookOpen, MousePointer2, Star } from 'lucide-react'

interface HeroProps {
  version: {
    sourceDownloadUrl: string
    installationGuide: string
  }
}

export default function Hero({ version }: HeroProps) {
  const moveArtifact = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 10
    event.currentTarget.style.setProperty('--map-x', `${x}px`)
    event.currentTarget.style.setProperty('--map-y', `${y}px`)
    event.currentTarget.style.setProperty('--note-x', `${x * -0.5}px`)
    event.currentTarget.style.setProperty('--note-y', `${y * -0.5}px`)
  }

  const resetArtifact = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--map-x', '0px')
    event.currentTarget.style.setProperty('--map-y', '0px')
    event.currentTarget.style.setProperty('--note-x', '0px')
    event.currentTarget.style.setProperty('--note-y', '0px')
  }

  return (
    <section id="top" className="hero">
      <div className="hero__wash" aria-hidden="true" />
      <div className="container hero__layout">
        <div className="hero__copy">
          <p className="eyebrow">PROMPT NOTES · CHATGPT WEB</p>
          <h1>Riddle Notes</h1>
          <p className="hero__subtitle">Your private collection of useful prompts.</p>
          <p className="hero__lead">在 ChatGPT 回复旁点击星标，把值得再次使用的 Prompt 保存下来。</p>
          <div className="hero__actions">
            <a className="button button--ink" href={version.sourceDownloadUrl}>
              <ArrowDownToLine size={16} aria-hidden="true" />
              获取源码
            </a>
            <a className="button button--paper" href={version.installationGuide} target="_blank" rel="noreferrer">
              <BookOpen size={16} aria-hidden="true" />
              查看安装步骤
            </a>
          </div>
          <p className="hero__meta">支持 ChatGPT Web · 本地存储 · 开发版</p>
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
            <div className="source-landmark source-landmark--chatgpt">
              <span className="platform-mark platform-mark--chatgpt">
                <svg viewBox="0 0 24 24"><path d="M12 4.2c2.2-1.3 5 .3 5 2.9 2.3.1 4 2.2 3.2 4.5 1.5 1.9.5 4.8-1.9 5.4-.6 2.4-3.4 3.4-5.3 1.8-1.9 1.6-4.8.6-5.3-1.8-2.5-.6-3.4-3.5-1.9-5.4C5 9.3 6.7 7.2 9 7.1c0-1.2.7-2.3 1.7-2.9" /></svg>
              </span>
              <span className="source-landmark__copy"><strong>ChatGPT</strong><small>当前支持</small></span>
            </div>
            <div className="source-landmark source-landmark--gemini">
              <span className="platform-mark platform-mark--gemini">
                <svg viewBox="0 0 24 24"><path d="M12 2c.7 5.8 4.2 9.3 10 10-5.8.7-9.3 4.2-10 10-.7-5.8-4.2-9.3-10-10 5.8-.7 9.3-4.2 10-10Z" /></svg>
              </span>
              <span className="source-landmark__copy"><strong>Gemini</strong><small>计划接入</small></span>
            </div>
            <div className="source-landmark source-landmark--workbuddy">
              <span className="platform-mark platform-mark--workbuddy">
                <svg viewBox="0 0 24 24"><path d="m4 6 3.3 12L12 9l4.7 9L20 6" /></svg>
              </span>
              <span className="source-landmark__copy"><strong>WorkBuddy</strong><small>计划接入</small></span>
            </div>
          </div>

          <div className="source-browser">
            <div className="source-browser__bar">
              <span className="window-dots"><i /><i /><i /></span>
              <span className="source-browser__address">chatgpt.com</span>
              <span className="source-browser__state">当前支持</span>
            </div>
            <div className="source-browser__body">
              <div className="source-browser__site"><span>ChatGPT</span><i>WEB</i></div>
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
            <path className="capture-route__under" d="M354 333C413 359 451 341 493 299s60-69 93-77" />
            <path className="capture-route__line" pathLength="1" d="M354 333C413 359 451 341 493 299s60-69 93-77" />
            <circle className="capture-route__traveler" r="5">
              <animateMotion dur="1.6s" repeatCount="1" begin="2.7s" fill="freeze" path="M354 333C413 359 451 341 493 299s60-69 93-77" />
            </circle>
          </svg>

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
