import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { WorkoutCatalogService } from './workout-catalog.service';

@ApiTags('workout-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class WorkoutCatalogController {
  constructor(private readonly catalog: WorkoutCatalogService) {}

  @Get('workout-templates')
  templates(@GetCurrentUser() user: UserRequest) { return this.catalog.templates(user.userId); }

  @Post('workout-templates')
  createTemplate(@GetCurrentUser() user: UserRequest, @Body() body: any) { return this.catalog.createTemplate(user.userId, body); }

  @Post('admin/exercises')
  createExercise(@GetCurrentUser() user: UserRequest, @Body() body: any) {
    if (!user.roles.includes('SUPER_ADMIN')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'SUPER_ADMIN role is required' });
    return this.catalog.createExercise(user.userId, body);
  }
}
