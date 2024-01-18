import config from 'config';

export enum TranscribeState  {
  Start,
  Stop
}

export class StartTranscribePayload {
  constructor(
    public CompanyId: string,
    public MeetingId: string,
    public RoomId: string,
    public MeetingRunId: string,
    public StartedDateTime: number) {
  }
}

export class StopTranscribePayload {
  constructor(
    public CompanyId: string,
    public MeetingId: string,
    public RoomId: string,
    public MeetingRunId: string,
    public DurationInSeconds: number,
    public EndedDateTime: number) {
  }
}

export class TranscribeActionMessage {
  constructor(
    public State: TranscribeState,
    public TranscribeRunId: string,
    public Payload: StartTranscribePayload | StopTranscribePayload) {
  }

  getKafkaTopic(): string {
    return `${config.get('kafka.topicsPrefix')}-${config.get('kafka.transcribeTopic')}`;
  }
}
