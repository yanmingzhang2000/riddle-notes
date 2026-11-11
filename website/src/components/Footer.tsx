interface FooterProps {
  version: {
    repositoryUrl: string
    installationGuide: string
    changelogUrl: string
    issuesUrl: string
  }
}

export default function Footer({ version }: FooterProps) {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="footer-brand">
          <strong>Riddle Notes</strong>
          <p>Your private collection of useful prompts.</p>
        </div>
        <nav className="site-footer__links" aria-label="页脚导航">
          <a href={version.repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
          <a href={version.changelogUrl} target="_blank" rel="noreferrer">更新记录</a>
          <a href={version.installationGuide} target="_blank" rel="noreferrer">安装说明</a>
          <a href={version.issuesUrl} target="_blank" rel="noreferrer">Issues</a>
        </nav>
      </div>
      <div className="container site-footer__bottom">© 2026 Riddle Notes</div>
    </footer>
  )
}
