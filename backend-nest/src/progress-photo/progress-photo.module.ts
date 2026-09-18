import { Module } from '@nestjs/common';
import { ProgressPhotoService } from './progress-photo.service';
import { ProgressPhotoController } from './progress-photo.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProgressPhotoController],
  providers: [ProgressPhotoService],
})
export class ProgressPhotoModule {}