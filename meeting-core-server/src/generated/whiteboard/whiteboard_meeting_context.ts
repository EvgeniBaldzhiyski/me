/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from "@nestjs/microservices";
import { Observable } from "rxjs";
import { ErrorResponse } from "../error";

export const protobufPackage = "WhiteboardMeetingContext";

export interface AttendeeInfoRequest {
  meetingId: string;
  attendeeId: string;
}

export interface AttendeeInfo {
  id: string;
  role: string;
  room: string;
  roomConfig: number;
  lockAnnotations: boolean;
  lockWhiteboard: boolean;
  lockAnnotationsEraser: boolean;
  lockWhiteboardEraser: boolean;
  allowAttendeesToChangeGroupWBPage: boolean;
}

export interface AttendeeInfoResponse {
  response?: AttendeeInfo | undefined;
  error?: ErrorResponse | undefined;
}

export interface UpdateAttendeeProperties {
  id: string;
  role?: string | undefined;
  lockWhiteboard?: boolean | undefined;
  lockAnnotations?: boolean | undefined;
}

export interface UpdateAttendeePropertiesResponse {
  response?: UpdateAttendeeProperties | undefined;
  error?: ErrorResponse | undefined;
}

export interface MeetingRequest {
  meetingId: string;
}

export interface UpdateRoomProperties {
  meetingId: string;
  roomId: string;
  wbType: number;
  properties: UpdateRoomProperties_Properties | undefined;
}

export interface UpdateRoomProperties_Properties {
  lockWhiteboard?: boolean | undefined;
  lockAnnotations?: boolean | undefined;
  lockAnnotationsEraser?: boolean | undefined;
  lockWhiteboardEraser?: boolean | undefined;
  allowAttendeesToChangeGroupWBPage?: boolean | undefined;
}

export interface UpdateRoomPropertiesResponse {
  response?: UpdateRoomProperties | undefined;
  error?: ErrorResponse | undefined;
}

export const WHITEBOARD_MEETING_CONTEXT_PACKAGE_NAME = "WhiteboardMeetingContext";

export interface WhiteboardMeetingContextServiceClient {
  getAttendeeInfo(request: AttendeeInfoRequest): Observable<AttendeeInfoResponse>;

  updatePropertiesForAttendee(request: MeetingRequest): Observable<UpdateAttendeePropertiesResponse>;

  updatePropertiesForRoom(request: MeetingRequest): Observable<UpdateRoomPropertiesResponse>;
}

export interface WhiteboardMeetingContextServiceController {
  getAttendeeInfo(request: AttendeeInfoRequest): Observable<AttendeeInfoResponse>;

  updatePropertiesForAttendee(request: MeetingRequest): Observable<UpdateAttendeePropertiesResponse>;

  updatePropertiesForRoom(request: MeetingRequest): Observable<UpdateRoomPropertiesResponse>;
}

export function WhiteboardMeetingContextServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = ["getAttendeeInfo", "updatePropertiesForAttendee", "updatePropertiesForRoom"];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcMethod("WhiteboardMeetingContextService", method)(constructor.prototype[method], method, descriptor);
    }
    const grpcStreamMethods: string[] = [];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(constructor.prototype, method);
      GrpcStreamMethod("WhiteboardMeetingContextService", method)(constructor.prototype[method], method, descriptor);
    }
  };
}

export const WHITEBOARD_MEETING_CONTEXT_SERVICE_NAME = "WhiteboardMeetingContextService";
