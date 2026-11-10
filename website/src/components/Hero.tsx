import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownToLine, BookOpen } from 'lucide-react'

interface HeroProps {
  version: {
    version: string
    releaseDate: string
    sourceDownloadUrl: string
    installationGuide: string
  }
}

export default function Hero({ version }: HeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = 0
    let pointerX = 0.5
    let pointerY = 0.5
    let currentX = 0.5
    let currentY = 0.5
    let width = 0
    let height = 0

    const lights = [
      { x: 0.16, y: 0.2, radius: 420, color: '168, 185, 155', alpha: 0.11, speed: 26000 },
      { x: 0.72, y: 0.24, radius: 380, color: '200, 213, 215', alpha: 0.11, speed: 31000 },
      { x: 0.58, y: 0.78, radius: 360, color: '231, 229, 168', alpha: 0.08, speed: 35000 },
      { x: 0.9, y: 0.68, radius: 300, color: '168, 185, 155', alpha: 0.07, speed: 29000 }
    ]

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      width = bounds.width
      height = bounds.height
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height)
      currentX += (pointerX - currentX) * 0.012
      currentY += (pointerY - currentY) * 0.012

      lights.forEach((light, index) => {
        const motion = reduceMotion.matches || window.innerWidth < 768 ? 0 : 1
        const driftX = Math.sin(time / light.speed + index * 1.8) * 42 * motion
        const driftY = Math.cos(time / (light.speed * 1.12) + index) * 30 * motion
        const followX = (currentX - 0.5) * 18 * motion
        const followY = (currentY - 0.5) * 12 * motion
        const x = width * light.x + driftX + followX
        const y = height * light.y + driftY + followY
        const gradient = context.createRadialGradient(x, y, 0, x, y, light.radius)

        gradient.addColorStop(0, `rgba(${light.color}, ${light.alpha})`)
        gradient.addColorStop(0.58, `rgba(${light.color}, ${light.alpha * 0.45})`)
        gradient.addColorStop(1, `rgba(${light.color}, 0)`)
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      })
    }

    const animate = (time: number) => {
      draw(time)
      frameId = window.requestAnimationFrame(animate)
    }

    const handlePointer = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth
      pointerY = event.clientY / window.innerHeight
    }

    const start = () => {
      window.cancelAnimationFrame(frameId)
      if (reduceMotion.matches || window.innerWidth < 768) {
        draw(0)
        return
      }
      frameId = window.requestAnimationFrame(animate)
    }

    const handleVisibility = () => {
      if (document.hidden) window.cancelAnimationFrame(frameId)
      else start()
    }

    const handleResize = () => {
      resize()
      start()
    }

    resize()
    start()
    window.addEventListener('resize', handleResize)
    window.addEventListener('pointermove', handlePointer, { passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    reduceMotion.addEventListener('change', start)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('pointermove', handlePointer)
      document.removeEventListener('visibilitychange', handleVisibility)
      reduceMotion.removeEventListener('change', start)
    }
  }, [])

  const moveMockup = (event: ReactPointerEvent<HTMLDivElement>) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    if (reduceMotion || coarsePointer) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 8
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 6
    event.currentTarget.style.setProperty('--mock-x', `${x}px`)
    event.currentTarget.style.setProperty('--mock-y', `${y}px`)
  }

  const resetMockup = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--mock-x', '0px')
    event.currentTarget.style.setProperty('--mock-y', '0px')
  }

  return (
    <section id="top" className="hero">
      <canvas className="hero__light" ref={canvasRef} aria-hidden="true" />
      <div className="container hero__layout">
        <div className="hero__copy">
          <p className="eyebrow">面向 ChatGPT 的 Prompt 收藏工具</p>
          <h1>你的 AI Prompt 收藏夹</h1>
          <p className="hero__lead">
            在 ChatGPT 回复旁点击星标，
            <br />
            保存 Prompt、回复和来源。
            <br />
            之后可以在浏览器侧边栏中搜索、整理和继续修改。
          </p>
          <div className="hero__actions">
            <a className="button button--dark" href={version.sourceDownloadUrl}>
              <ArrowDownToLine size={17} aria-hidden="true" />
              获取源码
            </a>
            <a className="button button--quiet" href={version.installationGuide} target="_blank" rel="noreferrer">
              <BookOpen size={17} aria-hidden="true" />
              查看安装步骤
            </a>
          </div>
          <p className="hero__meta">
            开发版 v{version.version} · 支持 ChatGPT Web · 本地存储
          </p>
        </div>

        <div
          className="product-stage"
          onPointerMove={moveMockup}
          onPointerLeave={resetMockup}
          aria-label="在 ChatGPT 中收藏对话并保存到 Sidecar 侧边栏的示意图"
        >
          <div className="browser-demo">
            <div className="browser-demo__bar" aria-hidden="true">
              <span className="browser-demo__dots"><i /><i /><i /></span>
              <span className="browser-demo__address">chatgpt.com</span>
            </div>

            <div className="browser-demo__body">
              <div className="chat-demo">
                <p className="chat-demo__label">ChatGPT</p>
                <div className="chat-message chat-message--user">
                  <span className="demo-avatar demo-avatar--user">Y</span>
                  <p>帮我写一个发布前检查 Prompt。</p>
                </div>
                <div className="chat-message chat-message--assistant">
                  <span className="demo-avatar demo-avatar--assistant">AI</span>
                  <div className="assistant-copy">
                    <p>可以直接使用：</p>
                    <div className="prompt-paper">
                      请检查以下发布内容，并按「阻塞问题、建议修改、可以发布」整理结果。
                    </div>
                    <div className="message-tools" aria-hidden="true">
                      <span className="tool-icon">⌘</span>
                      <span className="save-tool">
                        <svg width="15" height="15" viewBox="0 0 24 24">
                          <path d="m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 17.3l-5.6 2.94L7.47 14 2.94 9.58l6.26-.91L12 3Z" />
                        </svg>
                        已收藏
                      </span>
                      <span className="demo-cursor">↖</span>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="sidecar-demo" aria-label="Sidecar 侧边栏示意">
                <div className="sidecar-demo__head">
                  <span className="mini-mark">S</span>
                  <strong>Sidecar</strong>
                  <span className="sidecar-demo__count">3</span>
                </div>
                <div className="sidecar-demo__search">搜索 Prompt</div>
                <div className="saved-prompt saved-prompt--new">
                  <div className="saved-prompt__meta"><span>刚刚</span><i>ChatGPT</i></div>
                  <strong>发布前检查</strong>
                  <p>帮我写一个发布前检查 Prompt。</p>
                  <div><span>工作</span><span>检查清单</span></div>
                </div>
                <div className="saved-prompt">
                  <div className="saved-prompt__meta"><span>昨天</span><i>ChatGPT</i></div>
                  <strong>React 代码审查</strong>
                  <p>检查组件的状态与渲染逻辑。</p>
                </div>
              </aside>
            </div>
          </div>
          <p className="product-stage__caption"><span>点击星标</span>，保存当前对话。</p>
        </div>
      </div>
    </section>
  )
}
