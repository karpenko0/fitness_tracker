import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { OnboardingService } from './onboarding.service';
import { CompleteOnboardingDto, OptionsQueryDto, UpdateOnboardingDraftDto } from './dto/onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get('status') @ApiOperation({ summary: 'Get onboarding status and draft' })
  status(@GetCurrentUser() user: UserRequest) { return this.service.status(user.userId); }

  @Patch('draft') @Throttle({ default: { ttl: 60_000, limit: 30 } }) @ApiOperation({ summary: 'Save onboarding draft step' })
  update(@GetCurrentUser() user: UserRequest, @Body() dto: UpdateOnboardingDraftDto) { return this.service.updateDraft(user.userId, dto); }

  @Get('options') @ApiOperation({ summary: 'Get localized onboarding options' })
  options(@Query() query: OptionsQueryDto) { return this.service.options(query.locale); }

  @Get('recommendation-preview') @ApiOperation({ summary: 'Preview starter program recommendation' })
  preview(@GetCurrentUser() user: UserRequest) { return this.service.preview(user.userId); }

  @Post('complete') @HttpCode(HttpStatus.CREATED) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiOperation({ summary: 'Complete onboarding atomically' })
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  complete(@GetCurrentUser() user: UserRequest, @Body() dto: CompleteOnboardingDto, @Headers('idempotency-key') key?: string) { return this.service.complete(user.userId, dto, key); }
}
