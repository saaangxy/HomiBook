/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class' 模式:避免 react-native-css-interop 在 Web 端手动设置 colorScheme 时因 'media' 抛错
  darkMode: 'class',
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