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
        // --- Linear Dark Foundations ---
        bg: {
          0: '#08090A',   // Deepest app background
          1: '#0F1011',   // Main panel background
          2: '#141516',   // Elevated containers
          3: '#1C1C1F',   // Secondary cards and embedded panels
          4: '#232326',   // Higher-elevation dark surface
          5: '#28282C',   // Menus, popovers, strong containers
        },

        // --- Text System ---
        text: {
          primary:    '#F7F8F8',  // Primary headings and main copy
          secondary:  '#D0D6E0',  // Secondary UI text
          tertiary:   '#8A8F98',  // Metadata, helper text
          quaternary: '#62666D',  // Muted labels and lower-emphasis UI
        },

        // --- Borders ---
        border: {
          primary:   '#23252A',  // Standard divider and card border
          secondary: '#34343A',  // Stronger boundary
          tertiary:  '#3E3E44',  // High-emphasis dark outline
        },

        // --- Brand & Accent ---
        brand:  '#5E6AD2',  // Main brand/action color
        accent: {
          DEFAULT: '#7070FF',  // Links and bright active emphasis
          hover:   '#828FFF',  // Hover/focus accent
        },

        // --- Functional Colors ---
        blue:   '#4EA7FC',  // Info and secondary UI accent
        teal:   '#00B8CC',  // Analytics / AI / support accent
        green:  '#27A644',  // Success / healthy state
        yellow: '#F0BF00',  // Warning or at-risk state
        orange: '#FC7840',  // Changelog and warm highlight accent
        red:    '#EB5757',  // Destructive or critical issue state

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
