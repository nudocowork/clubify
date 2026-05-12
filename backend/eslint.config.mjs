// ESLint v9 flat config.
// Minimal — solo reglas que atrapan bugs reales (no estilo). El typecheck
// (tsc --noEmit) ya cubre la corrección de tipos; ESLint cubre patrones.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
      '**/*.js',
      '**/*.mjs',
      'test/**/*.js',
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
      // El codebase usa `any` deliberadamente en algunos lugares (Prisma
      // dmmf, casts a JsonValue). No bloqueamos en CI.
      '@typescript-eslint/no-explicit-any': 'off',
      // NestJS usa `Function` como tipo de constructor — aceptable.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // ts-nocheck/ts-expect-error: warning, no error.
      '@typescript-eslint/ban-ts-comment': 'warn',
      // Variables que arrancan con `_` se consideran intencionalmente
      // sin uso (callbacks, destructuring partial). Warning, no error —
      // limpiar imports muertos sin bloquear CI.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
