import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

interface HeaderProps {
  repositoryUrl: string
}

export default function Header({ repositoryUrl }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false)
    }

    document.body.classList.add('menu-is-open')
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.classList.remove('menu-is-open')
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isMenuOpen])

  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <a href="#top" className="brand" aria-label="Sidecar 首页" onClick={closeMenu}>
          <svg className="brand__mark" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="currentColor" />
            <path d="M9 10.5 16 7l7 3.5v11L16 25l-7-3.5v-11Z" fill="#F5F2EA" />
            <path d="m9 10.5 7 3.5 7-3.5M16 14v11" fill="none" stroke="#202A22" strokeWidth="1.4" />
          </svg>
          <span>Sidecar</span>
        </a>

        <nav id="site-navigation" className={`site-nav ${isMenuOpen ? 'site-nav--open' : ''}`} aria-label="主导航">
          <a href="#product" onClick={closeMenu}>功能</a>
          <a href="#install" onClick={closeMenu}>安装</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>源码</a>
          <a href="#install" className="button button--dark site-nav__cta" onClick={closeMenu}>
            获取源码
          </a>
        </nav>

        <button
          className="menu-button"
          type="button"
          aria-label={isMenuOpen ? '关闭菜单' : '打开菜单'}
          aria-controls="site-navigation"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {isMenuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
    </header>
  )
}
