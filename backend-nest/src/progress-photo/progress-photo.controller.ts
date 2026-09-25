import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards, Request } from '@nestjs/common';
import { ProgressPhotoService } from './progress-photo.service';
import { CreateProgressPhotoDto, UpdateProgressPhotoDto } from './dto/progress-photo.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('api/v1/progress-photo')
@UseGuards(AuthGuard('jwt'))
export class ProgressPhotoController {
  constructor(private progressPhotoService: ProgressPhotoService) {}

  @Post()
  async create(@Request() req: any, @Body() dto: CreateProgressPhotoDto) {
    return this.progressPhotoService.create(req.user.userId, dto);
  }

  @Get()
  async findAll(@Request() req: any) {
    return this.progressPhotoService.findAll(req.user.userId);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateProgressPhotoDto) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.remove(id, req.user.userId);
  }
}