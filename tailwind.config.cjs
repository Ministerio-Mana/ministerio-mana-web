
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Intro"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell', 'Noto Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        body: ['"Intro"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell', 'Noto Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#293C74',
          dark: '#1A255C',
          medium: '#3F58A1',
          light: '#CBD9E6',
          teal: '#28A6BD',
          gold: '#F2C94C',
          void: '#0B1120',
          ocean: '#00A9BD'
        },
        accent: {
          DEFAULT: '#F6519B',
          soft: '#FF8AB8'
        },
        neutral: {
          50: '#F5EFEB',
          100: '#F1F3F8',
          200: '#CBD9E6',
          500: '#6C748C',
          700: '#3B4258',
          900: '#1C2130'
        }
      },
      boxShadow: {
        brand: '0 14px 40px -18px rgba(41, 60, 116, 0.45)',
        brandHover: '0 24px 48px -16px rgba(246, 81, 155, 0.35)',
        brandInset: 'inset 0 1px 0 rgba(255,255,255,0.24)'
      },
      borderRadius: {
        '4xl': '2rem'
      },
      backgroundImage: {
        'mana-gradient': 'linear-gradient(135deg, #293C74 0%, #28A6BD 55%, #567C8D 100%)',
        'mana-accent': 'linear-gradient(135deg, rgba(41,60,116,0.12) 0%, rgba(86,124,141,0.16) 100%)'
      }
    },
    animation: {
      'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      'float-slow': 'float-slow 6s ease-in-out infinite',
    },
    keyframes: {
      'float-slow': {
        '0%, 100%': { transform: 'translateY(0px)' },
        '50%': { transform: 'translateY(-15px)' },
      }
    }
  },
  plugins: [require('@tailwindcss/typography'), require('@tailwindcss/forms')]
};
