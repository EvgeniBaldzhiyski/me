import { ClientConnectionAPI } from '@container/models';

export interface ExportingStatusMessage {
  message: string;
  method: ClientConnectionAPI.ANNOTATIONS_EXPORT | ClientConnectionAPI.BRING_BACK_PDF_COMPLETED;
  type?: 'warn' | 'error';
}

// @TODO: Share this with PDF worker when we come up with a shared library solution
export const ExportingStatusMessagesMap = {
  ANNOTATION_IS_EXPORTING: () => ({
    message: 'Annotation is being exported and will be available in a few minutes in Pane 2 - Documents.',
    method: ClientConnectionAPI.ANNOTATIONS_EXPORT,
    type: 'warn'
  } as ExportingStatusMessage),
  ANNOTATION_EXPORTED: () => ({
    message: 'Annotation has been successfully exported and will be available shortly in Pane 2 - Documents.',
    method: ClientConnectionAPI.ANNOTATIONS_EXPORT,
    type: 'warn'
  } as ExportingStatusMessage),
  ERROR_DATABASE: () => ({
    message: 'Database error! PDF Export failed.',
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_ANNOTATION: () => ({
    message: 'Error exporting the annotation!',
    method: ClientConnectionAPI.ANNOTATIONS_EXPORT,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_CHAT_NOTES_WHITEBOARD: (roomName: string) => ({
    message: `There was an error exporting whiteboard, chat and notes for room ${roomName}`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_CHAT_NOTES: (roomName: string) => ({
    message: `There was an error exporting notes and chat for room ${roomName}`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_CHAT_WHITEBOARD: (roomName: string) => ({
    message: `There was an error exporting whiteboard and chat for room ${roomName}`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_NOTES_WHITEBOARD: (roomName: string) => ({
    message: `There was an error exporting  whiteboard and notes for room ${roomName}.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_CHAT: (roomName: string) => ({
    message: `There was an error exporting chat for room ${roomName}.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_NOTES: (roomName: string) => ({
    message: `There was an error exporting notes for room ${roomName}.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  ERROR_WHITEBOARD: (roomName: string) => ({
    message: `There was an error exporting whiteboard for room ${roomName}.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  EXPORTED_CHAT_NOTES_WHITEBOARD: (roomName: string) => ({
    message: `Whiteboard, chat and notes have been exported for room ${roomName}. They'll be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_CHAT_NOTES: (roomName: string) => ({
    message: `Notes and chat have been exported for room ${roomName}. They'll be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_CHAT_WHITEBOARD: (roomName: string) => ({
    message: `Whiteboard and chat have been exported for room ${roomName}. They'll be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_NOTES_WHITEBOARD: (roomName: string) => ({
    message: `Whiteboard and notes have been exported for room ${roomName}. They'll be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_CHAT: (roomName: string) => ({
    message: `Chat has been exported for room ${roomName} and will be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_NOTES: (roomName: string) => ({
    message: `Notes have been exported for room ${roomName} and will be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_WHITEBOARD: (roomName: string) => ({
    message: `Whiteboard has been exported for room ${roomName} and will be available in a few minutes in Pane 2 - Documents.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  EXPORTED_NOTHING: (roomName: string) => ({
    message: `No documents have been exported for ${roomName} as there are no objects to export.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  PDF_DISABLED: () => ({
    message: 'Bring back PDFs are disabled!',
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  PDF_DISABLED_PER_ROOM: (roomName: string) => ({
    message: `PDFs were not generated because they are disabled for room ${roomName}!`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  ROOM_EMPTY: (roomName: string) => ({
    message: `PDFs were not generated because no user entered the room ${roomName}.`,
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'warn'
  } as ExportingStatusMessage),
  ROOM_NOT_FOUND: () => ({
    message: 'PDFs were not generated because the room can not be found!',
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  INTERNAL_ERROR: () => ({
    message: 'PDFs were not generated due to an internal service error!',
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage),
  UNKNOWN_ERROR: () => ({
    message: 'An unknown error has occurred while generating PDFs.',
    method: ClientConnectionAPI.BRING_BACK_PDF_COMPLETED,
    type: 'error'
  } as ExportingStatusMessage)
};



