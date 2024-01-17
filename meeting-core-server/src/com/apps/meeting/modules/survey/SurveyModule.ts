import {
  Attendee,
  ClientConnectionAPI, LockedSurvey,
  Room,
  ServerConnectionAPI
} from '@container/models';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import Meeting from '../../Meeting';
import BaseModule from './../BaseModule';
import { AttendeeCommonData, PollAnswer, PollEvent, PollEventNames, PollEventPayload, PollInfo } from '../../kafka/fa-event-types';
import uuid from 'uuid';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import KafkaUtils from '../../kafka/kafka-utils';

export default class SurveyModule extends BaseModule {

  private pollForRooms = {};
  private lockedPolls: Map<LockedSurvey['id'], LockedSurvey> = new Map();
  private testRoomLogMessage = 'Unexpected Action in InstantPollModule for Test Room. Method ';

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.server.onSocket(ServerConnectionAPI.RELEASE_SURVEY, (client, data) => this.releaseSurvey(client, data));

    this.inst.server.onSocket(ServerConnectionAPI.COMPLETE_SURVEY, (client, data) => this.completeSurvey(client, data));

    this.inst.server.onSocket(ServerConnectionAPI.INSTANT_POLL_START, (client, data) => this.startInstantPoll(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.INSTANT_POLL_END, (client, data) => this.endInstantPoll(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.INSTANT_POLL_INIT, (client, data) => this.initPollData(client, data));

    this.inst.server.onSocket(ServerConnectionAPI.CREATE_SURVEY, (client, data) => this.createSurvey(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.EDIT_SURVEY, (client, data) => this.editSurvey(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.DELETE_SURVEY, (client, data) => this.deleteSurvey(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.POLL_SET_LOCK, (client, data) => this.setInstantPollLock(client, data));
    this.inst.server.onSocket(ServerConnectionAPI.POLL_GET_LOCK, (client, data) => this.getInstantPollLock(client, data));

    this.inst.updateEngine.registerApprover(this);

  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private releaseSurvey(client, data: { survey, popToTop: boolean }) {
    const a: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!this.inst.roomEngine.isRoomPresenter(a, a.room)) {
      return;
    }

    this.inst.roomEngine.sendToRoom(a.room, ClientConnectionAPI.RELEASE_SURVEY, data);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private createSurvey(client, newSurvey) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    this.inst.roomEngine.sendToRoom(attendee.room, ClientConnectionAPI.CREATE_SURVEY, newSurvey);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private editSurvey(client, data: { survey: object, oldSurveyId: string }) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    this.inst.server.sendTo(ClientConnectionAPI.EDIT_SURVEY, data);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private deleteSurvey(client, surveyId) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    this.inst.server.sendTo(ClientConnectionAPI.DELETE_SURVEY, surveyId);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private completeSurvey(client, data: { surveyId: string, result: object, points: number }) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }

    const roomId = attendee.room;
    const room = this.inst.roomEngine.getRoomById(roomId);
    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage + 'completeSurvey');
      return;
    }
    const pollForRoom = this.pollForRooms[roomId];
    if (pollForRoom && pollForRoom.id === data.surveyId) {
      this.pollForRooms[roomId].attResultsList[attendee.id] = data.result;
    }

    this.inst.server.sendTo(ClientConnectionAPI.COMPLETE_SURVEY, {
      ...data,
      attId: attendee.id,
      attFirstName: attendee.firstName,
      attLastName: attendee.lastName,
      attRole: attendee.role,
    });

    // assessments should not emit events
    if (!pollForRoom) {
      return;
    }
    const kEvent = this.createKafkaPollEvent(PollEventNames.POLL_SEND_ANSWER,
      KafkaUtils.getAttendeeCommonData(attendee),
      roomId,
      KafkaUtils.getPollInfo(this.pollForRooms[roomId]),
      KafkaUtils.getPollAnswers(data.result),
    );
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private setInstantPollLock(client, payload: Pick<LockedSurvey, 'id' | 'isLocked'>) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    const lockedPoll: LockedSurvey = { id: payload.id, isLocked: payload.isLocked, attendeeId: attendee.id };
    this.lockedPolls.set(payload.id, lockedPoll);
    this.inst.roomEngine.sendToMainPresenters(ClientConnectionAPI.POLL_GET_LOCK, lockedPoll);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private getInstantPollLock(client, {id}: Pick<LockedSurvey, 'id'>) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, attendee.room)) {
      return;
    }
    let poll = this.lockedPolls.get(id);

    if (!poll) {
      poll = {
        id,
        attendeeId: null,
        isLocked: false
      };
    }

