import { auth } from '@borradh-workspace/auth/server';
import { authEnv } from '@borradh-workspace/env/auth';
import {
  appleNativeSignIn,
  changeEmail,
  changePassword,
  enableTwoFactor,
  forgotPassword,
  getSession,
  googleSignIn,
  googleSignUp,
  resendVerification,
  resetPassword,
  signIn,
  signOut,
  signUp,
  verifyEmail,
  verifyTotp,
} from '@borradh-workspace/features/auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsMobileClient, RawCookieHeader, SessionCookie } from '../common';
import {
  ANONYMOUS_SESSION_PAYLOAD,
  applySessionSetCookies,
  buildSessionPayload,
  clearSessionCookie,
  sendTwoFactorChallenge,
  setSessionCookie,
} from '../common/session/index.js';
import {
  AppleNativeSignInDto,
  ChangeEmailDto,
  ChangePasswordDto,
  EnableTwoFactorDto,
  ForgotPasswordDto,
  GoogleSignInDto,
  GoogleSignUpDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
  VerifyTotpDto,
} from './dto/index.js';

const isDev = process.env.NODE_ENV !== 'production';

// Relax rate limits only in genuine non-production. Previously this also
// loosened limits whenever E2E_SEED_TOKEN was set — which meant a prod-mode
// host with a seed token configured ran auth endpoints at 10k/min, removing
// brute-force protection. Now the relaxed limit is strictly NODE_ENV-gated.
const devLimit = (limit: number, ttl: number) =>
  isDev
    ? { default: { limit: 10_000, ttl: 60_000 } }
    : { default: { limit, ttl } };

