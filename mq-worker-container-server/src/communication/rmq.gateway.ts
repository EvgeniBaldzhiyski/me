import config from 'config';
import { TaskConsumer, allActiveConnections, WorkerFactory } from '@jigsawinteractive/task-queue';

export class RmqGateway {
  private consumer: TaskConsumer;

  constructor(
    private workerFactory: WorkerFactory,
    handleDisconnect?: () => void
  ) {
    this.consumer = new TaskConsumer(
      config.get('rabbit'),
      {...config.get('taskQueue'), handleDisconnect},
      this.workerFactory
    );
  }

  startConsuming(): Promise<void> {
    return this.consumer.start();
  }

  stopConsuming(): Promise<void> {
    return this.consumer.gracefulStop();
  }

  get isWorking(): boolean {
    return allActiveConnections();
  }

  get capacity(): number {
    return this.consumer.capacity;
  }

  get totalCapacity(): number {
    return Number.parseInt(config.get('taskQueue.maxInFlight'), 10);
  }

  get load(): number {
    return this.totalCapacity - this.capacity;
  }

  get idle(): boolean {
    return this.load === 0;
  }
}
