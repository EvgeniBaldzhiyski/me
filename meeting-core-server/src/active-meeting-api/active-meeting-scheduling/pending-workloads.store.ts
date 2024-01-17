import { Injectable } from '@nestjs/common';
import Server from '../../com/utils/Server';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import config from 'config';
import { ServiceRegistry } from '../../com/apps/service-registrar/service-registry';

@Injectable()
export class PendingWorkloadsStore {
  private readonly autoDeregisterTime: number = config.get<number>('serviceRegistry.autoDeregisterTime') || 45;
  constructor(private readonly server: Server,
              private readonly schedulerRegistry: SchedulerRegistry) {
  }

  add(mid: string): void {
    const jobId = `${mid}-deregister`;
    const jobs = this.schedulerRegistry.getCronJobs();
    if (jobs.has(jobId)) {
      return;
    }

    const executionTime = new Date();
    executionTime.setSeconds(executionTime.getSeconds() + this.autoDeregisterTime);
    const job = new CronJob({
      cronTime: executionTime,
      onTick: async () => {
        if (!this.server.getAppInstanceByName('meeting', mid)) {
          await ServiceRegistry.deregisterMeetingInstance(mid);
          this.server.removeAllowedInstance(this.server.getAppInstanceId('meeting', mid));
        }
        this.schedulerRegistry.deleteCronJob(jobId);
      }
    });
    this.schedulerRegistry.addCronJob(jobId, job);
    job.start();

    this.server.addAllowedInstance(this.server.getAppInstanceId('meeting', mid));
  }
}
