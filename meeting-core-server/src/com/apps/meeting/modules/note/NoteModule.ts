import apm from 'elastic-apm-node/start';
import { ApmSpan, ApmTransaction, TransactionType, FunctionalDomainType } from '@container/apm-utils';
import BaseModule from './../BaseModule';
import Meeting from '../../Meeting';
import Client from '../../../../utils/Client';
import HashUtils from '../../../../utils/HashUtils';
import {
  Attendee,
  ClientConnectionAPI,
  NoteboardType,
  Roles,
  Room,
  ServerConnectionAPI,
  ServerRestAPI
} from '@container/models';
import { EMPTY } from 'rxjs';
import { catchError, finalize, takeUntil, takeWhile, tap } from 'rxjs/operators';
import { MessagesApiNoteClient } from './messages-api-note.client';
import { NoteInterface } from './note.interface';
import { NotesStorageService } from '../../../restapi/NotesStorageService';
import { res, req } from '../../../../gateway/decorators/argument.decorator';
import { ServerResponse } from '../../../../utils/Server';
import { ServerRequest } from 'spdy';
import { authJwt } from '../../../../gateway/manager'
import { AuthPayload } from '../../../../gateway/types';
import { Get } from '../../../../gateway/decorators/method.decorator';

export default class NoteModule extends BaseModule {

  private testRoomLogMessage = 'Unexpected Action in NoteModule for Test Room.';

  // TODO when moving models to shared-lib/models package, add typings
  private cachedNotes: Map<string, any> = new Map<string, any>();

  // keeps track of currently ongoing requests. Used for buffer in case of a race condition
  // where two or more attendees login/move to a room at the same time and try to send multiple
  // requests to core-api for the same resource. This will validate that only 1 request is sent
  // and the others are ignored
  private ongoingRoomRequests: Map<string, boolean> = new Map();

  protected messagesApiNoteClient: NoteInterface;

  constructor(protected inst: Meeting) {
    super(inst);

    /* ======== Register server methods ======== */
    this.inst.server.onSocket(
      ServerConnectionAPI.LOAD_NOTES,
      (client, data) => {
        this.onLoadNotes(client, data);
      }
    );
    this.inst.server.onSocket(
      ServerConnectionAPI.NOTE_CREATE,
      (client, data) => {
        this.onCreateNote(client, data);
      }
    );
    this.inst.server.onSocket(
      ServerConnectionAPI.NOTE_DELETE,
      (client, data) => {
        this.onDeleteNote(client, data);
      }
    );
    this.inst.server.onSocket(
      ServerConnectionAPI.NOTE_UPDATE,
      (client, data) => {
        this.onUpdateNote(client, data);
      }
    );
    this.inst.server.onSocket(
      ServerConnectionAPI.NOTES_DELETE_ALL,
      (client, data) => {
        this.onDeleteAllNotes(client, data);
      }
    );

    this.inst.server.onSocket(
      ServerConnectionAPI.NOTES_VISIBILITY,
      (client, data) => {
        this.onToggleGroupNotesVisibility(client, data);
      }
    );

    this.inst.updateEngine.registerApprover(this);

    this.messagesApiNoteClient = new MessagesApiNoteClient();
  }

