export default function LocalFirst() {
  return (
    <section className="local-note-section" aria-labelledby="local-note-title">
      <div className="container local-note" data-reveal>
        <div>
          <p className="eyebrow">LOCAL NOTES</p>
          <h2 id="local-note-title">你的收藏，保存在你的浏览器里。</h2>
        </div>
        <div className="local-note__copy">
          <p>Riddle Notes 不要求账号，收藏数据默认保存在当前浏览器。我们会收集匿名的使用统计（如保存次数、活跃天数），你可以在扩展设置里关闭。</p>
          <div className="local-note__facts">
            <span>支持 JSON 导出</span>
            <span>清除浏览器数据前请先备份</span>
          </div>
        </div>
      </div>
    </section>
  )
}
