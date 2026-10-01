import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  // The NativeWind preset is gone: this is now the only stylesheet pipeline.
  // `hairlineWidth()` was the other thing that preset provided, and it is just
  // a 1px hairline — spelled out below rather than imported.
  //
  // `darkMode: 'class'` is no longer a workaround for react-native-css-interop
  // (that package does not exist here any more), but the choice itself is kept:
  // the store owns the theme and toggles `.dark` on <html> explicitly, which is
  // what lets a user override the OS preference.
  darkMode: 'class',
  theme: {
    extend: {
      // Reusables tokens: every colour resolves to the CSS variables declared
      // in global.css, so `dark:` variants swap the whole palette at runtime.
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        hairline: '1px',
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [tailwindcssAnimate],
};
