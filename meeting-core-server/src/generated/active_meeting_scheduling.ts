/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable } from "rxjs";

export const protobufPackage = "ActiveMeetingSchedulingController";

export interface SchedulingParameters {
  sessionId: string;
}

export interface SchedulingResult {
  result: boolean;
}

export const ACTIVE_MEETING_SCHEDULING_CONTROLLER_PACKAGE_NAME = "ActiveMeetingSchedulingController";

export interface ActiveMeetingSchedulingServiceClient {
  schedule(request: SchedulingParameters): Observable<SchedulingResult>;
}

export interface ActiveMeetingSchedulingServiceController {
  schedule(request: SchedulingParameters): Observable<SchedulingResult>;
}

export function ActiveMeetingSchedulingServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = ["schedule"];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcMethod("ActiveMeetingSchedulingService", method)(constructor.prototype[method], method, descriptor);
    }
    const grpcStreamMethods: string[] = [];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcStreamMethod("ActiveMeetingSchedulingService", method)(constructor.prototype[method], method, descriptor);
    }
  };
}

export const ACTIVE_MEETING_SCHEDULING_SERVICE_NAME = "ActiveMeetingSchedulingService";
