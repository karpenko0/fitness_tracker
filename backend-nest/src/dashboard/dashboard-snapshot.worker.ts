import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DashboardSnapshotService } from './dashboard-snapshot.service';

@Injectable()
export class DashboardSnapshotWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly snapshots: DashboardSnapshotService) {}
  onModuleInit() { this.timer = setInterval(() => void this.snapshots.expire(), 60_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
