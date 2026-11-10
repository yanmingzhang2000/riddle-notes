const steps = [
  {
    number: '01',
    title: '在 ChatGPT 中点击星标'
  },
  {
    number: '02',
    title: '在 Sidecar 侧边栏查看'
  },
  {
    number: '03',
    title: '复制 Prompt，或创建新版本'
  }
]

export default function Flow() {
  return (
    <section className="flow-section section" aria-label="使用流程">
      <div className="container">
        <div className="section-heading">
          <p className="eyebrow">使用流程</p>
          <h2>使用方式很简单</h2>
          <p>点击星标，之后在侧边栏中管理。</p>
        </div>

        <div className="flow-line">
          {steps.map((step, index) => (
            <div className="flow-line__step" key={step.number}>
              <span>{step.number}</span>
              <strong>{step.title}</strong>
              {index < steps.length - 1 && <i aria-hidden="true">→</i>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
