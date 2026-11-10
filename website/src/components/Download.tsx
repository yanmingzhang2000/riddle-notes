import { ArrowDownToLine, ArrowUpRight, BookOpen } from 'lucide-react'

interface DownloadProps {
  version: {
    version: string
    releaseDate: string
    releaseNotes: string[]
    repositoryUrl: string
    sourceDownloadUrl: string
    installationGuide: string
    changelogUrl: string
  }
}

export default function Download({ version }: DownloadProps) {
  return (
    <section id="install" className="download-section section">
      <div className="container download-layout">
        <div className="download-copy">
          <p className="eyebrow">开发版</p>
          <h2>安装 Sidecar</h2>
          <p className="download-version">v{version.version} <span /> {version.releaseDate}</p>
          <p className="download-summary">
            目前还没有打包好的扩展文件。
            <br />
            下载源码并完成构建后，可以通过 Chrome 开发者模式加载。
          </p>
          <div className="download-actions">
            <a className="button button--dark" href={version.sourceDownloadUrl}>
              <ArrowDownToLine size={17} aria-hidden="true" />
              下载源码
            </a>
            <a className="text-link" href={version.repositoryUrl} target="_blank" rel="noreferrer">
              查看源码 <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="install-panel">
          <div className="install-panel__head">
            <span>安装步骤</span>
            <a href={version.installationGuide} target="_blank" rel="noreferrer">
              完整说明 <BookOpen size={15} aria-hidden="true" />
            </a>
          </div>
          <ol className="install-steps">
            <li><span>1</span><p>下载源码并解压</p></li>
            <li><span>2</span><p>在项目目录运行 <code>npm install</code> 和 <code>npm run build</code></p></li>
            <li><span>3</span><p>打开 <code>chrome://extensions</code>，开启开发者模式</p></li>
            <li><span>4</span><p>点击“加载已解压的扩展程序”，选择 <code>dist</code> 文件夹</p></li>
          </ol>
          <div className="release-note">
            <span>当前版本包含：</span>
            <ul>
              {version.releaseNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
            <a href={version.changelogUrl} target="_blank" rel="noreferrer">查看更新记录</a>
          </div>
        </div>
      </div>
    </section>
  )
}
