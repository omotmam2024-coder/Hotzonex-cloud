// Apply the saved theme before first paint (no flash). A separate file so the
// Content-Security-Policy can forbid inline scripts. Mirrors src/lib/theme.tsx.
try {
  var t = localStorage.getItem('hzx-theme');
  var dark = t === 'dark' || ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch {
  /* storage blocked: fall back to light */
}
