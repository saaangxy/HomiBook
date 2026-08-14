/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 语义色(与 web 主题 token 对齐),具体浅/深值由 ThemeContext 提供
        primary: '#f97316',
        'primary-foreground': '#ffffff',
        income: '#22c55e',
        expense: '#ef4444',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};