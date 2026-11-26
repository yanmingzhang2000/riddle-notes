const features = [
  {
    number: '01',
    title: '收藏',
    description: '在 ChatGPT 回复旁点击星标，保存 Prompt、回复和来源平台。其他 AI 平台还在适配中。'
  },
  {
    number: '02',
    title: '找回',
    description: '在侧栏里按标题和描述搜索，也可以只看最近收藏的，或你标星的 Prompt。'
  },
  {
    number: '03',
    title: '留存',
    description: '每条收藏保留原始 Prompt 和 AI 回复。在设置页可以把全部数据导出为 JSON 备份。'
  }
]

export default function Features() {
  return (
    <section id="notebook" className="feature-section section">
      <div className="container">
        <div className="section-heading" data-reveal>
          <p className="eyebrow">THE NOTEBOOK</p>
          <h2>收藏、找回、留存。</h2>
          <p>Riddle Notes 的核心是这三件事。右图是收藏之后的真实界面。</p>
        </div>

        <div className="feature-showcase">
          <div className="feature-list feature-list--stacked" data-reveal>
            {features.map((feature) => (
              <article className="feature-item" key={feature.number}>
                <span className="feature-item__number">{feature.number}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>

          <figure className="feature-shot" data-reveal>
            <div className="feature-shot__frame">
              <img
                src="./screenshots/side-panel.png"
                width={880}
                height={600}
                loading="lazy"
                alt="Riddle Notes 侧栏界面：左侧是搜索框和导航，右侧是已收藏的 Prompt 列表"
              />
            </div>
            <figcaption>收藏后的侧栏界面。截图里的 Prompt 是演示内容。</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
