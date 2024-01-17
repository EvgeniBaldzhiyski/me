import { createDefaultLogger } from './DefaultLogger';
import { coreApi } from '../utils/coreApiClient';
import { Logger } from 'winston';
import { Attendee, Roles } from '@container/models';

async function testLogger(logger: Logger) {
  const err = () => new Error('<This is an error>');
  logger.error(err());
  // this will skip things after the 2nd parameter as those are considered SPLAT only usable if such format is utilized at all
  logger.info('Hi this is info with error', err(), 'but nothing else goes');
  logger.info('Hi this is info', {err: err(), m: 'asfd', b: ['a', 'c', 'd']});
  logger.debug('Hi this is debug', err());
  logger.info('-= CLIENT (' + 'asdfawer131234sadf' + ') HAS BEEN REJECTED =-', {code: 445, rejectMessage: 'client rejected message'});
  logger.error(`Could not close BORs.`, {ids: [1, 2, 3, 4, 5], stack: err()});
  try {
    await coreApi.get('auth');
  } catch (e) {
    logger.error('Caught some Core API error', e);
  }
  try {
    await coreApi.get('auth/full');
  } catch (e) {
    logger.error(e);
  }
  const a = new Attendee({id: 'attIdXHere', firstName: 'Rad', lastName: 'Kir', role: Roles.ATTENDEE, room: 'roomIdXHere'});
  logger.warn(`Client (${a.id}) tried to empty BOR`, {id: a.id, fullName: a.fullName, role: a.role, room: a.room});
  logger.error(err() as any, a);
}

(async () => {
  await testLogger(createDefaultLogger('plain meeting', '1234', 'debug', 'plain'));
  console.log('=========================');
  await testLogger(createDefaultLogger('json meeting', '1234', 'debug', 'json'));
})();

