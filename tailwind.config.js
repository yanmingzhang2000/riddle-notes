/** @type {import('tailwindcss').Config} */
// 配色和字体与落地页（website/src/index.css）保持一致
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/sidepanel/**/*.{js,ts,jsx,tsx}",
    "./src/options/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: '#f4efe3',
        paper: '#fbf8f0',
        aged: '#e8e0d1',
        ink: '#24241f',
        brown: '#463a2f',
        gold: '#b18a45',
        sage: '#899b83',
        mapblue: '#8799a0',
        seal: '#8a5b4b',
        soft: 'rgba(70, 58, 47, 0.68)',
        faint: 'rgba(70, 58, 47, 0.5)',
        line: 'rgba(70, 58, 47, 0.16)',
        linestrong: 'rgba(70, 58, 47, 0.28)',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Segoe UI"', 'Arial', 'sans-serif'],
        display: ['"Baskerville"', '"Iowan Old Style"', '"Palatino Linotype"', '"Book Antiqua"', '"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'Georgia', 'serif'],
        mono: ['"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '112': '28rem',
        '128': '32rem',
      },
    },
  },
  plugins: [],
}
