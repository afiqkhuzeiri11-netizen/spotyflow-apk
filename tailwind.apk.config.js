/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./spotyflow.html', './public/index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        spotify: {
          bg: '#050505',
          surface: '#111113',
          card: '#16161A',
          hover: '#222227',
          text: '#FFFFFF',
          muted: '#A1A1AA',
          green: '#1ED760',
        },
      },
    },
  },
  plugins: [],
};
