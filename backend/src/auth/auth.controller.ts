import { Body, Controller, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
  // 'scanner' = sesión larga (6h) para staff que usa el escáner todo
  // el día. Sin scope = login normal.
  @IsOptional() @IsIn(['scanner']) scope?: 'scanner';
}

class GoogleLoginDto {
  @IsString() idToken!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

class LogoutDto {
  @IsOptional() @IsString() refreshToken?: string;
}

class ForgotPasswordDto {
  @IsEmail() email!: string;
}

class ForgotPasswordSmsDto {
  @IsString() phone!: string;
}

class ResetPasswordSmsDto {
  @IsString() phone!: string;
  @IsString() code!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class SetLocaleDto {
  @IsString() @IsIn(['es', 'en', 'pt']) locale!: 'es' | 'en' | 'pt';
}

class SignupAttributionDto {
  @IsOptional() @IsString() @MaxLength(80) viaSlug?: string;
  @IsOptional() @IsString() @MaxLength(80) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(80) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(80) utmCampaign?: string;
  @IsOptional() @IsString() @MaxLength(1000) referer?: string;
}

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(2) fullName!: string;
  @IsString() @MinLength(2) brandName!: string;
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() referralCode?: string;
  @IsOptional() @IsString() plan?: string;
  // Periodicidad elegida en la landing (Mensual/Trimestral/Semestral/Anual).
  // Informativo, NO afecta billing (Hotmart manda). Útil para CRM.
  @IsOptional() @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  @IsOptional() @IsString() businessCategorySlug?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64) quoteToken?: string;
  @IsOptional() attribution?: SignupAttributionDto;
}

/** Registro al modo prueba (5 días gratis). Endpoint público pero el link
 *  /prueba o /trial NO se publicita — solo embajadores/equipo comercial. */
class TrialSignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(1) @MaxLength(60) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(60) lastName!: string;
  @IsString() @MinLength(6) @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  // Atribución: si vino con un código de embajador/influencer en URL,
  // el frontend lo manda aquí. También sirve para campañas (?campaign=X).
  @IsOptional() @IsString() @MaxLength(80) referralCode?: string;
  // VENDOR agregado al enum — desde 2026-06-05 cada vendor también puede
  // compartir su link /trial?ref=<code>. El backend infiere VENDOR del
  // rol del ReferralCode si no se manda source explícito.
  @IsOptional() @IsIn(['LANDING', 'AMBASSADOR', 'INFLUENCER', 'VENDOR', 'CAMPAIGN', 'DIRECT'])
  source?: 'LANDING' | 'AMBASSADOR' | 'INFLUENCER' | 'VENDOR' | 'CAMPAIGN' | 'DIRECT';
  @IsOptional() attribution?: SignupAttributionDto;
}

class TotpCodeDto {
  // TOTP RFC 6238 estándar: 6 dígitos. Aceptamos espacios opcionales y los
  // strip en el service.
  @IsString() @Matches(/^[\s\d]{6,8}$/) code!: string;
}

class TwoFactorChallengeDto {
  @IsString() challengeToken!: string;
  @IsString() @Matches(/^[\s\d]{6,8}$/) code!: string;
}

