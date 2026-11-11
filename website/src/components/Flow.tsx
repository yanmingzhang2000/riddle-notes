const steps = [
  { number: '01', title: '看到值得保存的回复' },
  { number: '02', title: '点击星标' },
  { number: '03', title: '在 Riddle Notes 中查看和整理' }
]

export default function Flow() {
  return (
    <div className="compact-flow" data-reveal aria-label="使用流程">
      <p className="compact-flow__note">不需要复制粘贴，也不需要注册账号。</p>
      <div className="compact-flow__steps">
        {steps.map((step, index) => (
          <div className="compact-flow__step" key={step.number}>
            <span>{step.number}</span>
            <strong>{step.title}</strong>
            {index < steps.length - 1 && <i aria-hidden="true">→</i>}
          </div>
        ))}
      </div>
    </div>
  )
}
