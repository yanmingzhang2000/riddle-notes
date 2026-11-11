import { ArrowDownToLine, BookOpen } from 'lucide-react'

interface DownloadProps {
  version: {
    version: string
    releaseNotes: string[]
    sourceDownloadUrl: string
    installationGuide: string
    changelogUrl: string
  }
}

export default function Download({ version }: DownloadProps) {
  return (
    <section id="install" className="download-section section">
      <div className="container download-layout">
        <div className="download-copy" data-reveal>
          <p className="eyebrow">DEVELOPMENT BUILD</p>
          <h2>带走这本手札。</h2>
          <p className="download-version">当前版本 v{version.version} · 支持 ChatGPT Web</p>
          <p className="download-summary">当前版本还没有正式安装包。下载源码并完成本地构建后，可以通过 Chrome 开发者模式加载。</p>
          <div className="download-actions">
            <a className="button button--ink" href={version.sourceDownloadUrl}>
              <ArrowDownToLine size={16} aria-hidden="true" />
              下载源码
            </a>
            <a className="button button--paper" href={version.installationGuide} target="_blank" rel="noreferrer">
              <BookOpen size={16} aria-hidden="true" />
              查看安装步骤
            </a>
          </div>
        </div>

        <div className="install-ledger" data-reveal>
          <div className="install-ledger__head">
            <span>安装步骤</span>
            <span>CHROME · MANUAL</span>
          </div>
          <ol className="install-steps">
            <li><span>01</span><p>下载源码并解压</p></li>
            <li><span>02</span><p>在项目目录运行 <code>npm install</code> 和 <code>npm run build</code></p></li>
            <li><span>03</span><p>打开 <code>chrome://extensions</code>，开启开发者模式</p></li>
            <li><span>04</span><p>点击“加载已解压的扩展程序”，选择 <code>dist</code> 文件夹</p></li>
          </ol>
          <div className="release-note">
            <span>当前版本包含</span>
            <ul>{version.releaseNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            <a href={version.changelogUrl} target="_blank" rel="noreferrer">查看更新记录</a>
          </div>
        </div>
      </div>
    </section>
  )
}