  async destruct() {
    this.destroyed$.next();
    this.destroyed$.complete();
    return super.destruct();
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  approveAttendeeChange(client, id, data, done) {
    done(data);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onLoadNotes(client: Client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const roomNotes = this.cachedNotes.get(data.roomId) || {};
    if (roomNotes && roomNotes[data.nbType]?.length) {
      this.inst.sendToAttendee(client.data.aid, ClientConnectionAPI.LOAD_NOTES, { notes: roomNotes[data.nbType], nbType: data.nbType });
      return;
    }
    // keep the logger reference for later
    const logger = this.inst.logger;

    const roomRequestKey = `${data.roomId}-${data.nbType}`;
    if (this.ongoingRoomRequests.has(roomRequestKey)) {
      // if there is an already running .net request, ignore the others
      return;
    }

    let noteGetMethod: any;
    let noteTypeName: string;
    let senderUserAccountID: string;

    if (attendee?.role === Roles.GHOST) {
      // The ghost "sees" the session as if it was the host,
      // so here we are setting the ID to load the host's notes for the ghost to see them.
      senderUserAccountID = this.inst.model.sessionSettings.hostUserAccountID;
    } else {
      senderUserAccountID = this.inst.model.attendeesIndex[client.data.aid].userAccountID;
    }

    switch (data.nbType) {
      case NoteboardType.GROUP:
        noteTypeName = 'group';
        noteGetMethod = this.messagesApiNoteClient.getGroupNoteMessages(this.inst.model.meetingID, senderUserAccountID, data.roomId);
        break;
      case NoteboardType.PERSONAL:
        noteTypeName = 'personal';
        noteGetMethod = this.messagesApiNoteClient.getPersonalNoteMessages(this.inst.model.meetingID, senderUserAccountID);
        break;
      case NoteboardType.PRESENTER:
        noteTypeName = 'presenter';
        noteGetMethod = this.messagesApiNoteClient.getPresenterNoteMessages(this.inst.model.meetingID, senderUserAccountID, data.roomId);
        break;
    }

    this.ongoingRoomRequests.set(roomRequestKey, true);

    noteGetMethod.pipe(
      takeUntil(this.destroyed$),
      tap(notes => {
        if (!this.inst) {
          // the Meeting was destroyed probably while this request finish
          logger.warn(`Did not get ${noteTypeName} note messages from the DB on time!`);
          return;
        }
        // when loading the notes for a specific room, always send all notes to the whole room
        // because there may have been multiple people joining the room at once and they should all receive the response
        if (data.nbType === NoteboardType.PERSONAL) {
          this.inst.sendToAttendee(client.data.aid, ClientConnectionAPI.LOAD_NOTES, { notes: notes, nbType: data.nbType });
        } else {
          const noteForRoom = this.cachedNotes.get(data.roomId) || {};
          noteForRoom[data.nbType] = notes;
          this.cachedNotes.set(data.roomId, noteForRoom);

          this.inst.roomEngine.sendToRoom(data.roomId, ClientConnectionAPI.LOAD_NOTES, { notes, nbType: data.nbType });
        }
      }),
      finalize(() => this.ongoingRoomRequests.delete(roomRequestKey)),
      catchError(error => {
        apm.captureError(error);
        logger.error(`Can not get ${noteTypeName} note messages from the DB!. ${error.message}`);
        return EMPTY;
      })
    ).subscribe();
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  private onCreateNote(client: Client, data: {
    to: '' | Room['id'],
    type: NoteboardType,
    title: string,
    text: string
  }) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];

    if (!attendee) {
      this.inst.logger.warn('Missing note creator info');
      return;
    }

    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const note = {
      ...data,
      id: HashUtils.guid(),
      from: attendee.userAccountID,
      creatorFirstName: attendee.firstName,
      creatorLastName: attendee.lastName,
      creatorId: attendee.userAccountID,
      roomId: data.to,
      timestamp: (new Date()).getTime()
    };

    if (this.inst.model.roomsIndex[data.to]) {
      note.to = attendee.room;
      if (data.type === NoteboardType.PERSONAL) {
        note.to = '';
        this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.NOTE_CREATE, note);
      } else {
        this.inst.roomEngine.sendToRoom(attendee.room, ClientConnectionAPI.NOTE_CREATE, note, true);
      }

      this.persistNote(note, client.data.aid);
    }
  }


