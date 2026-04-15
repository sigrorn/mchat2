/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        provider: {
          claude: "#d4a574",
          openai: "#74b874",
          gemini: "#7cb5e8",
          perplexity: "#9a74d4",
          mistral: "#d47474",
          apertus: "#a0c8e8",
        },
      },
    },
  },
  plugins: [],
};
