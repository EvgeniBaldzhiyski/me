import client from 'prom-client';

export const transcribeSessionHistogram = new client.Histogram({
  name: 'transcribe_session',
  help: 'Time elapsed in sessions transcribing',
  labelNames: ['cid', 'mid', 'rid', 'meetingName']
});
