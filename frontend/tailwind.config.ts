import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Nudo
        bg: '#F4F5F7',
        bg2: '#EEF0F3',
        surface: '#FFFFFF',
        ink: '#0F172A',
        ink2: '#1F2937',
        mute: '#6B7280',
        mute2: '#9CA3AF',
        line: '#E5E7EB',
        line2: '#EEF0F3',

        // Brand indigo→violet Clubify (logo: C squircle gradient #6366F1 → #A855F7)
        brand: {
          DEFAULT: '#6366F1',
          700: '#4F46E5',
          soft: '#EEF2FF',
          100: '#E0E7FF',
          400: '#818CF8',
          500: '#6366F1',
          600: '#5B58E8',
        },

        sidebar: {
          bg: '#0E1A24',     // dark indigo casi negro (Admin Nudo approved)
          bg2: '#0A131B',
          ink: '#E5E7EB',
          mute: '#6B7790',
          section: '#A5B4FC', // indigo-300 para etiquetas de sección
          hover: '#1A2632',
          active: '#5B5EEE',
        },

        ok: { DEFAULT: '#16A34A', soft: '#DCFCE7', ink: '#166534' },
        bad: { DEFAULT: '#DC2626', soft: '#FEE2E2', ink: '#991B1B' },
        warn: { DEFAULT: '#D97706', soft: '#FEF3C7', ink: '#92400E' },
        info: { DEFAULT: '#2563EB', soft: '#DBEAFE', ink: '#1E40AF' },

        avatar: {
          1: '#10B981',
          2: '#F97316',
          3: '#7C3AED',
          4: '#22C55E',
          5: '#A855F7',
          6: '#3B82F6',
          7: '#EC4899',
        },
      },
      borderRadius: {
        card: '16px',
        pill: '999px',
        input: '12px',
      },
      boxShadow: {
        sm2: '0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.02)',
        md2: '0 6px 18px -8px rgba(15,23,42,.12), 0 2px 6px -2px rgba(15,23,42,.05)',
        active: '0 6px 18px -8px rgba(99,102,241,.6), inset 0 0 0 1px rgba(255,255,255,.08)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'bounce-once': {
          '0%, 100%': { transform: 'translateY(0)' },
          '20%': { transform: 'translateY(-12px)' },
          '40%': { transform: 'translateY(-6px)' },
          '60%': { transform: 'translateY(-3px)' },
        },
        'pulse-once': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(99,102,241,0.0)' },
          '50%': { boxShadow: '0 0 0 8px rgba(99,102,241,0.25)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-33.333%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        'bounce-once': 'bounce-once 1.6s ease-out 1',
        'pulse-once': 'pulse-once 1.6s ease-out 2',
        marquee: 'marquee 28s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
