import client from 'prom-client';
import config from 'config';

const defaultLabels = {serviceName: config.get('service.name')};
client.register.setDefaultLabels(defaultLabels);

client.collectDefaultMetrics();

export const capacityGauge = new client.Gauge({
  name: config.get('metrics.capacityGauge'),
  help: 'Available capacity that this worker can handle'
});

export const loadGauge = new client.Gauge({
  name: config.get('metrics.loadGauge'),
  help: 'Used amount of the total work capacity'
});

export const totalCapacityGauge = new client.Gauge({
  name: config.get('metrics.totalCapacityGauge'),
  help: 'Maximum capacity that this worker can handle'
});

export const runningSessionsGauge = new client.Gauge({
  name: config.get('metrics.runningSessionsGauge'),
  help: 'Current running sessions',
  labelNames: ['cid', 'mid', 'rid', 'meetingName']
});
