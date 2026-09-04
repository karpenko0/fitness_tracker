import { Body, Controller, Get, Post, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Authorize with Telegram WebApp initData' })
  @ApiResponse({ status: 200, description: 'Authorized successfully' })
  async telegramLogin(@Body() body: TelegramAuthDto) {
    return this.authService.loginWithTelegram(body.initData);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout from current session' })
  async logout(@GetCurrentUser() user: UserRequest) {
    await this.authService.logout(user.sessionId, user.userId);
  }
}
