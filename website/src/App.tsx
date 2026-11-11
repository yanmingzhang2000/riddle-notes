import { useEffect } from 'react'
import VersionData from '../version.json'
import Header from './components/Header'
import Hero from './components/Hero'
import Features from './components/Features'
import LocalFirst from './components/LocalFirst'
import Download from './components/Download'
import Footer from './components/Footer'

export default function App() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.14 }
    )

    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="app">
      <Header repositoryUrl={VersionData.repositoryUrl} />
      <main>
        <Hero version={VersionData} />
        <Features />
        <LocalFirst />
        <Download version={VersionData} />
      </main>
      <Footer version={VersionData} />
    </div>
  )
}
