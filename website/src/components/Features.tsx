const features = [
  {
    number: '01',
    title: '收藏',
    description: '在 ChatGPT 回复旁点击星标，保存当前 Prompt、回复和来源。'
  },
  {
    number: '02',
    title: '整理',
    description: '使用文件夹、标签和搜索，找到已经保存的内容。'
  },
  {
    number: '03',
    title: '版本',
    description: '保留修改记录，方便复制、比较和继续调整。'
  }
]

export default function Features() {
  return (
    <section id="notebook" className="feature-section section">
      <div className="container">
        <div className="section-heading" data-reveal>
          <p className="eyebrow">THE NOTEBOOK</p>
          <h2>收藏、整理、继续使用。</h2>
          <p>Riddle Notes 目前只做三件事。</p>
        </div>

        <div className="feature-list" data-reveal>
          {features.map((feature) => (
            <article className="feature-item" key={feature.number}>
              <span className="feature-item__number">{feature.number}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
