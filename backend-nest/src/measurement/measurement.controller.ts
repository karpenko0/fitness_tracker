import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { CreateMeasurementDto, UpdateMeasurementDto } from './dto/measurement.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthedRequest, pageOptions } from '../common/http/authed-request';

@Controller('api/v1/measurement')
@UseGuards(AuthGuard('jwt'))
export class MeasurementController {
  constructor(private measurementService: MeasurementService) {}

  @Post()
  async create(@Request() req: AuthedRequest, @Body() dto: CreateMeasurementDto) {
    return this.measurementService.create(req.user.userId, dto);
  }

  @Get()
  async findAll(@Request() req: AuthedRequest, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.measurementService.findAll(req.user.userId, pageOptions(skip, take));
  }

  @Get(':id')
  async findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    // Ensure the user owns the measurement
    return this.measurementService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  async update(@Request() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateMeasurementDto) {
    // Ensure the user owns the measurement
    return this.measurementService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  async remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    // Ensure the user owns the measurement
    return this.measurementService.remove(id, req.user.userId);
  }
}