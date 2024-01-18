/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable arrow-body-style */
/* eslint-disable @typescript-eslint/no-empty-function */
require('../../../__mock__/mock-apm');

import { EventEmitter } from 'events';

class MockCreateReadStream extends EventEmitter {
  close() {
    setTimeout(() => this.emit('close'));
  }
}
class MockS3Client {
  send() {
    return Promise.resolve({ETag: 'ETag'});
  }
}
const mockCreateReadStream = jest.fn(() => new MockCreateReadStream());

import { firstValueFrom } from 'rxjs';
import config from 'config';
import { SsrPayload } from './ssr-payload';
import { videoUploader } from './video-uploader';

jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');
  return {__esModule: true, ...originalModule,
    S3Client: MockS3Client,
  };
});
jest.mock('fs', () => {
  const originalModule = jest.requireActual('fs');
  return {__esModule: true, ...originalModule,
    createReadStream: mockCreateReadStream,
  };
});

describe('videoUploader', () => {
  const payload = {
    playlistId: 'playlistId',
    videoId: 'videoId',
    meetingName: 'meetingName',
    title: 'title',
    mid: 'mid'
  } as SsrPayload;

  const spyClose = jest.spyOn(MockCreateReadStream.prototype, 'close');

  it('Ok', async () => {
    const value = await firstValueFrom(videoUploader('SOURCE', payload));

    expect(value).toEqual({
      bucket: config.get('aws.s3.bucket'),
      key: `${config.get('aws.s3.prefix')}${payload.mid}/SOURCE`,
      etag: 'ETag'
    });
    expect(spyClose).toBeCalled();
  });

  it('Fail (SEND)', async () => {
    jest.spyOn(MockS3Client.prototype, 'send').mockImplementation(() => {
      return Promise.reject(new Error('{{TEST_ERROR}}'));
    });

    let testError;

    try {
      await firstValueFrom(videoUploader('SOURCE', payload));
    } catch (error) {
      testError = error;
    }

    expect(testError?.message).toMatch('\{\{TEST_ERROR\}\}');
    expect(spyClose).toBeCalled();
  });

  it('Fail (STREAM)', async () => {
    jest.spyOn(MockS3Client.prototype, 'send').mockImplementation(() => {
      return new Promise(resolve => { });
    });

    mockCreateReadStream.mockImplementation(() => {
      const stream = new MockCreateReadStream();

      setTimeout(() => stream.emit('error', new Error('{{TEST_ERROR}}')));

      return stream;
    });

    let testError;

    try {
      await firstValueFrom(videoUploader('SOURCE', payload));
    } catch (error) {
      testError = error;
    }

    expect(testError?.message).toMatch('\{\{TEST_ERROR\}\}');
    expect(spyClose).toBeCalled();
  });
});