    this.inst.roomEngine.sendToMainPresenters(ClientConnectionAPI.POLL_GET_LOCK, poll);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private startInstantPoll(client, poll) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }
    const roomId = attendee.room;
    const room = this.inst.roomEngine.getRoomById(roomId);
    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage + 'startInstantPoll');
      return;
    }

    if (!this.inst.roomEngine.isRoomPresenter(attendee, roomId)) {
      return;
    }

    this.pollForRooms[roomId] = {
      ...poll,
      attendeeId: attendee.id
    };

    this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.INSTANT_POLL_START, this.pollForRooms[roomId]);

    const kEvent = this.createKafkaPollEvent(PollEventNames.POLL_START,
      KafkaUtils.getAttendeeCommonData(attendee),
      roomId,
      KafkaUtils.getPollInfo(this.pollForRooms[roomId]),
      undefined,
      KafkaUtils.getAttendeesCount(this.inst.model.attendeesIndex, roomId, attendee.id)
    );
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);

  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private endInstantPoll(client, pollId) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }
    const roomId = attendee.room;
    const room = this.inst.roomEngine.getRoomById(roomId);
    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage + 'endInstantPoll');
      return;
    }

    const pollForRoom = this.pollForRooms[roomId];

    if (!pollForRoom || (pollForRoom && pollForRoom.attendeeId !== attendee.id)) {
      return;
    }
    delete this.pollForRooms[roomId];

    this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.INSTANT_POLL_END, {
      closeModal: false,
      pollInitiator: pollForRoom.attendeeId
    });
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private initPollData(client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      return;
    }
    const roomId = attendee.room;
    const room = this.inst.roomEngine.getRoomById(roomId);
    if (room && room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage + 'initPollData');
      return;
    }
    const pollForRoom = this.pollForRooms[roomId];

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.INSTANT_POLL_INIT, { hasRunningPoll: !!pollForRoom } );

    if (!pollForRoom) {
      return;
    }

    // do not show poll if attendee has already completed it
    if (pollForRoom && pollForRoom.attResultsList[attendee.id]) {
      return;
    }

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.INSTANT_POLL_START, pollForRoom);
  }

  @ApmSpan()
  approveAttendeeChange(client, id, data, done) {
    const attendee: Attendee = this.inst.model.attendeesIndex[id];
    const roomId = attendee.room;
    const pollForRoom = this.pollForRooms[roomId];

    if (data.room !== undefined) {
      // when poll initiator move to room, end the poll
      if (pollForRoom && attendee.id === pollForRoom.attendeeId) {
        delete this.pollForRooms[roomId];
        this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.INSTANT_POLL_END, {
          closeModal: true,
          pollInitiator: pollForRoom.attendeeId
        });
      }

      const newPollRoom = this.pollForRooms[data.room];
      // when attendee moves to new room with running poll
      if (newPollRoom && attendee.id !== newPollRoom.attendeeId && !newPollRoom.attResultsList[attendee.id]) {
        this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.INSTANT_POLL_START, newPollRoom);
      }
      if (!newPollRoom && pollForRoom)  {
        // attendee move from room with poll to room whithout poll
        this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.INSTANT_POLL_END, {
          closeModal: true,
          pollInitiator: pollForRoom.attendeeId
        });
      }

      this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.INSTANT_POLL_INIT, { hasRunningPoll: !!newPollRoom } );
    }

    if ((data.hasBaton !== undefined && !data.hasBaton) || data.left || data.kickedOut) {
      // get baton (user demoted) or attendee has left AND affectedAttendee is the initiator, end poll
      if (pollForRoom && attendee.id === pollForRoom.attendeeId) {
        delete this.pollForRooms[roomId];
        this.inst.roomEngine.sendToRoom(roomId, ClientConnectionAPI.INSTANT_POLL_END, {
          closeModal: true,
          pollInitiator: pollForRoom.attendeeId
        });
      }

      for (const [, lockedPoll] of this.lockedPolls) {
        if (lockedPoll.attendeeId === attendee.id) {
          this.lockedPolls.delete(lockedPoll.id);
          this.inst.roomEngine.sendToMainPresenters(ClientConnectionAPI.POLL_GET_LOCK, {
            ...lockedPoll,
            isLocked: false
          });
        }
      }
    }

    done(data);
  }

  private createKafkaPollEvent(
    eventName: PollEventNames,
    attendee: AttendeeCommonData,
    roomId: Room['id'],
    poll: PollInfo,
    answers?: PollAnswer[],
    attendeesCount?: number
  ): PollEvent {
    const payload: PollEventPayload = {
      _id: uuid(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model),
      attendee: attendee,
      roomId: roomId,
      attendeesCount: attendeesCount,
      poll: poll,
      answers: answers
    };

    return new PollEvent(eventName, payload);
  }
}
