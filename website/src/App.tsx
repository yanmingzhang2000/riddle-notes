import VersionData from '../version.json'
import Header from './components/Header'
import Hero from './components/Hero'
import Features from './components/Features'
import Flow from './components/Flow'
import LocalFirst from './components/LocalFirst'
import Download from './components/Download'
import Footer from './components/Footer'

export default function App() {
  return (
    <div className="app">
      <Header repositoryUrl={VersionData.repositoryUrl} />
      <main>
        <Hero version={VersionData} />
        <Features />
        <Flow />
        <LocalFirst />
        <Download version={VersionData} />
      </main>
      <Footer version={VersionData} />
    </div>
  )
}
