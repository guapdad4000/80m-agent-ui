/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Fira Code', 'Courier New', 'monospace'],
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },
      colors: {
        bg: '#eae7de',
        surface: '#ffffff',
        border: '#111111',
        primary: '#111111',
        accent: '#22c55e',
      },
      animation: {
        'bounce-slow': 'bounce 1.5s infinite',
      },
    },
  },
  plugins: [],
};