class TwoFactorDisableDto {
  @IsString() @Matches(/^[\s\d]{6,8}$/) code!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private twoFactor: TwoFactorService,
  ) {}

  // Brute-force defense: 10 intentos por minuto por IP. Errores 401
  // cuentan igual; el atacante no puede pasar de ese rate.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.login(dto.email, dto.password, ip, {
      scope: dto.scope,
      userAgent,
    });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('google')
  google(
    @Body() dto: GoogleLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.loginWithGoogle(dto.idToken, ip, userAgent);
  }

  // Refresh es menos sensible pero queremos bloquear abuso si alguien tiene
  // un refresh válido y lo rota miles de veces.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, ip, userAgent);
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }

  // Signup: 3 cuentas por hora por IP. Bloquea creación masiva de tenants.
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  @Post('signup')
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.auth.signup(dto, ip);
  }

  /** Check-pending: el frontend `/activar` consulta este endpoint para
   *  pre-llenar el form con los datos del pago Hotmart pendiente (nombre,
   *  teléfono, plan, precio). Read-only, público, throttled.
   *  Devuelve 200 con `{ found: false }` si no hay payment para evitar
   *  enumeration leaks vía status code. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('check-pending')
  checkPending(@Query('email') email?: string) {
    return this.auth.checkPendingPayment(email ?? '');
  }

  /** Modo prueba — 5 días gratis. Crea tenant en TRIAL con trialEndsAt
   *  set + dedup estricto (email/teléfono/brandName). Reuso de la lógica
   *  de signup pero con campos específicos del prospect (firstName/
   *  lastName separados, ciudad y empresa opcionales). El throttle es más
   *  estricto que signup público (2/hora) porque solo embajadores
   *  comparten el link. */
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 2 } })
  @Post('trial-signup')
  trialSignup(@Body() dto: TrialSignupDto, @Ip() ip: string) {
    return this.auth.trialSignup(dto, ip);
  }

  // Forgot: 3 por hora por IP (defensa contra email-enumeration spam).
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  // Reset: 5 por 10 min por IP. Los tokens son 32 bytes random, no
  // brute-forceables, pero igual limitamos para evitar log spam.
  @Public()
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  /** Forgot via SMS: mismo rate limit que email para no abrir vector de
   *  spam de SMS (costoso para nosotros). 3 por hora por IP. */
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  @Post('forgot-password-sms')
  forgotSms(@Body() dto: ForgotPasswordSmsDto) {
    return this.auth.requestPasswordResetSms(dto.phone);
  }

  /** Verificación del código SMS + cambio de contraseña. Stricter rate
   *  limit que reset-email porque el código es solo 6 dígitos (10^6
   *  combinaciones); 3 intentos cada 10 min protege contra brute force. */
  @Public()
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  @Post('reset-password-sms')
  resetSms(@Body() dto: ResetPasswordSmsDto) {
    return this.auth.resetPasswordWithSmsCode(dto.phone, dto.code, dto.newPassword);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    // Enriquecemos con preferredLocale para que el frontend lo
    // hidrate al login y respete la elección del user entre devices.
    return this.auth.meWithPreferredLocale(user);
  }

  // ============================================================
  // i18n — preferencia de idioma
  // ============================================================

  /**
   * Actualiza el idioma preferido del user logueado. El frontend
   * persiste localmente (cookie NEXT_LOCALE) Y llama acá si está
   * autenticado, para que la preferencia siga al user entre devices.
   */
  @Post('locale')
  setLocale(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetLocaleDto,
  ) {
    return this.auth.updatePreferredLocale(user.id, dto.locale);
  }

  // ============================================================
  // 2FA TOTP
  // ============================================================

  /**
   * Paso 1: el usuario logueado pide habilitar 2FA. Retorna otpauth:// URI
   * para mostrar como QR. El 2FA NO queda activo hasta que se confirme con
   * un código válido en /2fa/confirm.
   */
  @Post('2fa/setup')
  setup2FA(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.id);
  }

  /** Paso 2: confirma el setup pasando el primer código del Authenticator. */
  @Post('2fa/confirm')
  confirm2FA(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto) {
    return this.twoFactor.confirm(user.id, dto.code);
  }

  /** Desactiva 2FA. Requiere código TOTP válido para evitar bypass. */
  @Post('2fa/disable')
  disable2FA(
    @CurrentUser() user: AuthUser,
    @Body() dto: TwoFactorDisableDto,
  ) {
    return this.twoFactor.disable(user.id, dto.code);
  }

  /**
   * Login con 2FA activo (paso 2 del login): recibe el challengeToken
   * emitido por /login y el código TOTP. Devuelve los tokens reales.
   * Rate-limited fuerte para bloquear brute force del código de 6 dígitos.
   */
  @Public()
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @Post('2fa/challenge')
  challenge2FA(
    @Body() dto: TwoFactorChallengeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.challenge2FA(dto.challengeToken, dto.code, ip, userAgent);
  }
}
