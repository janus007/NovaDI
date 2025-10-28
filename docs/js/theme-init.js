/**
 * Theme Initialization - Blocking Script
 * MUST be loaded in <head> before CSS to prevent flash
 *
 * This script runs immediately to set the theme before the page renders,
 * preventing a "flash" of light theme when user has dark mode enabled.
 */

(function() {
  // Get system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const systemTheme = prefersDark ? 'dark' : 'light'

  // Check localStorage first, fallback to system preference
  const savedTheme = localStorage.getItem('theme')
  const theme = savedTheme || systemTheme

  // Set theme attribute IMMEDIATELY before CSS renders
  document.documentElement.setAttribute('data-theme', theme)
})();
