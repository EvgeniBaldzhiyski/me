import BaseModule from '../BaseModule';
import Meeting from '../../Meeting';
import {
  AttendeeLeftEvent,
  AttendeeJoinSuccessEvent,
  SessionInitEvent,
  SessionCloseEvent
} from '../../events/SessionEvents';
import { Attendee, RestAPI, Roles, ServerConnectionAPI } from '@container/models';
import { snsPublish } from '../../../../utils/sns-publisher';


import {
  EventLogAdditionalData,
  EventLogAttendeeProps,
  EventLogSessionProps,
  EventPayload,
  EventProps,
  LogTriggerAction,
  LogTriggerType
} from './event-log-types';
import { coreApi } from '../../../../utils/coreApiClient';
import serverConfig from '../../../../utils/serverConfig';
import { combineLatest, defer, EMPTY, from, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import apm from 'elastic-apm-node/start';
import { MessageAttributeMap } from 'aws-sdk/clients/sns';
import { retryBackoff } from 'backoff-rxjs';
import {
  ActiveMeetingEvent,
  ActiveMeetingEventPayload,
  AttendeeEventBaseData,
  MeetingEventBaseData
} from '../../kafka/fa-event-types';
import uuid from 'uuid';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import KafkaUtils from '../../kafka/kafka-utils';

export default class EventLogModule extends BaseModule {

  private sessionPropsAndAdditionalData$: Observable<EventLogSessionProps & EventLogAdditionalData> = combineLatest([
    // Get and store the Session properties as EventLogSessionProps as soon as they are available,
    // so we keep them stored in this Observable even when the MeetingRun is destroyed :)
    defer(() =>
      of<EventLogSessionProps>({
        CompanyID: this.inst.model.sessionSettings.companyId,
        SessionID: this.inst.model.meetingID,
        SessionRunID: this.inst.model.meetingRunID,
        HostID: this.inst.model.sessionSettings.hostID,
        SessionName: this.inst.model.sessionSettings.name
      })
    ),
    of('core-api request to get EventLogAdditionalData - this is just a simple text that is switchMap-ed to the proper data :)')
      .pipe(
        // NOTE: the `coreApi.get()` is now a Cold Observable that is better as it is triggered on first need,
        //       also this way errors upon connection e.g. 404 and such
        //       are not producing `UNHANDLED EMERGENCY ERROR: Request failed with status code 404`!
        switchMap(() => coreApi.get<EventLogAdditionalData>(`${RestAPI.INSTRUMENTATION_LOG_INFO}/${encodeURIComponent(this.inst.model.meetingID)}`)),
        tap({
          next: _ =>
            this.logger.info('Event log - success requesting the EventLogAdditionalData'),
          error: _ =>
            this.logger.info('Event log - error when requesting the EventLogAdditionalData on this attempt, may be retried')
        }),
        retryBackoff({
          initialInterval: 1000,
          maxRetries: 12,
          // 👇 resets retries count and delays between them to init values
          resetOnSuccess: true
        }),
        map(
          // the data comes `camelCase` and we need it `PascalCase`
          ({ data }) => Object.entries(data).reduce(
            (PascalCaseData, [k, v]) => {
              PascalCaseData[k.charAt(0).toUpperCase() + k.slice(1)] = v;
              return PascalCaseData;
            },
            {} as EventLogAdditionalData
          )
        )
      )
  ])
    .pipe(
      map(([sessionProps, sessionAdditionalProps]) => ({
        ...sessionProps,
        ...sessionAdditionalProps
      })),
      shareReplay(1)
    );

  /**
   * Cached reference to the logger of this Meeting instance
   * as some of the actions may happen after the instance is gone
   * @private
   */
  private logger = this.inst.logger;

  constructor(protected inst: Meeting) {
    super(inst);
    this.inst.updateEngine.registerApprover(this);

    this.inst.eventBus.on(SessionInitEvent.type, _ => this.onSessionInit());
    this.inst.eventBus.on(SessionCloseEvent.type,({sessionRunDuration, maxAttendeesInRun}) => this.onSessionClose(sessionRunDuration, maxAttendeesInRun));
    this.inst.eventBus.on(AttendeeJoinSuccessEvent.type, (att: Attendee, isRejoin: boolean) => this.onAttendeeJoin(att, isRejoin));

    this.inst.eventBus.on(AttendeeLeftEvent.type,
      ({ attendee, time, durationInRun }) => this.onAttendeeLeave(attendee, time, durationInRun));
    this.inst.server.onSocket(
      ServerConnectionAPI.ATT_LEFT_AUTO_ROOM_CHECK,
      (client, attId: string) => this.onAttendeeAutomaticRoomCheck(attId)
    );
    this.inst.server.onSocket(
      ServerConnectionAPI.ATT_LEFT_MANUAL_ROOM_CHECK,
      (client, attId: string) => this.onAttendeeManualRoomCheck(attId)
    );
  }

  approveAttendeeChange(client, id, data, done) {
    const attendee: Attendee = this.inst.model.attendeesIndex[id];
    if (data.hasOwnProperty('isAway')) {
      if (data.isAway) {
        this.onAttendeeStepAway(attendee);
      } else {
        this.onAttendeeReturn(attendee);
      }
    }
    if (data.hasOwnProperty('kickedOut')) {
      this.onAttendeeKickOff(attendee, data.kickedOut);
    }
    done(data);
  }

  private getAttendeeProperties(attendee: Attendee): EventLogAttendeeProps {
    return {
      AttID: attendee.id,
      AttFirstName: attendee.firstName,
      AttLastName: attendee.lastName,
      AttEmail: attendee.email,
      EventRole: attendee.role,
      ExternalAttID: attendee.externalAttID
    };
  }

  private getServerDateTime(ts?: Date | number) {
    return {
      ServerDateTime: (ts ? new Date(ts) : new Date()).toUTCString()
    };
  }

  private getDateTimestamp(ts?: Date | number) {
    return (ts ? new Date(ts) : new Date()).getTime();
  }

  private onSessionInit() {
    const id = uuid();
    const kEvent = this.createKafkaMeetingEvent('MeetingStart', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model));
    publishKafkaEvent(kEvent, this.inst.model.meetingID);
  }

  private onSessionClose(sessionRunDuration: number, maxAttendeesInRun: number) {
    const id = uuid();
    const kEvent = this.createKafkaMeetingEvent('MeetingEnd', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model, sessionRunDuration, maxAttendeesInRun));
    publishKafkaEvent(kEvent, this.inst.model.meetingID);
  }

  private onAttendeeJoin(attendee: Attendee, isRejoin: boolean) {
    const id = uuid(); // todo - use it in SNS, too
    const now = new Date(); // in order to send the same date for SNS and Kafka
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Meeting,
      EventAction: LogTriggerAction.Enter,
      LogMessage: ''
    }, now);

    const kEvent = this.createKafkaMeetingEvent('AttendeeJoinMeeting', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model), KafkaUtils.getAttendeePropertiesForKafka(attendee, 0, isRejoin), now);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private onAttendeeStepAway(attendee: Attendee) {
    const id = uuid(); // todo - use it in SNS, too
    const now = new Date(); // in order to send the same date for SNS and Kafka
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Meeting,
      EventAction: LogTriggerAction.StepAway,
      LogMessage: ''
    }, now);

    const durationInRun = attendee.joinedAt == null ? 0 : (now.getTime() - attendee.joinedAt) / 1000;
    const kEvent = this.createKafkaMeetingEvent('AttendeeStepAway', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model), KafkaUtils.getAttendeePropertiesForKafka(attendee, durationInRun), now);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private onAttendeeReturn(attendee: Attendee) {
    const id = uuid(); // todo - use it in SNS, too
    const now = new Date(); // in order to send the same date for SNS and Kafka
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Meeting,
      EventAction: LogTriggerAction.GoBack,
      LogMessage: ''
    }, now);

    const durationInRun = attendee.joinedAt == null ? 0 : (now.getTime() - attendee.joinedAt) / 1000;
    const kEvent = this.createKafkaMeetingEvent('AttendeeGoBack', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model), KafkaUtils.getAttendeePropertiesForKafka(attendee, durationInRun), now);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private onAttendeeLeave(attendee: Attendee, ts: Date | number, durationInRun: number) {
    const id = uuid(); // todo - use it in SNS, too
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Meeting,
      EventAction: LogTriggerAction.Leave,
      LogMessage: ''
    }, ts);

    const kEvent = this.createKafkaMeetingEvent('AttendeeLeaveMeeting', id, KafkaUtils.getMeetingPropertiesForKafka(this.inst.model), KafkaUtils.getAttendeePropertiesForKafka(attendee, durationInRun), ts);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private onAttendeeKickOff(attendee: Attendee, reason: string) {
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Attendee,
      EventAction: LogTriggerAction.KickOff,
      LogMessage: reason
    });

    // RTA kafka event is produced in AttendeeModule
  }

  private onAttendeeManualRoomCheck(attendeeId: string) {
    const attendee = this.inst.model.attendeesIndex[attendeeId];
    const reason = 'CHECK_ROOM';
    this.publishEvent({
      ...this.getAttendeeProperties(attendee),
      EventType: LogTriggerType.Room,
      EventAction: LogTriggerAction.KickOff,
      LogMessage: reason
    });

    const kEvent = this.createKafkaRoomCheckKickoutEvent(attendee, LogTriggerType.Room, reason);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private onAttendeeAutomaticRoomCheck(attendeeId: string) {
    const attendee = this.inst.model.attendeesIndex[attendeeId];
    const reason = 'CHECK_ROOM_SCHEDULED';
    this.publishEvent({
      ...this.getAttendeeProperties(this.inst.model.attendeesIndex[attendeeId]),
      EventType: LogTriggerType.Timeout,
      EventAction: LogTriggerAction.KickOff,
      LogMessage: reason
    });

    const kEvent = this.createKafkaRoomCheckKickoutEvent(attendee, LogTriggerType.Timeout, reason);
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  private publishEvent(eventProps: EventProps, ts?: Date | number): void {
    if (eventProps.EventRole && eventProps.EventRole === Roles.GHOST) {
      this.logger.debug(`Event log is skipping log for a Bot, an event with payload ${JSON.stringify(eventProps)} was going to be published. Response: n/a`);
      return;
    }

    const partialPayload: Partial<EventPayload> = {
      ...eventProps,
      ...this.getServerDateTime(ts)
    };

    this.sessionPropsAndAdditionalData$.pipe(
      catchError(err => {
        apm.captureError(err);
        this.logger.error(`Error while fetching instrumentation log data and trying to send given payload. ${err.message}`);
        return EMPTY;
      }),
      map((data: EventLogAdditionalData) => {
        const payload = { ...data, ...partialPayload } as EventPayload;
        return {
          message: JSON.stringify(payload),
          // We need some of the fields as part of SNS MessageAttributesMap
          // @see #J5-6079 - [BUG]  CompanyID Needs to be a key-value pair in the Attribute section of the SNS message
          //      of the new Application Event Log used for the new Distribution Paths for Instrumentation Data
          messageAttributes: {
            CompanyID: {
              DataType: 'String',
              StringValue: payload.CompanyID
            },
            SessionID: {
              DataType: 'String',
              StringValue: payload.SessionID
            },
            HostID: {
              DataType: 'String',
              StringValue: payload.HostID
            }
          } as MessageAttributeMap
        };
      }),
      switchMap(({ message, messageAttributes }) => {
        if (!serverConfig.CONFIG.enableEventLog) {
          this.logger.debug(`Event log is disabled, an event with payload ${message} was going to be published. Response: n/a`);
          return EMPTY;
        }
        return from(snsPublish(message, messageAttributes)).pipe(
          catchError(err => {
            apm.captureError(err);
            this.logger.error(`Failed publishing event log. ${err.message}`);
            return EMPTY;
          }),
          tap(_ => this.logger.debug(`Success publishing event log`))
        );
      })
    ).subscribe();
  }

  private createKafkaMeetingEvent(eventName: string, id:string, meeting: MeetingEventBaseData, attendee?: AttendeeEventBaseData, ts?: Date | number): ActiveMeetingEvent {
    const payload: ActiveMeetingEventPayload = {
      _id: id,
      ts: this.getDateTimestamp(ts),
      meeting: meeting,
      attendee: attendee
    }

    return new ActiveMeetingEvent(eventName, payload);
  }

  private createKafkaRoomCheckKickoutEvent(attendee: Attendee, checkType: string, reason: string, isBanned: boolean = false): ActiveMeetingEvent {
    const payload: ActiveMeetingEventPayload = {
      _id: uuid(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingPropertiesForKafka(this.inst.model),
      attendee: KafkaUtils.getAttendeePropertiesForKafka(attendee),
      roomCheck: {checkType, reason, isBanned}
    }

    return new ActiveMeetingEvent('RoomCheckKickout', payload);
  }
}
