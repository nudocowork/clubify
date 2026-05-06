import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
}

class GoogleLoginDto {
  @IsString() idToken!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

class ForgotPasswordDto {
  @IsEmail() email!: string;
}

class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(2) fullName!: string;
  @IsString() @MinLength(2) brandName!: string;
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() referralCode?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() businessCategorySlug?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  @Public()
  @Post('google')
  google(@Body() dto: GoogleLoginDto, @Ip() ip: string) {
    return this.auth.loginWithGoogle(dto.idToken, ip);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.auth.signup(dto, ip);
  }

  @Public()
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
