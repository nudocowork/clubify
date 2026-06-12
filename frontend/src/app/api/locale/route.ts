import { NextRequest, NextResponse } from 'next/server';
import { isValidLocale } from '@/i18n/config';

/**
 * Endpoint interno del frontend (mismo origen, NO el backend NestJS)
 * para persistir el locale en cookie + sincronizar con backend si el
 * user está autenticado. Lo llama LanguageSwitcher con un POST simple.
 *
 * Se hace acá (no en el backend NestJS) porque necesitamos el efecto de
 * Set-Cookie en MISMO host para que next-intl la lea en el próximo
 * request. Si tuviéramos un sub-API en api.soyclubify.com, el browser
 * descartaría el cookie por SameSite.
 */
export async function POST(req: NextRequest) {
  const { locale } = await req.json().catch(() => ({ locale: null }));
  if (!isValidLocale(locale)) {
    return NextResponse.json({ ok: false, error: 'invalid_locale' }, { status: 400 });
  }

  // Si hay JWT, propagamos al backend para persistir en User.preferredLocale.
  // Best-effort — si el backend está caído, igual seteamos el cookie local.
  const token = req.cookies.get('jwt')?.value || req.headers.get('authorization')?.replace('Bearer ', '');
  if (token) {
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
    fetch(`${API}/api/auth/locale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ locale }),
    }).catch(() => null);
  }

  const res = NextResponse.json({ ok: true, locale });
  // 1 año, path=/ para que aplique en toda la app, sameSite=lax para que
  // siga al user en navegaciones desde otros sitios.
  res.cookies.set('NEXT_LOCALE', locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
  });
  return res;
}
