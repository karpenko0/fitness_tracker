import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Клиент создаётся при инициализации DI-контейнера, а не при импорте модуля:
 * импорт AppModule (например, в тестах метаданных) не должен поднимать движок Prisma и соединения.
 */
@Injectable()
class PrismaLifecycle implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaClient) {}
  async onModuleDestroy() {
    await this.prisma.$disconnect().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [{ provide: PrismaClient, useFactory: () => new PrismaClient() }, PrismaLifecycle],
  exports: [PrismaClient],
})
export class PrismaModule {}
