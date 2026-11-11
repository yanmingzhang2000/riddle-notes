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
        <a href="#top" className="brand" aria-label="Riddle Notes 首页" onClick={closeMenu}>
          <svg className="brand__mark" viewBox="0 0 34 34" aria-hidden="true">
            <rect x="1" y="1" width="32" height="32" rx="9" fill="currentColor" />
            <path d="M9 23.5c3.2-7.6 5.8-10.2 8.4-7.7 2.2 2.1 3.7-.1 7.6-5.3" fill="none" stroke="#F4EFE3" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9" cy="23.5" r="2" fill="#B18A45" />
            <circle cx="25" cy="10.5" r="2" fill="#F4EFE3" />
          </svg>
          <span>Riddle Notes</span>
        </a>

        <nav id="site-navigation" className={`site-nav ${isMenuOpen ? 'site-nav--open' : ''}`} aria-label="主导航">
          <a href="#notebook" onClick={closeMenu}>功能</a>
          <a href="#install" onClick={closeMenu}>安装</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>GitHub</a>
          <a href="#install" className="button button--ink site-nav__cta" onClick={closeMenu}>获取源码</a>
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
