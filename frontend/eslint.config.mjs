// ESLint v9 flat config para Next.js frontend.
//
// MINIMAL: solo typescript-eslint con reglas que atrapan bugs reales (sin
// estilo). NO usamos `eslint-config-next` porque al 2026-05 aún expone solo
// legacy config y la integración con flat config v9 vía FlatCompat estaba
// rota en nuestra versión de Next (14.2.x). El typecheck (tsc --noEmit)
// más el build de Next ya cubren la corrección estructural; ESLint cubre
// patrones obvios (unused, no-explicit-any opcional, prefer-const).
import tseslint from 'typescript-eslint';

/**
 * Reglas que el código apaga con `eslint-disable` pero que esta config NO carga
 * (ver la nota de arriba: los plugins de Next, react-hooks y jsx-a11y no están
 * instalados a propósito).
 *
 * Sin registrarlas, ESLint no falla por el `<img>` ni por las dependencias del
 * hook: falla por el COMENTARIO, con "Definition for rule was not found". Eran
 * 135 de los 139 errores del frontend — 97% de ruido que tapaba los 4 reales.
 *
 * Se registran como no-op: los `eslint-disable` existentes quedan válidos y no
 * se toca ninguno de los 45 archivos que los tienen. Esto NO activa la
 * verificación; solo calla el falso positivo. Si algún día se instalan los
 * plugins de verdad, se borra este bloque y las reglas empiezan a correr.
 *
 * NO se intentó borrar las directivas con `eslint --fix`: se probó y se
 * revirtió. Deja la línea llena de espacios en 90 archivos y, peor, también se
 * lleva las de reglas que SÍ existen pero no están activadas (`no-console`),
 * que no son basura sino la intención del autor — "este console.warn va a
 * propósito".
 */
const noop = { create: () => ({}) };
const stubs = {
  '@next/next': { rules: { 'no-img-element': noop } },
  'react-hooks': { rules: { 'exhaustive-deps': noop } },
  'jsx-a11y': { rules: { 'media-has-caption': noop } },
};

export default tseslint.config(
  { plugins: stubs },
  {
    // En una config deliberadamente mínima, TODA directiva que apunte a una
    // regla no activada se reporta como "inútil". Con 140 de esas, el aviso
    // deja de ser señal y pasa a tapar los problemas reales.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
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