@Controller('auth')
// Rate limiting is applied by the global FlyThrottlerGuard (APP_GUARD); the
// per-route @Throttle() limits below define the strict auth limits it enforces.
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @Post('sign-up')
  @Throttle(devLimit(5, 900_000)) // 5 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async signUp(
    @Body() body: SignUpDto,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const result = await signUp(auth.api, {
      email: body.email,
      password: body.password,
      name: body.name,
      captchaToken: body.captchaToken,
    });
    if (!result.success) {
      this.logger.warn(`Sign-up failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    setSessionCookie(res, result.data.session.token);

    // Only mobile clients get the token in the body — web uses the HttpOnly
    // cookie set above.
    return res.status(HttpStatus.CREATED).json({
      user: result.data.user,
      ...(isMobile && { token: result.data.session.token }),
    });
  }

  @Post('sign-in')
  @Throttle(devLimit(30, 900_000)) // 30 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async signIn(
    @Body() body: SignInDto,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const { email, password } = body;
    const result = await signIn(auth.api, { email, password });
    if (!result.success) {
      this.logger.warn(`Sign-in failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    if (result.data.twoFactorRequired) {
      const { setCookieHeaders } = result.data;
      return sendTwoFactorChallenge(res, setCookieHeaders, isMobile);
    }

    setSessionCookie(res, result.data.session.token);
    return res.status(HttpStatus.OK).json({
      user: result.data.user,
      ...(isMobile && { token: result.data.session.token }),
    });
  }

  @Post('sign-out')
  async signOut(
    @SessionCookie() sessionToken: string | undefined,
    @Res() res: Response
  ) {
    if (sessionToken) {
      await signOut(auth.api, { sessionToken });
    }

    clearSessionCookie(res);

    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Get('session')
  @Throttle(devLimit(120, 60_000)) // 120 per minute — SSR hits this every nav
  async getSession(
    @SessionCookie() sessionToken: string | undefined,
    @Res() res: Response
  ) {
    if (!sessionToken) {
      return res.status(HttpStatus.OK).json(ANONYMOUS_SESSION_PAYLOAD);
    }

    const result = await getSession(auth.api, { sessionToken });
    if (!result.success) {
      // Session invalid/expired — clear the cookie and answer anonymously.
      clearSessionCookie(res);
      return res.status(HttpStatus.OK).json(ANONYMOUS_SESSION_PAYLOAD);
    }

    return res.status(HttpStatus.OK).json(buildSessionPayload(result.data));
  }

  @Get('verify-email')
  async verifyEmailGet(@Query('token') token: string, @Res() res: Response) {
    // Redirect to frontend verify-email page with token
    // Frontend will handle the verification via POST API call.
    // The dashboard route lives on the app subdomain, not www (marketing).
    const appUrl = authEnv.APP_URL ?? authEnv.WEB_URL;
    const redirectUrl = new URL('/verify-email', appUrl);

    if (token) {
      redirectUrl.searchParams.set('token', token);
    }

    return res.redirect(redirectUrl.toString());
  }

  @Post('verify-email')
  @UsePipes(new ValidationPipe({ transform: true }))
  async verifyEmailPost(@Body() body: VerifyEmailDto, @Res() res: Response) {
    const result = await verifyEmail(auth.api, { token: body.token });

    if (!result.success) {
      this.logger.warn(`Email verification failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    // Set session cookie if auto-sign-in created a session
    // This happens when autoSignInAfterVerification is enabled in Better Auth
    if (result.data.sessionToken) {
      this.logger.log('Setting session cookie from verify-email response');
      setSessionCookie(res, result.data.sessionToken);
    }

    return res.status(HttpStatus.OK).json({
      user: result.data.user,
      verified: true,
    });
  }

  @Post('resend-verification')
  @Throttle(devLimit(3, 900_000)) // 3 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async resendVerificationEmail(
    @Body() body: ResendVerificationDto,
    @Res() res: Response
  ) {
    const result = await resendVerification(auth.api, {
      email: body.email,
      callbackURL: body.callbackURL ?? '/welcome',
    });

    if (!result.success) {
      this.logger.warn(`Resend verification failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.status(HttpStatus.OK).json({
      success: result.data.success,
      message: result.data.message,
    });
  }

  @Get('google')
  async googleSignIn(@Query() query: GoogleSignInDto, @Res() res: Response) {
    const result = await googleSignIn(auth.api, {
      callbackURL: query.callbackURL ?? '/dashboard',
      errorCallbackURL: query.errorCallbackURL,
      newUserCallbackURL: query.newUserCallbackURL,
    });

    if (!result.success) {
      this.logger.warn(`Google sign-in failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.redirect(result.data.url);
  }

  @Get('google/sign-up')
  async googleSignUp(@Query() query: GoogleSignUpDto, @Res() res: Response) {
    const result = await googleSignUp(auth.api, {
      callbackURL: query.callbackURL ?? '/welcome',
      errorCallbackURL: query.errorCallbackURL,
    });

    if (!result.success) {
      this.logger.warn(`Google sign-up failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.redirect(result.data.url);
  }

  @Post('apple/native')
  @UsePipes(new ValidationPipe({ transform: true }))
  async appleNativeSignIn(
    @Body() body: AppleNativeSignInDto,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const result = await appleNativeSignIn(auth.api, {
      identityToken: body.identityToken,
      fullName: body.fullName,
    });
    if (!result.success) {
      this.logger.warn(`Apple native sign-in failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    setSessionCookie(res, result.data.session.token);

    return res.status(HttpStatus.OK).json({
      user: result.data.user,
      ...(isMobile && { token: result.data.session.token }),
    });
  }

  @Post('forgot-password')
  @Throttle(devLimit(5, 900_000)) // 5 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async forgotPassword(@Body() body: ForgotPasswordDto, @Res() res: Response) {
    const result = await forgotPassword(auth.api, {
      email: body.email,
      redirectTo: body.redirectTo,
    });

    // Always return 200 to prevent email enumeration
    if (!result.success) {
      return res.status(HttpStatus.OK).json({ success: true });
    }

    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('reset-password')
  @Throttle(devLimit(5, 900_000)) // 5 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async resetPassword(@Body() body: ResetPasswordDto, @Res() res: Response) {
    const result = await resetPassword(auth.api, {
      token: body.token,
      newPassword: body.newPassword,
    });

    if (!result.success) {
      this.logger.warn(`Password reset failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('change-password')
  @Throttle(devLimit(5, 900_000)) // 5 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async changePassword(
    @Body() body: ChangePasswordDto,
    @SessionCookie() sessionToken: string | undefined,
    @Res() res: Response
  ) {
    if (!sessionToken) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const input = {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      revokeOtherSessions: true,
    };
    const result = await changePassword(auth.api, input, sessionToken);
    if (!result.success) {
      this.logger.warn(`Password change failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      message: result.data.message,
    });
  }

  @Post('change-email')
  @Throttle(devLimit(3, 900_000)) // 3 per 15 min per IP
  @UsePipes(new ValidationPipe({ transform: true }))
  async changeEmail(
    @Body() body: ChangeEmailDto,
    @SessionCookie() sessionToken: string | undefined,
    @Res() res: Response
  ) {
    if (!sessionToken) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const result = await changeEmail(
      auth.api,
      { newEmail: body.newEmail },
      sessionToken
    );
    if (!result.success) {
      this.logger.warn(`Email change failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      message: result.data.message,
    });
  }

  @Post('two-factor/enable')
  @Throttle(devLimit(5, 900_000))
  @UsePipes(new ValidationPipe({ transform: true }))
  async enableTwoFactor(
    @Body() body: EnableTwoFactorDto,
    @SessionCookie() sessionToken: string | undefined,
    @Res() res: Response
  ) {
    if (!sessionToken) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const result = await enableTwoFactor(
      auth.api,
      { password: body.password },
      sessionToken
    );
    if (!result.success) throw this.mapErrorToHttpException(result.error);

    return res.status(HttpStatus.OK).json(result.data);
  }

  @Post('two-factor/verify-totp')
  @Throttle(devLimit(10, 900_000))
  @UsePipes(new ValidationPipe({ transform: true }))
  async verifyTotp(
    @Body() body: VerifyTotpDto,
    @RawCookieHeader() cookieHeader: string | undefined,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const result = await verifyTotp(auth.api, {
      code: body.code,
      trustDevice: body.trustDevice,
      twoFactorToken: body.twoFactorToken,
      cookieHeader,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);

    const { setCookieHeaders, user, token } = result.data;
    const sessionToken = applySessionSetCookies(res, setCookieHeaders);
    // Bearer clients can't use the cookie just set — hand back the raw token.
    const mobileToken = sessionToken ?? token;
    return res.status(HttpStatus.OK).json({
      verified: true,
      ...(user && { user }),
      ...(isMobile && mobileToken && { token: mobileToken }),
    });
  }

  private mapErrorToHttpException(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
