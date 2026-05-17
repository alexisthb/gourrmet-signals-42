import type { Config } from "tailwindcss";

/**
 * Gourrmet — tailwind config refondu.
 * Indigo dominant, light only, Plus Jakarta partout.
 * Reference: handoff/PROMPT.md + handoff/CHECKLIST.md
 *
 * Les couleurs sémantiques résolvent sur les CSS variables définies
 * dans src/index.css. Aucune palette gold/charbon legacy active —
 * les anciens tokens (`signal.*`, `sidebar.*`, `success-foreground`,
 * `coral`, `turquoise`, `yellow`) sont préservés sous forme d'alias
 * indigo le temps de migrer les composants un par un.
 */
export default {
  // Light only — darkMode retiré.
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "-apple-system", "sans-serif"],
        // display = sans (Plus Jakarta partout) — alias preserve pour ne pas casser les composants legacy.
        display: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
        hand: ["Caveat", "cursive"],
      },
      colors: {
        // ── shadcn sémantiques (CSS vars en HSL triplet) ──────────
        border:     "hsl(var(--border))",
        input:      "hsl(var(--input))",
        ring:       "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        primary: {
          DEFAULT:     "hsl(var(--primary))",
          foreground:  "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:     "hsl(var(--secondary))",
          foreground:  "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:     "hsl(var(--destructive))",
          foreground:  "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:     "hsl(var(--muted))",
          foreground:  "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:     "hsl(var(--accent))",
          foreground:  "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT:     "hsl(var(--popover))",
          foreground:  "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:     "hsl(var(--card))",
          foreground:  "hsl(var(--card-foreground))",
        },

        // ── Sémantiques Gourrmet ──────────────────────────────────
        surface:           "hsl(var(--surface))",
        "surface-sunk":    "hsl(var(--surface-sunk))",
        "background-warm": "hsl(var(--background-warm))",

        "fg-1":     "hsl(var(--fg-1))",
        "fg-2":     "hsl(var(--fg-2))",
        "fg-3":     "hsl(var(--fg-3))",
        "fg-muted": "hsl(var(--fg-muted))",

        "border-strong": "hsl(var(--border-strong))",

        // ── Palettes primitives — accessibles en utilities ────────
        navy: {
          50:  "hsl(var(--navy-50))",
          100: "hsl(var(--navy-100))",
          200: "hsl(var(--navy-200))",
          300: "hsl(var(--navy-300))",
          400: "hsl(var(--navy-400))",
          500: "hsl(var(--navy-500))",
          600: "hsl(var(--navy-600))",
          700: "hsl(var(--navy-700))",
          800: "hsl(var(--navy-800))",
          900: "hsl(var(--navy-900))",
        },
        indigo: {
          50:  "hsl(var(--indigo-50))",
          100: "hsl(var(--indigo-100))",
          200: "hsl(var(--indigo-200))",
          300: "hsl(var(--indigo-300))",
          500: "hsl(var(--indigo-500))",
          600: "hsl(var(--indigo-600))",
          700: "hsl(var(--indigo-700))",
          800: "hsl(var(--indigo-800))",
        },
        terracotta: {
          50:  "hsl(var(--terracotta-50))",
          100: "hsl(var(--terracotta-100))",
          300: "hsl(var(--terracotta-300))",
          500: "hsl(var(--terracotta-500))",
          600: "hsl(var(--terracotta-600))",
          700: "hsl(var(--terracotta-700))",
        },
        teal: {
          50:  "hsl(var(--teal-50))",
          100: "hsl(var(--teal-100))",
          200: "hsl(var(--teal-200))",
          300: "hsl(var(--teal-300))",
          400: "hsl(var(--teal-400))",
          500: "hsl(var(--teal-500))",
          600: "hsl(var(--teal-600))",
          700: "hsl(var(--teal-700))",
        },
        sable: {
          50:  "hsl(var(--sable-50))",
          100: "hsl(var(--sable-100))",
          200: "hsl(var(--sable-200))",
          300: "hsl(var(--sable-300))",
          400: "hsl(var(--sable-400))",
          500: "hsl(var(--sable-500))",
        },

        // ── Sources — Presse / Pappers / LinkedIn ─────────────────
        source: {
          presse: {
            DEFAULT:    "hsl(var(--source-presse))",
            bg:         "hsl(var(--source-presse-bg))",
            foreground: "hsl(var(--source-presse-fg))",
          },
          pappers: {
            DEFAULT:    "hsl(var(--source-pappers))",
            bg:         "hsl(var(--source-pappers-bg))",
            foreground: "hsl(var(--source-pappers-fg))",
          },
          linkedin: {
            DEFAULT:    "hsl(var(--source-linkedin))",
            bg:         "hsl(var(--source-linkedin-bg))",
            foreground: "hsl(var(--source-linkedin-fg))",
          },
        },

        // ── Statuts ───────────────────────────────────────────────
        success: {
          DEFAULT:     "hsl(var(--success))",
          bg:          "hsl(var(--success-bg))",
          foreground:  "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT:     "hsl(var(--warning))",
          bg:          "hsl(var(--warning-bg))",
          foreground:  "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger-fg))",
          bg:      "hsl(var(--danger-bg))",
        },
        info: {
          DEFAULT:    "hsl(var(--info))",
          bg:         "hsl(var(--info-bg))",
          foreground: "hsl(var(--info-foreground))",
        },

        // ── ALIASES LEGACY ────────────────────────────────────────
        // Preserves pour ne pas casser les composants en cours de migration.
        // La sidebar pointe sur la nouvelle palette (surface blanche + indigo).
        sidebar: {
          DEFAULT:            "hsl(var(--sidebar-background))",
          foreground:         "hsl(var(--sidebar-foreground))",
          primary:            "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent:             "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border:             "hsl(var(--sidebar-border))",
          ring:               "hsl(var(--sidebar-ring))",
          muted:              "hsl(var(--sidebar-muted))",
        },
        // Types signaux desormais monochromes indigo - la differenciation
        // est portee par les icones Lucide (cf. SIGNAL_TYPE_CONFIG).
        signal: {
          anniversaire: "hsl(var(--signal-anniversaire))",
          levee:        "hsl(var(--signal-levee))",
          ma:           "hsl(var(--signal-ma))",
          distinction:  "hsl(var(--signal-distinction))",
          expansion:    "hsl(var(--signal-expansion))",
          nomination:   "hsl(var(--signal-nomination))",
          linkedin:     "hsl(var(--signal-linkedin))",
        },
        coral:     "hsl(var(--coral))",
        turquoise: "hsl(var(--turquoise))",
        yellow:    "hsl(var(--yellow))",
      },
      borderRadius: {
        lg:     "var(--radius)",
        md:     "calc(var(--radius) - 2px)",
        sm:     "8px",
        xl:     "20px",
        card:   "20px",
        button: "12px",
        input:  "10px",
        badge:  "999px",
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
        eyebrow: ["11px", { lineHeight: "1.4", letterSpacing: "0.18em" }],
      },
      boxShadow: {
        prisme:        "6px 6px 0 rgba(46, 62, 146, 0.10)",
        "prisme-strong": "6px 6px 0 rgba(46, 62, 146, 0.18)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "fade-in":        "fade-in 0.3s ease-out",
        "slide-up":       "slide-up 0.4s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