  @ApmTransaction(TransactionType.WS_REQUEST)
  private onDeleteNote(client: Client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.canDeleteNote(attendee, data) && attendee.userAccountID !== data.creatorId) {
      return;
    }
    if (this.inst.model.roomsIndex[data.to]) {
      this.inst.roomEngine.sendToRoom(data.to, ClientConnectionAPI.NOTE_DELETE, data, true);
      this.deleteNoteFromDB(data.id, data.type, attendee.room, client.data.aid);
    }
  }


  @ApmTransaction(TransactionType.WS_REQUEST)
  private onDeleteAllNotes(client: Client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.canDeleteAllNotes(attendee, data.id, data.type, data.senderId)) {
      return;
    }
    if (this.inst.model.roomsIndex[data.id]) {
      this.inst.roomEngine.sendToRoom(data.id, ClientConnectionAPI.NOTES_DELETE_ALL, data, true);
      this.deleteNoteFromDB('all', data.type, data.id, client.data.aid);
    }
  }

  private canDeleteNote(attendee: Attendee, data) {
    return (
      this.inst.roomEngine.isHost(attendee) || (attendee.userAccountID === data.creatorId) ||
      (!this.inst.roomEngine.isHost(this.inst.attendeeStorage.getAttendeeByUserAccountId(data.creatorId)) &&
        this.inst.roomEngine.isRoomPresenter(attendee, data.to))
    );
  }

  private canDeleteAllNotes(attendee: Attendee, receiverId: string, nbType: NoteboardType, senderId: string) {
    if (this.inst.roomEngine.isRoomPresenter(attendee, attendee.room) ||
      this.inst.roomEngine.isHost(attendee) ||
      ((nbType === NoteboardType.PERSONAL) && (senderId === attendee.userAccountID))) {
      return true;
    }

    return this.inst.roomEngine.isRoomPresenter(attendee, receiverId);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onToggleGroupNotesVisibility(client, data) {
    const sender: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    const room: Room = this.inst.model.roomsIndex[sender.room];

    if (!room || !sender) {
      return;
    }

    if (room.isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    if (!this.inst.roomEngine.isMainRoomPresenter(sender) && !this.inst.roomEngine.isRoomPresenter(sender, room.id)) {
      return;
    }

    room.groupNotesVisibility = data.visibility;
    const visibilityData = {
      senderId: sender.id,
      room: room.id,
      groupNotesVisibility: data.visibility
    };
    this.inst.roomEngine.update({ groupNotesVisibility: room.groupNotesVisibility, id: room.id });
    this.inst.roomEngine.sendToRoom(room.id, ClientConnectionAPI.NOTES_VISIBILITY, visibilityData, true);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  public onUpdateNote(client: Client, data) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!this.canEditNote(attendee, data)) {
      return;
    }
    if (this.inst.model.roomsIndex[data.to]) {
      this.inst.roomEngine.sendToRoom(data.to, ClientConnectionAPI.NOTE_UPDATE, data, true);
      this.persistNote(data, client.data.aid, true);
    }
  }

  private canEditNote(attendee: Attendee, data) {
    return (attendee.userAccountID === data.from);
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private sendNoteDataToDB(isEdit, aid, note) {
    const generateParams = {
      id: note.id,
      text: note.text,
      title: note.title,
      roomId: note.to || null,
      senderUserAccountID: this.inst.model.attendeesIndex[aid].userAccountID,
    };

    if (!isEdit) {
      this.createNote(this.inst.model.meetingID, note.type, generateParams).subscribe();
    } else {
      this.editNote(this.inst.model.meetingID, note.type, generateParams).subscribe();
    }
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private createNote(meetingID: string, noteType: NoteboardType, body) {
    let createMethod: any;
    let noteTypeName: string;

    switch (noteType) {
      case NoteboardType.GROUP:
        noteTypeName = 'Group';
        createMethod = this.messagesApiNoteClient.postGroupNoteMessage(meetingID, body);
        break;
      case NoteboardType.PERSONAL:
        noteTypeName = 'Personal';
        createMethod = this.messagesApiNoteClient.postPersonalNoteMessage(meetingID, body);
        break;
      case NoteboardType.PRESENTER:
        noteTypeName = 'Presenter';
        createMethod = this.messagesApiNoteClient.postPresenterNoteMessage(meetingID, body);
        break;
      default:
        return;
    }

    return createMethod.pipe(
      tap(
        () => {
          this.inst.logger.info(`${noteTypeName} note added`);
        },
        (error) => {
          apm.captureError(error);
          this.inst.logger.error(`Can not send ${noteTypeName.toLowerCase()} note message to the DB! ${error.message}`);
        }
      ),
      takeWhile(() => !this.destroyed$?.isStopped)
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private editNote(meetingID: string, noteType: NoteboardType, body) {
    let createMethod: any;
    let noteTypeName: string;

    switch (noteType) {
      case NoteboardType.GROUP:
        noteTypeName = 'Group';
        createMethod = this.messagesApiNoteClient.editGroupNoteMessage(meetingID, body);
        break;
      case NoteboardType.PERSONAL:
        noteTypeName = 'Personal';
        createMethod = this.messagesApiNoteClient.editPersonalNoteMessage(meetingID, body);
        break;
      case NoteboardType.PRESENTER:
        noteTypeName = 'Presenter';
        createMethod = this.messagesApiNoteClient.editPresenterNoteMessage(meetingID, body);
        break;
      default:
        return;
    }

    return createMethod.pipe(
      tap(
        () => {
          this.inst.logger.info(`${noteTypeName} note edit`);
        },
        (error) => {
          apm.captureError(error);
          this.inst.logger.error(`Can not send ${noteTypeName.toLowerCase()} note message to the DB! ${error.message}`);
        }
      ),
      takeWhile(() => !this.destroyed$?.isStopped)
    );
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private persistNote(note, aid: string, isEdit?: boolean): Promise<void> {

    if (note.type === NoteboardType.PERSONAL) {
      // skip personal notes from caching
      this.sendNoteDataToDB(isEdit, aid, note);
      return;
    }

    const notes = this.cachedNotes.get(note.to) || {};

    if (!notes[note.type]) {
      notes[note.type] = [];
    }

    if (isEdit) {
      const existingNote = notes[note.type].find(n => n.id === note.id);
      if (!existingNote) {
        this.inst.logger.warn('Missing Note to edit in the CachedNotes:', { note, notes: notes[note.type] });
        return;
      }
      existingNote.text = note.text;
      existingNote.title = note.title;
    } else {
      notes[note.type].push(note);
    }

    this.cachedNotes.set(note.to, notes);
    this.sendNoteDataToDB(isEdit, aid, note);
  }

  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private deleteNoteFromDB(id: string, type: NoteboardType, roomId: string, attendeeId: string) {
    // keep the logger reference for later
    const logger = this.inst.logger;

    const isAll = id === 'all';
    const body: any = {
      roomID: roomId || null,
      senderUserAccountID: this.inst.model.attendeesIndex[attendeeId].userAccountID,
      isAll,
    };

    if (!isAll) {
      body.id = id;
    }

    let deleteMethod: any;
    let noteTypeName: string;

    switch (type) {
      case NoteboardType.GROUP:
        noteTypeName = 'group';
        if (isAll === true) {
          deleteMethod = this.messagesApiNoteClient.deleteGroupNoteMessage(this.inst.model.meetingID, body);
        } else {
          deleteMethod = this.messagesApiNoteClient.deleteAllGroupNoteMessages(this.inst.model.meetingID, body);
        }
        break;
      case NoteboardType.PERSONAL:
        noteTypeName = 'personal';
        if (isAll === true) {
          deleteMethod = this.messagesApiNoteClient.deletePersonalNoteMessage(this.inst.model.meetingID, body);
        } else {
          deleteMethod = this.messagesApiNoteClient.deleteAllPersonalNoteMessages(this.inst.model.meetingID, body);
        }
        break;
      case NoteboardType.PRESENTER:
        noteTypeName = 'presenter';
        if (isAll === true) {
          deleteMethod = this.messagesApiNoteClient.deletePresenterNoteMessage(this.inst.model.meetingID, body);
        } else {
          deleteMethod = this.messagesApiNoteClient.deleteAllPresenterNoteMessages(this.inst.model.meetingID, body);
        }
        break;
      default:
        return;
    }

    deleteMethod.pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        const notes = this.cachedNotes.get(roomId) || {};
        if (id === 'all') {
          notes[type] = [];
        } else if (type !== NoteboardType.PERSONAL) {
          // personal notes aren't cached
          const index = notes[type].findIndex(n => n.id === id);
          notes[type].splice(index, 1);
        }
        this.cachedNotes.set(roomId, notes);
      }),
      catchError(error => {
        apm.captureError(error);
        logger.error(`Can not delete ${noteTypeName} note messages from the DB! ${error.message}`);
        return EMPTY;
      })
    ).subscribe();
  }

  @Get(ServerRestAPI.PRESIGNED_URL)
  @ApmSpan(null, { functionalDomain: FunctionalDomainType.NOTE })
  private async presignedUrl(
    data: { fileName: string, meetingId: string },
    @req req: ServerRequest,
    @res res: ServerResponse) {
    const payload = await (authJwt(req, '*')) as AuthPayload;

    if (!payload) {
      res.writeHead(
        401
      );
      res.end();
      apm.captureError("Unauthorized attempt for generating of a presigned url for uploading of a file");
      this.inst.logger.error('An error occurred: Unauthorized attempt for generating of a presigned url for uploading of a file');

      return;
    }

    if (!this.inst.model) {
      res.writeHead(
        403
      );
      res.end();

      apm.captureError("Forbidden attempt for generating of a presigned url for uploading of a file");
      this.inst.logger.error('An error occurred: Forbidden attempt for generating of a presigned url for uploading of a file');

      return;
    }

    const userAcc = this.inst.attendeeStorage.getAttendeeByUserAccountId(payload.sub);
    if (!userAcc) {
      res.writeHead(
        403
      );
      res.end();

      apm.captureError("Forbidden attempt for generating of a presigned url for uploading of a file");
      this.inst.logger.error('An error occurred: Forbidden attempt for generating of a presigned url for uploading of a file');

      return;
    }

    const result = await NotesStorageService.getInstance().getNotePresignedUrl(data.fileName);

    res.writeHead(
      200,
      { 'content-type': 'application/json; charset=utf-8' }
    );

    res.end(JSON.stringify({
      url: result.url,
      bucketName: result.bucketName
    }));
  }
}
