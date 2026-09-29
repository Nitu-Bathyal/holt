import motion from "./postcss-motion.mjs";

const config = {
  plugins: [
    // Before Tailwind: the motion setting in every prefers-reduced-motion block (postcss-motion.mjs).
    motion(),
    "@tailwindcss/postcss",
  ],
};

export default config;
