// ESLint v9 flat config para Next.js frontend.
//
// MINIMAL: solo typescript-eslint con reglas que atrapan bugs reales (sin
// estilo). NO usamos `eslint-config-next` porque al 2026-05 aún expone solo
// legacy config y la integración con flat config v9 vía FlatCompat estaba
// rota en nuestra versión de Next (14.2.x). El typecheck (tsc --noEmit)
// más el build de Next ya cubren la corrección estructural; ESLint cubre
// patrones obvios (unused, no-explicit-any opcional, prefer-const).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'next-env.d.ts',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
