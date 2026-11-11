export default function LocalFirst() {
  return (
    <section className="local-note-section section" aria-labelledby="local-note-title">
      <div className="container local-note" data-reveal>
        <div>
          <p className="eyebrow">LOCAL NOTES</p>
          <h2 id="local-note-title">你的收藏，保存在你的浏览器里。</h2>
        </div>
        <div className="local-note__copy">
          <p>Riddle Notes 不要求账号。</p>
          <p>收藏数据默认保存在当前浏览器，并支持 JSON 导出。</p>
          <p>清除浏览器数据前，请先备份。</p>
        </div>
      </div>
    </section>
  )
}
