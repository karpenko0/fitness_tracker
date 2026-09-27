import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { ProgressPhotoService } from './progress-photo.service';
import { CreateProgressPhotoDto, UpdateProgressPhotoDto } from './dto/progress-photo.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthedRequest, pageOptions } from '../common/http/authed-request';

@Controller('api/v1/progress-photo')
@UseGuards(AuthGuard('jwt'))
export class ProgressPhotoController {
  constructor(private progressPhotoService: ProgressPhotoService) {}

  @Post()
  async create(@Request() req: AuthedRequest, @Body() dto: CreateProgressPhotoDto) {
    return this.progressPhotoService.create(req.user.userId, dto);
  }

  @Get()
  async findAll(@Request() req: AuthedRequest, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.progressPhotoService.findAll(req.user.userId, pageOptions(skip, take));
  }

  @Get(':id')
  async findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  async update(@Request() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateProgressPhotoDto) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  async remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    // Ensure the user owns the progress photo
    return this.progressPhotoService.remove(id, req.user.userId);
  }
}