/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable arrow-body-style */
require('../../../__mock__/mock-apm');

import { firstValueFrom, of, throwError } from 'rxjs';
import { VideoMetadata } from './video-generator';
import { FileExistValidator, MinDurationValidator, validateFileExists, validateMinDuration } from './video-validators';

let mockAccess: jest.Mock;

function setupMocks() {
  mockAccess = jest.fn(path => Promise.resolve(path));
}

jest.mock('fs/promises', () => {
  const originalModule = jest.requireActual('fs/promises');
  return {__esModule: true, ...originalModule,
    access: jest.fn(path =>  mockAccess(path)),
  };
});

describe('Video validators', () => {
  describe('validateFileExists', () => {
    beforeEach(() => {
      setupMocks();
    });

    it('Ok', async () => {
      const value = await firstValueFrom(validateFileExists('PATH'));

      expect(value).toBe('PATH');
    });

    it('Fail', async () => {
      mockAccess.mockImplementation(() => {
        return throwError(() => new Error('{{TEST_ERROR}}'));
      });

      let testError: FileExistValidator;

      try{
        await firstValueFrom(validateFileExists('PATH'));
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeInstanceOf(FileExistValidator);
      expect(testError.message).toBe('{{TEST_ERROR}}');
    });
  });

  describe('validateMinDuration', () => {
    beforeEach(() => {
      setupMocks();
    });

    it('Ok', async () => {
      const videoMetaData = {format: {duration: 1000} } as VideoMetadata;
      const value = await firstValueFrom(of(videoMetaData).pipe(
        validateMinDuration()
      ));

      expect(value).toBe(videoMetaData);
    });

    it('Fail', async () => {
      const videoMetaData = { format: {duration: 9}} as VideoMetadata;
      let testError: MinDurationValidator;

      try {
        await firstValueFrom(of(videoMetaData).pipe(
          validateMinDuration()
        ));
      } catch(error) {
        testError = error;
      }

      expect(testError).toBeInstanceOf(MinDurationValidator);
    });
  });
});
