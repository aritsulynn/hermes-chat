/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class' (not the tailwind default 'media'): the app sets no dark:
  // variants, and 'media' makes react-native-css-interop throw
  // "Cannot manually set color scheme..." on web whenever <head> mutates.
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
