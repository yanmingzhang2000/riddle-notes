import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, BookOpen, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import { contours, riverPath } from './heroMapData'

interface HeroProps {
  version: {
    extensionDownloadPath: string
    installationGuide: string
  }
}

interface Platform {
  id: string
  name: string
  /** 域名取自扩展代码 src/content/selectors.ts 的 PLATFORM_DOMAINS */
  domain: string
  /** 只有 ChatGPT 经过真实网站验证 */
  verified: boolean
  /** 节点在 720 x 500 画布中的位置 */
  x: number
  y: number
}

const platforms: Platform[] = [
  { id: 'chatgpt', name: 'ChatGPT', domain: 'chatgpt.com', verified: true, x: 56, y: 150 },
  { id: 'claude', name: 'Claude', domain: 'claude.ai', verified: false, x: 56, y: 54 },
  { id: 'gemini', name: 'Gemini', domain: 'gemini.google.com', verified: false, x: 222, y: 70 },
  { id: 'workbuddy', name: 'WorkBuddy', domain: 'workbuddy.ai', verified: false, x: 40, y: 440 },
  { id: 'deepseek', name: 'DeepSeek', domain: 'chat.deepseek.com', verified: false, x: 440, y: 50 },
]

/** 与扩展 content-script 注入的星标按钮使用同一个五角星路径 */
const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'

/** 墨迹路径:从回复卡的星标出发,经过地图,从手札左缘下方进入手札 */
const INK_PATH = 'M154 284C154 346 226 382 292 368S352 340 392 330'

/**
 * 示意图里演示用的 Prompt 原文。放不下的部分由 hero.css 的 line-clamp 用省略号截断,
 * 与扩展真实收藏时"标题取前 50 字、描述取前 200 字,多出来的用 ... 代替"的行为一致。
 */
const DEMO_PROMPT =
  '你现在是一位有多年经验的文字编辑，专门负责抹掉内容里的机器腔。前提是事实、观点和关键信息一个都不许改，在此基础上把整篇重新捋一遍。 删掉那种开头很正确、看完啥也没说的空话，砍掉硬凑的连接词、排到一半以上的排比，还有结尾硬拔的情绪升华和教科书式的套话。 句子该长就长、该短就短，把停顿、顺序和用词的疏密重新排一下；该补的细节补上，转折自然一点，立场敢说清楚一点。写得不那么完美也没关系，别端着。不准硬塞网络热词，不准假装口语化，不准编我没说过的个人经历，不准加原文没有的事实，更不准换成另一套模板腔。'

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={STAR_PATH} />
    </svg>
  )
}

export default function Hero({ version }: HeroProps) {
  const moveStage = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 10
    event.currentTarget.style.setProperty('--map-x', `${x}px`)
    event.currentTarget.style.setProperty('--map-y', `${y}px`)
    event.currentTarget.style.setProperty('--note-x', `${x * -0.5}px`)
    event.currentTarget.style.setProperty('--note-y', `${y * -0.5}px`)
  }

  const resetStage = (event: ReactPointerEvent<HTMLDivElement>) => {
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
          <h1>
            <span>AI Prompt</span>
            <span>私人收藏夹</span>
          </h1>
          <p className="hero__subtitle">Your private collection of useful prompts.</p>
          <p className="hero__lead">在 AI 回复旁点一下星标，Prompt 和回复就收进你的本地手札。</p>
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
          <p className="hero__meta">开发版 · 收藏数据只存在本地 · 需手动安装</p>
        </div>

        <div className="hero-visual">
          <div
            className="hero-stage"
            role="img"
            aria-label="示意图：在 ChatGPT 回复旁点击星标，Prompt 和回复被收进 Riddle Notes 手札。Claude、Gemini、WorkBuddy、DeepSeek 正在适配中。"
            onPointerMove={moveStage}
            onPointerLeave={resetStage}
          >
            <div className="hero-scene">
              <div className="hero-map" aria-hidden="true">
                <div className="hero-map__sheet">
                  <svg viewBox="0 0 720 500" preserveAspectRatio="xMidYMid slice">
                    {contours.map((contour, index) => (
                      <path key={index} className={`hero-contour hero-contour--${contour.kind}`} d={contour.d} />
                    ))}
                    <path className="hero-river" d={riverPath} />
                  </svg>
                </div>
              </div>

              {platforms.map((platform, index) => (
                <div
                  key={platform.id}
                  className={`hero-node hero-node--${platform.id} ${platform.verified ? 'hero-node--live' : 'hero-node--pending'}`}
                  style={
                    {
                      left: `${(platform.x / 720) * 100}%`,
                      top: `${(platform.y / 500) * 100}%`,
                      '--i': index,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <span className="hero-node__pin" />
                  <span className="hero-node__tag">
                    <span className="hero-node__row">
                      <strong>{platform.name}</strong>
                      <em>{platform.verified ? '当前可用' : '适配中'}</em>
                    </span>
                    <span className="hero-node__domain">{platform.domain}</span>
                  </span>
                </div>
              ))}

              <div className="hero-reply" aria-hidden="true">
                <p>{DEMO_PROMPT}</p>
                <div className="hero-reply__tools">
                  <span className="hero-reply__tool"><Copy size={15} /></span>
                  <span className="hero-reply__tool"><ThumbsUp size={15} /></span>
                  <span className="hero-reply__tool"><ThumbsDown size={15} /></span>
                  <span className="hero-reply__star"><StarIcon /></span>
                </div>
              </div>

              <svg className="hero-ink" viewBox="0 0 720 500" aria-hidden="true">
                <path className="hero-ink__under" pathLength="1" d={INK_PATH} />
                <path className="hero-ink__line" pathLength="1" d={INK_PATH} />
              </svg>
            </div>

            <span className="hero-thread" aria-hidden="true" />

            <div className="hero-notebook" aria-hidden="true">
              <span className="hero-ribbon hero-ribbon--seal" />
              <span className="hero-ribbon hero-ribbon--sage" />
              <div className="hero-notebook__cover" />
              <div className="hero-notebook__pages">
                <div className="hero-page hero-page--left" />
                <div className="hero-page hero-page--right">
                  <div className="hero-note">
                    <div className="hero-note__head" style={{ '--i': 0 } as CSSProperties}>
                      <span>NOTE 014</span>
                      <StarIcon className="hero-note__star" />
                    </div>
                    <p className="hero-note__title" style={{ '--i': 1 } as CSSProperties}>去AI味</p>
                    <p className="hero-note__source" style={{ '--i': 2 } as CSSProperties}>ChatGPT · chatgpt.com</p>
                    <i className="hero-note__rule" style={{ '--i': 3 } as CSSProperties} />
                    <p className="hero-note__excerpt" style={{ '--i': 4 } as CSSProperties}>{DEMO_PROMPT}</p>
                    <div className="hero-note__tags" style={{ '--i': 5 } as CSSProperties}>
                      <span>写作</span>
                      <span>润色</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="hero-visual__caption">示意图，实际界面见下方。</p>
        </div>
      </div>
    </section>
  )
}
