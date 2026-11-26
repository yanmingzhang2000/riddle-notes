import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// Umami Share URL - 已验证：iframe 可正常嵌入（2026-11-26 在 http://localhost:3000 实测通过）
const SHARE_URL = 'https://cloud.umami.is/share/wrriup0ngvMyPO38'

function StatsPage() {
  if (!SHARE_URL) {
    return (
      <main style={{ maxWidth: 640, margin: '20vh auto', padding: '0 24px' }}>
        <h1>Stats</h1>
        <p>看板还没有配置数据源。</p>
      </main>
    )
  }

  return (
    <iframe
      title="Riddle Notes stats"
      src={SHARE_URL}
      style={{ border: 0, width: '100vw', height: '100vh', display: 'block' }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StatsPage />
  </React.StrictMode>,
)
