import { RpcException } from "@nestjs/microservices";

export class ActiveMeetingException extends RpcException {
  constructor(msg) {
    super(msg);
  }
}
