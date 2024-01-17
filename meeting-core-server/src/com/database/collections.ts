import { defaultDb } from './db.connection';

export enum DB_COLLECTIONS {
  WHITEBOARD_GROUP = 'whiteboard_group_pages',
  WHITEBOARD_PERSONAL = 'whiteboard_personal_pages',
  ANNOTATIONS = 'annotations_pages',
  PRESENTATION_MODULE_STATES = 'presentation_module_states',
  ATTENDEES_STATE = 'attendees_state',
  MEDIA_RECORD_MODULE_STATE = 'media_record_module_state',
  ROOMS_STATE = 'room_module_state',
  TRANSCRIBE_MODULE_STATE = 'transcribe_module_state',
  // VOICE_MODULE_STATE = 'voice_module_state',
  SSR_MODULE_STATE = 'ssr_module_state'
}

export const whiteboardGroupCollection = defaultDb().collection(DB_COLLECTIONS.WHITEBOARD_GROUP);
void whiteboardGroupCollection.createIndex({meetingID: 1, wbSourceID: 1});
void whiteboardGroupCollection.createIndex({ insertDate: 1 });

export const whiteboardPersonalCollection = defaultDb().collection(DB_COLLECTIONS.WHITEBOARD_PERSONAL);
void whiteboardPersonalCollection.createIndex({meetingID: 1, wbSourceID: 1});
void whiteboardPersonalCollection.createIndex({ insertDate: 1 });

export const annotationsCollection = defaultDb().collection(DB_COLLECTIONS.ANNOTATIONS);
void annotationsCollection.createIndex({meetingID: 1, wbSourceID: 1, roomID: 1});
void annotationsCollection.createIndex({ insertDate: 1 });
