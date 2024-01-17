import { coreApi } from '../utils/coreApiClient';
import { emergencyHandler } from '../utils/emergencyHandler';

process.on('uncaughtException', emergencyHandler);
process.on('unhandledRejection', emergencyHandler);


// Unhandled Error
(async () => {
  const something: any = {};
  const x = something.that.does;
})();

// Unhandled AxiosError without Response with DNS error as Exception
(async () => {
  await coreApi.get('auth/fullsdfsdf', {baseURL: 'http://nowhere'});
})();

// Unhandled AxiosError with Response as Exception
(async () => {
  await coreApi.get('auth/fullsdfsdf');
})();

// Unhandled AxiosError with Response with Bad Request as Exception
(async () => {
  await coreApi.post('auth/full');
})();

