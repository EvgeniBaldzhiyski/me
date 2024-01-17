import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import apm from 'elastic-apm-node';
import BaseModule from './../BaseModule';
import Meeting from '../../Meeting';
import {
  Attendee,
  ClientConnectionAPI, PollAnswer,
  PollForRoom,
  PollForRooms, PollTemplate,
  RestAPI,
  ServerConnectionAPI
} from '@container/models';
import { AttendeeCommonData, QuickPollEvent, QuickPollEventPayload, QuickPollInfo } from '../../kafka/fa-event-types';
import uuid from 'uuid';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import KafkaUtils from '../../kafka/kafka-utils';
import { coreApiObservable } from '../../../../utils/coreApiClient';
import { of } from 'rxjs'
import { catchError } from 'rxjs/operators';

export default class InstantPollModule extends BaseModule {

  private pollForRooms: PollForRooms = {};
  private testRoomLogMessage = 'Unexpected Action in InstantPollModule for Test Room.';

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.server.onSocket(ServerConnectionAPI.POLL_INIT_DATA,
      (client, data) => this.initPollData(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.POLL_START,
      (client, data) => this.startPoll(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.POLL_END,
      (client, data) => this.endPoll(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.POLL_SEND_ANSWER,
      (client, data) => this.pollAnswer(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.POLL_DELETE_LOCAL,
      (client, data) => this.deleteLocalPoll(client, data)
    );

    this.inst.updateEngine.registerApprover(this);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private initPollData(client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const attendeeRoomID = attendee.room;
    if (this.inst.roomEngine.getRoomById(attendeeRoomID).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const pollForRoom = this.pollForRooms.hasOwnProperty(attendeeRoomID);
    let pollData: PollForRoom;

    pollData = pollForRoom ? this.pollForRooms[attendeeRoomID] : null;

    if (!pollData) {
      return;
    }

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.POLL_INIT_DATA, pollData);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private startPoll(client, data: PollTemplate) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const roomID = attendee.room;
    if (this.inst.roomEngine.getRoomById(roomID).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const pollTemplate: PollTemplate = data;
    const senderID = attendee.id;

    if (!this.havePermissions(attendee) || this.pollForRooms[roomID]) {
      return;
    }

    this.pollForRooms[roomID] = {
      id: pollTemplate.questionId,
      pollName: pollTemplate.name,
      pollQuestion: pollTemplate.question,
      options: pollTemplate.options,
      userAnswers: {},
      pollInitiator: senderID,
      pollRunId: pollTemplate.pollRunId
    };

    const pollForRoom: PollForRoom = this.pollForRooms[roomID];
    this.inst.server.sendTo(ClientConnectionAPI.POLL_START, { pollForRoom, roomID });

    const kEvent = this.createKafkaQuickPollEvent('QuickPollStart',
      KafkaUtils.getAttendeeCommonData(attendee),
      roomID,
      KafkaUtils.getQuickPollInfo(pollForRoom),
      undefined,
      KafkaUtils.getAttendeesCount(this.inst.model.attendeesIndex, roomID, senderID)
    );
    publishKafkaEvent(kEvent, this.inst.model.meetingID, attendee.role);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private endPoll(client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const attendeeID = attendee.id;
    const roomID = attendee.room;
    if (this.inst.roomEngine.getRoomById(roomID).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const pollForRoom = this.pollForRooms[roomID];
    const pollInitiator = pollForRoom.pollInitiator;
    if (pollForRoom && pollInitiator === attendee.id) {
      const questionId = pollForRoom.id;
      let answers = [];
      Object.keys(pollForRoom.userAnswers).forEach((meetingAttendeeId) => {
        const pollAnswer = pollForRoom.userAnswers[meetingAttendeeId];
        const option = pollForRoom.options.find((opt) => (opt.answer === pollAnswer.answer));
        answers.push({meetingAttendeeId, answerId: option.answerId, answeredOn: pollAnswer.answeredOn});
      });

      // keep a reference to the logger in case the HTTP request finishes after the Module is destroyed
      const logger = this.inst.logger;
      coreApiObservable
      .post(`${RestAPI.INSTANT_POLLS}/${encodeURIComponent(questionId)}/answers`, {
        pollRunId: pollForRoom.pollRunId,
        answers,
      })
      .pipe(
        catchError((err: any) => {
          err.message = 'Failed saving Polls Answers: ' + err.message;
          apm.captureError(err);
          logger.error(err);
          return of(null);
        })
      )
      .subscribe();

    }

    const deleteData = { ...data, roomID };

    if ((pollInitiator && attendeeID !== pollInitiator) ||
      !this.pollForRooms[roomID]) {
      return;
    }

    delete this.pollForRooms[roomID];

    this.inst.server.sendTo(ClientConnectionAPI.POLL_END, deleteData);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private pollAnswer(client, data) {
    const answerSender: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!answerSender) {
      return;
    }

    if (this.inst.roomEngine.getRoomById(answerSender.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.pollForRooms[answerSender.room] ||
      this.pollForRooms[answerSender.room].options[answerSender.id]) {
      return;
    }

    const pollAnswer: PollAnswer = {
      answerSenderID: answerSender.id,
      name: answerSender.fullName,
      answer: data,
      answeredOn: new Date()
    };

    this.pollForRooms[answerSender.room].userAnswers[answerSender.id] = pollAnswer;
    this.inst.roomEngine.sendToRoom(answerSender.room, ClientConnectionAPI.POLL_SEND_ANSWER, pollAnswer);

    const kEvent = this.createKafkaQuickPollEvent('QuickPollSendAnswer',
      KafkaUtils.getAttendeeCommonData(answerSender),
      answerSender.room,
      KafkaUtils.getQuickPollInfo(this.pollForRooms[answerSender.room]),
      pollAnswer.answer
    );
    publishKafkaEvent(kEvent, this.inst.model.meetingID, answerSender.role);
  }

  havePermissions(attendee) {
    const roomID = attendee.room;
    return this.inst.roomEngine.isRoomPresenter(attendee, roomID);
  }

  @ApmSpan()
  approveAttendeeChange(client, id, data, done) {
    this.manageChangeRoleOrLeave(client, id, data);
    this.manageChangeRoom(client, id, data);

    done(data);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private deleteLocalPoll(client, data) {
    this.inst.server.sendTo(ClientConnectionAPI.POLL_DELETE_LOCAL, data);
  }

  @ApmSpan()
  manageChangeRoleOrLeave(client, id, data) {
    if ((data.hasOwnProperty('hasBaton') && !data.hasBaton) || data.left) {
      const affectedAttendee: Attendee = this.inst.model.attendeesIndex[id];
      const affectedRoomID = affectedAttendee.room;

      // there is running poll in the room AND affectedAttendee is the initiator => send END POLL command
      if (this.pollForRooms[affectedRoomID] && this.pollForRooms[affectedRoomID].pollInitiator === id) {
        this.pollForRooms[affectedRoomID] = null;
        this.inst.server.sendTo(ClientConnectionAPI.POLL_END, {
          attendeeID: affectedAttendee.id,
          closeModal: true,
          roomID: affectedRoomID
        });
      }
    }
  }

  @ApmSpan()
  manageChangeRoom(client, id, data) {
    if (data.hasOwnProperty('room')) {
      const affectedAttendeeID = id;

      this.inst.sendToAttendee(affectedAttendeeID, ClientConnectionAPI.POLL_CLOSE_QUESTION_MODAL, true);

      Object.keys(this.pollForRooms).forEach((roomId) => {
        const pollForRoom: PollForRoom = this.pollForRooms[roomId];

        if (pollForRoom && pollForRoom.pollInitiator === affectedAttendeeID) {
          delete this.pollForRooms[roomId];
        }
      });
    }
  }

  private createKafkaQuickPollEvent(
    eventName: string,
    attendee: AttendeeCommonData,
    roomId: string,
    poll: QuickPollInfo,
    answer?: string,
    attendeesCount?: number
  ): QuickPollEvent {
    const payload: QuickPollEventPayload = {
      _id: uuid(),
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model),
      attendee: attendee,
      roomId: roomId,
      attendeesCount: attendeesCount,
      poll: poll,
      answer: answer
    };

    return new QuickPollEvent(eventName, payload);
  }
}
