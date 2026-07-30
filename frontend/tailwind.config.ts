import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // --- Linear Foundations ---
        // Bound to CSS custom properties (see globals.css :root / [data-theme]) via the
        // `rgb(var(--x-rgb) / <alpha-value>)` pattern so both plain utilities (bg-bg-0) AND
        // Tailwind's opacity modifiers (bg-bg-0/50) resolve correctly and react to the
        // active [data-theme] at runtime — this is what powers the light/dark toggle.
        bg: {
          0: 'rgb(var(--color-bg-level-0-rgb) / <alpha-value>)',   // Deepest app background
          1: 'rgb(var(--color-bg-level-1-rgb) / <alpha-value>)',   // Main panel background
          2: 'rgb(var(--color-bg-level-2-rgb) / <alpha-value>)',   // Elevated containers
          3: 'rgb(var(--color-bg-secondary-rgb) / <alpha-value>)', // Secondary cards and embedded panels
          4: 'rgb(var(--color-bg-tertiary-rgb) / <alpha-value>)',  // Higher-elevation surface
          5: 'rgb(var(--color-bg-quaternary-rgb) / <alpha-value>)', // Menus, popovers, strong containers
        },

        // --- Text System ---
        text: {
          primary:    'rgb(var(--color-text-primary-rgb) / <alpha-value>)',    // Primary headings and main copy
          secondary:  'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',  // Secondary UI text
          tertiary:   'rgb(var(--color-text-tertiary-rgb) / <alpha-value>)',   // Metadata, helper text
          quaternary: 'rgb(var(--color-text-quaternary-rgb) / <alpha-value>)', // Muted labels and lower-emphasis UI
        },

        // --- Borders ---
        border: {
          primary:   'rgb(var(--color-border-primary-rgb) / <alpha-value>)',   // Standard divider and card border
          secondary: 'rgb(var(--color-border-secondary-rgb) / <alpha-value>)', // Stronger boundary
          tertiary:  'rgb(var(--color-border-tertiary-rgb) / <alpha-value>)',  // High-emphasis outline
        },

        // --- Brand & Accent (constant across themes) ---
        brand:  'rgb(var(--color-brand-bg-rgb) / <alpha-value>)',  // Main brand/action color
        accent: {
          DEFAULT: 'rgb(var(--color-link-primary-rgb) / <alpha-value>)',  // Links and bright active emphasis
          hover:   'rgb(var(--color-accent-hover-rgb) / <alpha-value>)',  // Hover/focus accent
        },

        // --- Functional Colors (constant across themes) ---
        blue:   'rgb(var(--color-blue-rgb) / <alpha-value>)',   // Info and secondary UI accent
        teal:   'rgb(var(--color-teal-rgb) / <alpha-value>)',   // Analytics / AI / support accent
        green:  'rgb(var(--color-green-rgb) / <alpha-value>)',  // Success / healthy state
        yellow: 'rgb(var(--color-yellow-rgb) / <alpha-value>)', // Warning or at-risk state
        orange: 'rgb(var(--color-orange-rgb) / <alpha-value>)', // Changelog and warm highlight accent
        red:    'rgb(var(--color-red-rgb) / <alpha-value>)',    // Destructive or critical issue state

        // --- Product-Specific ---
        linear: {
          plan:     '#68CC58',  // Planning / healthy progress
          build:    '#D4B144',  // Build / active work emphasis
          security: '#7A7FAD',  // Security / secondary feature support
        },

        // --- Social Meta (preserved) ---
        meta: {
          blue:      '#1877F2',
          instagram: '#E4405F',
        },
      },

      fontFamily: {
        // Inter Variable with Berkeley Mono for code surfaces
        sans: [
          'Inter Variable',
          'Inter',
          'SF Pro Display',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'Berkeley Mono',
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'monospace',
        ],
        serif: [
          'Tiempos Headline',
          'Georgia',
          'serif',
        ],
      },

      // --- Letter Spacing (Linear type spec) ---
      letterSpacing: {
        tighter: '-0.022em',  // Hero/title tracking
        tight:   '-0.013em',  // Small body tracking
        body:    '-0.011em',  // Body copy tracking
        label:   '-0.01em',   // Label tracking
        normal:  '0em',
      },

      // --- Border Radius (Linear scale) ---
      borderRadius: {
        sm:   '4px',
        md:   '6px',
        DEFAULT: '8px',
        lg:   '12px',
        xl:   '16px',
        '2xl': '24px',
        '3xl': '32px',
        pill: '9999px',
      },

      // --- Box Shadow (Linear elevation tokens) ---
      boxShadow: {
        none:   '0px 0px 0px transparent',
        tiny:   '0px 1px 1px 0px rgba(0, 0, 0, 0.09)',
        low:    '0px 1px 4px -1px rgba(0, 0, 0, 0.09)',
        medium: '0px 3px 12px rgba(0, 0, 0, 0.09)',
        high:   '0px 7px 32px rgba(0, 0, 0, 0.35)',
        panel:  '0px 3px 12px rgba(0, 0, 0, 0.09)',
      },
    },
  },
  plugins: [],
}

export default config
