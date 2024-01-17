import client from 'prom-client';
import config from 'config';

const defaultLabels = {serviceName: 'socket-server'};
client.register.setDefaultLabels(defaultLabels);
const prefix = config.get('metrics.prefix');

client.collectDefaultMetrics();

export const meetingsGauge = new client.Gauge({
  name: `${prefix}meeting`,
  help: 'Number of meetings on socket server'
});

export const attendeesGauge = new client.Gauge({
  name: `${prefix}attendee`,
  help: 'Number of attendees on socket server'
});

export const camGauge = new client.Gauge({
  name: `${prefix}cam`,
  help: 'Number of cams on socket server'
});

export const micGauge = new client.Gauge({
  name: `${prefix}mic`,
  help: 'Number of mics on socket server'
});

export const borsGauge = new client.Gauge({
  name: `${prefix}bor`,
  help: 'Number of BORS on socket server'
});

export const aibGauge = new client.Gauge({
  name: `${prefix}aib`,
  help: 'Number of attendees in BORs on socket server'
});

export const meetingRunGauge = new client.Gauge({
  name: `${prefix}meeting_run`,
  help: 'Number of Meeting Runs for given Meeting ID',
  labelNames: ['mid', 'mrunid', 'name', 'company_id']
});

export const meetingAttendeesGauge = new client.Gauge({
  name: `${prefix}attendee_count`,
  help: 'Number of attendees in meeting #mid on socket server',
  labelNames: ['mid', 'mrunid', 'name', 'company_id', 'room_id', 'room_name']
});

export const meetingCamGauge = new client.Gauge({
  name: `${prefix}cam_count`,
  help: 'Number of attendees with open cameras in meeting #mid on socket server',
  labelNames: ['mid', 'mrunid', 'name', 'company_id', 'room_id', 'room_name']
});

export const meetingMicGauge = new client.Gauge({
  name: `${prefix}mic_count`,
  help: 'Number of attendees with open microphones in meeting #mid on socket server',
  labelNames: ['mid', 'mrunid', 'name', 'company_id', 'room_id', 'room_name']
});

export const meetingScreenshareGauge = new client.Gauge({
  name: `${prefix}screen_share_count`,
  help: 'Number of attendees screen-sharing in meeting #mid on socket server',
  labelNames: ['mid', 'mrunid', 'name', 'company_id', 'room_id', 'room_name']
});

export const drainModeGauge = new client.Gauge({
  name: `${prefix}drain_mode`,
  help: 'Flag if socket server is in drain mode'
});
