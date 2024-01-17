import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import { publishKafkaEvent } from '../../../../utils/kafka-publisher';
import BaseModule from "./../BaseModule";
import Meeting from "../../Meeting";
import { Attendee, ServerConnectionAPI, UpdateMessageData, Roles, FeedbackClearing, EmojisId } from '@container/models';
import { Socket } from '../../../../gateway/decorators/method.decorator';
import { client } from '../../../../gateway/decorators/argument.decorator';
import Client from '../../../../utils/Client';
import { FeedbackEvent, FeedbackEventPayload } from '../../kafka/fa-event-types';
import uuid from 'uuid';
import KafkaUtils from '../../kafka/kafka-utils';

// @todo revise the format data (attendee.emoji) that is sent with the model

export default class EmojisModule extends BaseModule {

  constructor(protected inst: Meeting) {
    super(inst);

    this.inst.updateEngine.registerApprover(this);
  }

  @Socket(ServerConnectionAPI.CLEAR_ALL_EMOJIS_FOR_ROOM)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private clearAllRoomEmojis(@client client: Client, { roomId }) {
    const sender = this.inst.model.attendeesIndex[client.data.aid];

    if (!sender) {
      return;
    }

    const room = this.inst.roomEngine.getRoomById(roomId);

    if (!room) {
      return;
    }

    const packs: UpdateMessageData[] = [];
    const attendees = this.inst.attendeeStorage.getAttendeeMapByRoomId(room.id);

    for (const [, attendee] of attendees) {

      if (!this.canClearFeedback(sender.id, attendee.id)) {
        continue;
      }

      if (attendee.emoji) {
        packs.push(new UpdateMessageData(attendee.id, { emoji: EmojisId.NO_EMOJI }));
      }
    }

    this.inst.updateEngine.updateAttendees(client, packs);
  }


  private canClearFeedback(senderId, targetId): boolean {
    const sender = this.inst.model.attendeesIndex[senderId];
    const target = this.inst.model.attendeesIndex[targetId];

    if (!sender || !target) {
      return false;
    }

    return (
      this.inst.roomEngine.isMainRoomPresenter(sender) ||
      (this.inst.roomEngine.getRoomCoPresenter(sender.room) && target.role !== Roles.HOST) ||
      this.inst.model.sessionSettings.feedbackClearing == FeedbackClearing.ATTENDEE
    );
  }



  @Socket(ServerConnectionAPI.EMOJI_FEEDBACK)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private emojiFeedback(@client client: Client, emojiId: EmojisId) {
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (sender) {
      this.inst.updateEngine.updateAttendee(client, sender.id, { emoji: emojiId });

      publishKafkaEvent(this.createKafkaFeedbackEvent(uuid(), sender, emojiId), this.inst.model.meetingID);
    }
  }

  @Socket(ServerConnectionAPI.CLEAR_EMOJI)
  @ApmTransaction(TransactionType.WS_REQUEST)
  private clearEmoji(@client client: Client, { attId: aid }) {
    if (!this.canClearFeedback(client.data.aid, aid)) {
      return;
    }

    this.inst.updateEngine.updateAttendee(client, aid, { emoji: EmojisId.NO_EMOJI });
  }

  @ApmSpan()
  approveAttendeeChange(_, id, data, done) {
    const attendee = this.inst.model.attendeesIndex[id];

    if (data.room !== undefined) {
      if (attendee?.emoji) {
        data.emoji = EmojisId.NO_EMOJI;
      }
    }

    done(data);
  }

  private createKafkaFeedbackEvent(id: string, sender: Attendee, emojiId: EmojisId): FeedbackEvent {
    const payload: FeedbackEventPayload = {
      _id: id,
      ts: Date.now(),
      meeting: KafkaUtils.getMeetingCommonData(this.inst.model),
      attendee: KafkaUtils.getAttendeeCommonData(sender),
      feedbackEmojiId: emojiId
    }

    return new FeedbackEvent('SendFeedback', payload);
  }
}
