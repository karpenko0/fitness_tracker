import { Body, Controller, Delete, Get, Patch, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserRequest } from '../common/interfaces/user-request.interface';

@ApiTags('me')
@Controller('api/v1/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user and profile' })
  async getMe(@GetCurrentUser() user: UserRequest) {
    return this.userService.getMe(user.userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update own profile' })
  async updateProfile(@GetCurrentUser() user: UserRequest, @Body() body: UpdateProfileDto) {
    return this.userService.updateProfile(user.userId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own account' })
  async deleteAccount(@GetCurrentUser() user: UserRequest, @Body('confirmation') confirmation: string) {
    await this.userService.deleteAccount(user.userId, confirmation);
  }
}
