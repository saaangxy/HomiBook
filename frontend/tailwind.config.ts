import { heroui } from '@heroui/theme/plugin'

export default {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,mjs}',
  ],
  plugins: [heroui()],
}
