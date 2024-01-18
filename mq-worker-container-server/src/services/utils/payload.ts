// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Payload {
  url: string; // web app url
  cid: string; // company id
  mid: string; // session id
  mrunid: string; // session run id
  aid: string; // attendee id
  rid: string; // room id
  meetingName: string;
}
