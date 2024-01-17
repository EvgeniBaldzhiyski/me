/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable } from "rxjs";
import { ErrorResponse } from "./error";

export const protobufPackage = "ActiveMeetingContext";

export interface MeetingId {
  meetingId: string;
}

export interface SessionCloseResponse {
  response?: MeetingId | undefined;
  error?: ErrorResponse | undefined;
}

export interface RoomResponse {
  meetingId: string;
  roomId: string;
}

export interface RemoveRoomResponse {
  response?: RoomResponse | undefined;
  error?: ErrorResponse | undefined;
}

export interface ClonedRoom {
  meetingId: string;
  roomIds: string[];
}

export interface ClonedRoomResponse {
  response?: ClonedRoom | undefined;
  error?: ErrorResponse | undefined;
}

export const ACTIVE_MEETING_CONTEXT_PACKAGE_NAME = "ActiveMeetingContext";

export interface ActiveMeetingContextServiceClient {
  removeRoom(request: MeetingId): Observable<RemoveRoomResponse>;

  sessionClose(request: MeetingId): Observable<SessionCloseResponse>;

  createClonedMainRoom(request: MeetingId): Observable<ClonedRoomResponse>;
}

export interface ActiveMeetingContextServiceController {
  removeRoom(request: MeetingId): Observable<RemoveRoomResponse>;

  sessionClose(request: MeetingId): Observable<SessionCloseResponse>;

  createClonedMainRoom(request: MeetingId): Observable<ClonedRoomResponse>;
}

export function ActiveMeetingContextServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = ["removeRoom", "sessionClose", "createClonedMainRoom"];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcMethod("ActiveMeetingContextService", method)(constructor.prototype[method], method, descriptor);
    }
    const grpcStreamMethods: string[] = [];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcStreamMethod("ActiveMeetingContextService", method)(constructor.prototype[method], method, descriptor);
    }
  };
}

export const ACTIVE_MEETING_CONTEXT_SERVICE_NAME = "ActiveMeetingContextService";
