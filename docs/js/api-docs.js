/**
 * API Documentation Interactivity
 * Handles expand/collapse, copy buttons, search, and navigation
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  initExpandCollapse()
  initCopyButtons()
  initSearch()
  initSmoothScroll()
})

/**
 * Expand/Collapse functionality for method cards
 */
function initExpandCollapse() {
  const methodHeaders = document.querySelectorAll('[data-expandable]')

  methodHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't trigger if clicking on a link inside the header
      if (e.target.tagName === 'A') return

      const card = header.closest('.api-method-card')
      const expandBtn = header.querySelector('.api-expand-btn svg')

      // Toggle collapsed class
      card.classList.toggle('collapsed')

      // Animate the expand button
      if (expandBtn) {
        if (card.classList.contains('collapsed')) {
          expandBtn.style.transform = 'rotate(-90deg)'
        } else {
          expandBtn.style.transform = 'rotate(0deg)'
        }
      }
    })
  })
}

/**
 * Copy to clipboard functionality
 */
function initCopyButtons() {
  const copyButtons = document.querySelectorAll('.api-copy-btn')

  copyButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
      e.stopPropagation() // Prevent card collapse

      // Get the code block
      const codeBlock = button.nextElementSibling
      const code = codeBlock.querySelector('code')
      const text = code ? code.textContent : ''

      try {
        // Copy to clipboard
        await navigator.clipboard.writeText(text)

        // Visual feedback
        const originalHTML = button.innerHTML
        button.classList.add('copied')
        button.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Copied!</span>
        `

        // Reset after 2 seconds
        setTimeout(() => {
          button.classList.remove('copied')
          button.innerHTML = originalHTML
        }, 2000)

      } catch (err) {
        console.error('Failed to copy:', err)

        // Fallback for older browsers
        fallbackCopy(text, button)
      }
    })
  })
}

/**
 * Fallback copy method for older browsers
 */
function fallbackCopy(text, button) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    document.execCommand('copy')
    button.classList.add('copied')
    button.textContent = 'Copied!'

    setTimeout(() => {
      button.classList.remove('copied')
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      `
    }, 2000)
  } catch (err) {
    console.error('Fallback copy failed:', err)
  }

  document.body.removeChild(textarea)
}

/**
 * Search functionality
 */
function initSearch() {
  const searchInput = document.querySelector('.api-search')
  if (!searchInput) return

  let debounceTimer

  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer)

    // Debounce search for better performance
    debounceTimer = setTimeout(() => {
      const query = e.target.value.toLowerCase().trim()
      filterMethods(query)
    }, 200)
  })
}

/**
 * Filter API methods based on search query
 */
function filterMethods(query) {
  const methodCards = document.querySelectorAll('.api-method-card')
  const sections = document.querySelectorAll('.api-section')

  let hasVisibleResults = false

  if (query === '') {
    // Show all
    methodCards.forEach(card => {
      card.style.display = ''
    })
    sections.forEach(section => {
      section.style.display = ''
    })
    removeNoResultsMessage()
    return
  }

  // Filter method cards
  methodCards.forEach(card => {
    const methodName = card.querySelector('.api-method-name')?.textContent.toLowerCase() || ''
    const signature = card.querySelector('.api-method-signature')?.textContent.toLowerCase() || ''
    const summary = card.querySelector('.api-method-summary')?.textContent.toLowerCase() || ''

    const matches = methodName.includes(query) ||
                   signature.includes(query) ||
                   summary.includes(query)

    if (matches) {
      card.style.display = ''
      hasVisibleResults = true

      // Expand matched cards for better visibility
      card.classList.remove('collapsed')
    } else {
      card.style.display = 'none'
    }
  })

  // Hide sections with no visible methods
  sections.forEach(section => {
    const visibleCards = section.querySelectorAll('.api-method-card:not([style*="display: none"])')
    if (visibleCards.length === 0) {
      section.style.display = 'none'
    } else {
      section.style.display = ''
    }
  })

  // Show "no results" message if needed
  if (!hasVisibleResults) {
    showNoResultsMessage(query)
  } else {
    removeNoResultsMessage()
  }
}

/**
 * Show no results message
 */
function showNoResultsMessage(query) {
  removeNoResultsMessage() // Remove existing message first

  const container = document.querySelector('.container.py-section')
  if (!container) return

  const message = document.createElement('div')
  message.className = 'api-no-results'
  message.innerHTML = `
    <div class="info-box info-box-info">
      <h3 class="info-box-title">No Results Found</h3>
      <p>No API methods match "${escapeHtml(query)}"</p>
      <p class="mt-12 mb-0">Try searching for:</p>
      <ul class="ml-20 mt-8">
        <li>Method names (e.g., "resolve", "register", "bind")</li>
        <li>Type names (e.g., "Container", "Builder", "Token")</li>
        <li>Keywords (e.g., "factory", "lifetime", "autowire")</li>
      </ul>
    </div>
  `

  container.insertBefore(message, container.firstChild)
}

/**
 * Remove no results message
 */
function removeNoResultsMessage() {
  const message = document.querySelector('.api-no-results')
  if (message) {
    message.remove()
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Smooth scrolling for anchor links
 */
function initSmoothScroll() {
  // Handle navigation links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href')
      if (href === '#') return

      e.preventDefault()

      const targetId = href.substring(1)
      const targetElement = document.getElementById(targetId)

      if (targetElement) {
        // Expand the target card if it's collapsed
        const methodCard = targetElement.closest('.api-method-card')
        if (methodCard && methodCard.classList.contains('collapsed')) {
          methodCard.classList.remove('collapsed')
        }

        // Smooth scroll with offset for fixed header
        const headerOffset = 80
        const elementPosition = targetElement.getBoundingClientRect().top
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        })

        // Update URL without jumping
        history.pushState(null, null, href)

        // Highlight the target briefly
        highlightElement(targetElement)
      }
    })
  })

  // Handle direct URL hash on page load
  if (window.location.hash) {
    setTimeout(() => {
      const targetElement = document.querySelector(window.location.hash)
      if (targetElement) {
        const methodCard = targetElement.closest('.api-method-card')
        if (methodCard && methodCard.classList.contains('collapsed')) {
          methodCard.classList.remove('collapsed')
        }

        const headerOffset = 80
        const elementPosition = targetElement.getBoundingClientRect().top
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        })

        highlightElement(targetElement)
      }
    }, 100)
  }
}

/**
 * Highlight element briefly
 */
function highlightElement(element) {
  const card = element.closest('.api-method-card') || element

  // Add highlight class
  card.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease'
  card.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.2)'
  card.style.borderColor = 'var(--accent-primary)'

  // Remove after animation
  setTimeout(() => {
    card.style.boxShadow = ''
    card.style.borderColor = ''
  }, 1500)
}

/**
 * Keyboard shortcuts
 */
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K or / to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k' || e.key === '/') {
    e.preventDefault()
    const searchInput = document.querySelector('.api-search')
    if (searchInput) {
      searchInput.focus()
      searchInput.select()
    }
  }

  // Escape to clear search
  if (e.key === 'Escape') {
    const searchInput = document.querySelector('.api-search')
    if (searchInput && document.activeElement === searchInput) {
      searchInput.value = ''
      searchInput.dispatchEvent(new Event('input'))
      searchInput.blur()
    }
  }
})

// Add keyboard shortcut hint to search placeholder
const searchInput = document.querySelector('.api-search')
if (searchInput) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const shortcut = isMac ? '⌘K' : 'Ctrl+K'
  searchInput.placeholder = `Search API... (${shortcut})`
}
