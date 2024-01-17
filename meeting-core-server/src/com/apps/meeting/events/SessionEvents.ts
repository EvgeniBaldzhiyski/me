import { ComponentNames, Room } from '@container/models';

export enum SessionEventTypes {
  Server_EVENT = 'ServerEvent',
  NO_MAIN_PRESENTER = 'NoMainPresenterEvent',
  NO_MAIN_PRESENTER_TIMEOUT = 'NoMainPresenterTimeoutEvent',
  ATTENDEE_JOIN_SUCCESS = 'AttendeeJoinSuccessEvent',
  ATTENDEE_FIRST_JOIN_SUCCESS = 'AttendeeFirstJoinSuccessEvent',
  ATTENDEE_LEFT_AFTER_TIMEOUT = 'AttendeeLeftAfterTimeoutEvent',
  SESSION_INIT = 'SessionInitEvent',

  CHANGE_ACTIVE_PANE = 'ChangeActivePaneComponent',

  ROOM_ADDED = 'RoomAddedEvent',
  ROOM_BEFORE_CLOSE = 'RoomBeforeCloseEvent',
  ROOM_CLOSE = 'RoomCloseEvent',
  REFRESH_SETTINGS = 'RefreshSettings',
  SSR_STATUS = 'SSR_STATUS',
}
export class SessionEvent {
  // Explicitly declare constructor property - we need this so we can use different static properties in child classes
  // https://github.com/Microsoft/TypeScript/issues/5989
  public static type = 'ServerEvent';
}
export class NoMainPresenterEvent extends SessionEvent {
  public static type = 'NoMainPresenterEvent';
}
export class NoMainPresenterTimeoutEvent extends SessionEvent {
  public static type = 'NoMainPresenterTimeoutEvent';
}
export class AttendeeJoinSuccessEvent extends SessionEvent {
  public static type = 'AttendeeJoinSuccessEvent';
}
export class AttendeeFirstJoinSuccessEvent extends SessionEvent {
  public static type = 'AttendeeFirstJoinSuccessEvent';
}
export class AttendeeLeftAfterTimeoutEvent extends SessionEvent {
  public static type = 'AttendeeLeftAfterTimeoutEvent';
}
export class AttendeeLeftAfterKickOut extends SessionEvent {
  public static type = 'AttendeeLeftAfterKickOut';
}
export class AttendeeLeftEvent extends SessionEvent {
  public static type = 'AttendeeLeftEvent';
}

export class AttendeeUpdateEvent extends SessionEvent {
  public static type = 'AttendeeUpdateEvent';
}
export class SessionInitEvent extends SessionEvent {
  public static type = 'SessionInitEvent';
}
export class SessionCloseEvent extends SessionEvent {
  public static type = 'SessionCloseEvent';
}
export class RoomCreatedEvent extends SessionEvent {
  // a new room was just created
  public static type = 'RoomCreatedEvent';
}

export class ClonedRoomIdsCreatedEvent extends SessionEvent {
  // all cloned room ids created
  public static type = 'ClonedRoomIdsCreatedEvent';
}

export class RoomAddedEvent extends SessionEvent {
  // a room was added to the UI
  public static type = 'RoomAddedEvent';
}
export class RoomRefreshEvent extends SessionEvent {
  public static type = 'RoomRefreshEvent';
}
export class RoomSettingsChangeEvent extends SessionEvent {
  public static type = 'RoomSettingsChangeEvent';
}

export class MoveAttendeesEvent extends SessionEvent {
  public static type = 'MoveAttendeesEvent';
}

export class RoomEditedEvent extends SessionEvent {
  public static type = 'RoomEditedEvent';

  constructor(
    public readonly id: string,
    public readonly config: any
  ) {
    super();
  }
}

export class ChangeActivePaneComponent extends SessionEvent {
  public static type = 'ChangeActivePaneComponent';

  constructor(
    public paneId: number,
    public newActiveComponent: ComponentNames,
    public roomId: Room['id']
  ) {
    super();
  }
}
