/**
 * NovaDI Documentation JavaScript
 * Handles interactivity for docs pages
 */

// ============================================
// Collapsible Sections
// ============================================
function initCollapsibles() {
  const collapsibles = document.querySelectorAll('.collapsible-header')

  collapsibles.forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling
      const icon = header.querySelector('.collapsible-icon')

      if (content && content.classList.contains('collapsible-content')) {
        content.classList.toggle('expanded')
        if (icon) {
          icon.classList.toggle('expanded')
        }
      }
    })
  })
}

// ============================================
// Sidebar Navigation
// ============================================
function initSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const sidebarLinks = document.querySelectorAll('.sidebar-links a')
  const currentPath = window.location.pathname

  // Highlight active link
  sidebarLinks.forEach(link => {
    if (link.getAttribute('href') === currentPath.split('/').pop()) {
      link.classList.add('active')
    }

    // Scroll to section on click
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href')
      if (href.startsWith('#')) {
        e.preventDefault()
        const targetId = href.substring(1)
        const target = document.getElementById(targetId)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          // Update URL without scrolling
          history.pushState(null, null, href)
        }
      }
    })
  })

  // Mobile sidebar toggle
  const mobileToggle = document.querySelector('.sidebar-toggle')
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open')
    })
  }
}

// ============================================
// Smooth Scroll for Anchor Links
// ============================================
function initSmoothScroll() {
  const anchorLinks = document.querySelectorAll('a[href^="#"]')

  anchorLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href')
      if (href === '#') return

      e.preventDefault()
      const targetId = href.substring(1)
      const target = document.getElementById(targetId)

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // Update URL
        history.pushState(null, null, href)
      }
    })
  })
}

// ============================================
// Copy Code Blocks
// ============================================
// Note: Handled by Prism.js copy-to-clipboard plugin
// No custom implementation needed

// ============================================
// Table of Contents Generator
// ============================================
function generateTableOfContents() {
  const toc = document.getElementById('table-of-contents')
  if (!toc) return

  const headings = document.querySelectorAll('.main-content h2, .main-content h3')
  const list = document.createElement('ul')
  list.className = 'toc-list'

  headings.forEach(heading => {
    const li = document.createElement('li')
    const a = document.createElement('a')

    // Generate ID if not present
    if (!heading.id) {
      heading.id = heading.textContent
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, '')
    }

    a.href = '#' + heading.id
    a.textContent = heading.textContent
    a.className = heading.tagName.toLowerCase() === 'h3' ? 'toc-sub' : ''

    li.appendChild(a)
    list.appendChild(li)
  })

  toc.appendChild(list)
}

// ============================================
// Search Functionality (Simple)
// ============================================
function initSearch() {
  const searchInput = document.getElementById('docs-search')
  if (!searchInput) return

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase()
    const sections = document.querySelectorAll('.main-content section')

    sections.forEach(section => {
      const text = section.textContent.toLowerCase()
      if (text.includes(query) || query === '') {
        section.style.display = ''
      } else {
        section.style.display = 'none'
      }
    })
  })
}

// ============================================
// Theme Toggle
// ============================================
function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle')
  if (!toggle) return

  // Get system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const systemTheme = prefersDark ? 'dark' : 'light'

  // Check localStorage first, fallback to system preference
  const savedTheme = localStorage.getItem('theme')
  const currentTheme = savedTheme || systemTheme

  // Set initial theme
  document.documentElement.setAttribute('data-theme', currentTheme)
  updateThemeIcon(toggle, currentTheme)

  // Toggle theme on click
  toggle.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme')
    const newTheme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('theme', newTheme)
    updateThemeIcon(toggle, newTheme)
  })

  // Listen for system theme changes (if user hasn't manually set theme)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      const newTheme = e.matches ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', newTheme)
      updateThemeIcon(toggle, newTheme)
    }
  })
}

function updateThemeIcon(toggle, theme) {
  const icon = toggle.querySelector('.theme-icon')
  if (!icon) return

  if (theme === 'dark') {
    // Show sun icon (switch to light)
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"></path></svg>'
  } else {
    // Show moon icon (switch to dark)
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"></path></svg>'
  }
}

// ============================================
// Scroll Progress Bar
// ============================================
function initScrollProgress() {
  const progressBar = document.getElementById('scroll-progress')
  if (!progressBar) return

  window.addEventListener('scroll', () => {
    const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
    const scrolled = (window.scrollY / windowHeight) * 100
    progressBar.style.width = scrolled + '%'
  })
}

// ============================================
// Active Section Highlighting in Sidebar
// ============================================
function initActiveSectionHighlight() {
  const sections = document.querySelectorAll('.main-content section[id]')
  const sidebarLinks = document.querySelectorAll('.sidebar-links a')

  if (sections.length === 0 || sidebarLinks.length === 0) return

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id')
        sidebarLinks.forEach(link => {
          link.classList.remove('active')
          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('active')
          }
        })
      }
    })
  }, {
    rootMargin: '-20% 0px -80% 0px'
  })

  sections.forEach(section => observer.observe(section))
}

// ============================================
// Active Section Highlighting in TOC
// ============================================
function initTocHighlight() {
  const sections = document.querySelectorAll('.main-content [id]')
  const tocLinks = document.querySelectorAll('.toc-links a')

  if (sections.length === 0 || tocLinks.length === 0) return

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id')
        tocLinks.forEach(link => {
          link.classList.remove('active')
          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('active')
          }
        })
      }
    })
  }, {
    rootMargin: '-20% 0px -80% 0px'
  })

  sections.forEach(section => observer.observe(section))
}

// ============================================
// External Link Icons
// ============================================
function initExternalLinks() {
  const links = document.querySelectorAll('a[href^="http"]')

  links.forEach(link => {
    // Skip buttons - they shouldn't have external link arrows
    if (link.classList.contains('btn')) return

    if (!link.hostname.includes(window.location.hostname)) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
      // Add external icon
      link.innerHTML += ' <span style="font-size: 0.8em;">↗</span>'
    }
  })
}

// ============================================
// Back to Top Button
// ============================================
function initBackToTop() {
  const button = document.getElementById('back-to-top')
  if (!button) return

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      button.style.display = 'block'
    } else {
      button.style.display = 'none'
    }
  })

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

// ============================================
// Initialize All
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initCollapsibles()
  initSidebar()
  initSmoothScroll()
  // initCodeCopy() - Handled by Prism.js plugin
  generateTableOfContents()
  initSearch()
  initThemeToggle()
  initScrollProgress()
  initActiveSectionHighlight()
  initTocHighlight()
  initExternalLinks()
  initBackToTop()
  initMouseMistEffect()

  console.log('📚 NovaDI Documentation loaded')
})

// ============================================
// Keyboard Shortcuts
// ============================================
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + K for search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    const searchInput = document.getElementById('docs-search')
    if (searchInput) {
      searchInput.focus()
    }
  }

  // ESC to close modals/search
  if (e.key === 'Escape') {
    const searchInput = document.getElementById('docs-search')
    if (searchInput && document.activeElement === searchInput) {
      searchInput.blur()
      searchInput.value = ''
      // Trigger input event to reset search
      searchInput.dispatchEvent(new Event('input'))
    }
  }
})
