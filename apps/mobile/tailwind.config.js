const nativewindPreset = require("nativewind/preset");
const designPreset = require("@cuecommx/design-tokens/tailwind-preset");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [nativewindPreset, designPreset],
  theme: {
    extend: {},
  },
  plugins: [],
};
