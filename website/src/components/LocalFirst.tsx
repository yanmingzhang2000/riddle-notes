export default function LocalFirst() {
  return (
    <section className="local-note-section section" aria-labelledby="local-note-title">
      <div className="container local-note">
        <div>
          <p className="eyebrow">本地存储</p>
          <h2 id="local-note-title">数据保存在当前浏览器。</h2>
        </div>
        <div className="local-note__copy">
          <p>Sidecar 不要求账号。</p>
          <p>收藏数据默认保存在本地，并支持 JSON 导出。</p>
          <p>清除浏览器数据前，请先备份。</p>
        </div>
      </div>
    </section>
  )
}
