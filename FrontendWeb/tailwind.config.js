/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        prama: {
          bg: '#0b0c10',
          panel: 'rgba(31, 40, 51, 0.6)',
          highlight: '#66fcf1',
          accent: '#45a29e',
          text: '#c5c6c7',
        }
      }
    },
  },
  plugins: [],
}
