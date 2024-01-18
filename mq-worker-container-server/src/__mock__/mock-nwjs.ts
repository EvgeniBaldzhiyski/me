/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import EventEmitter from 'events';
import { v4 } from 'uuid';

export class MockMediaStreamTrack {
  id = '';

  constructor(
    public kind
  ) {
    this.id = v4();
  }

  stop() { /* */  }
}

export class MockMediaStream {
  active = true;

  tracks: MockMediaStreamTrack[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addTrack(track: MockMediaStreamTrack) {
    this.tracks.push(track);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  removeTrack(track: MockMediaStreamTrack) {
    this.tracks = this.tracks.filter(t => t.id !== track.id);
  }

  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }

  getTracks() {
    return this.tracks;
  }
}

export class MockTabsUpdate {
  addListener(callback) { /* */ }
  removeListener() { /* */ }
}

export class MockTabs {
  onUpdated = new MockTabsUpdate();

  incId = 0;

  create(_, callback) {
    this.incId++;
    callback({id: this.incId});
  }

  remove() { /* */ }
  update() { /* */}
}

export class MockTabCapture {
  onStatusChanged = {
    addListener: jest.fn(),
    removeListener: jest.fn()
  };

  capture(constants, callback: (stream: MockMediaStream) => void) {
    const stream = new MockMediaStream();

    if (constants.audio) {
      stream.addTrack(new MockMediaStreamTrack('audio'));
    }

    if (constants.video) {
      stream.addTrack(new MockMediaStreamTrack('video'));
    }

    callback(stream);
  }
}

export class MockChromeApiScripting {
  executeScript(value) {
    value.function();
  }
}

export class MockChromeApiRuntime {
  onMessage;
  sendMessage;

  constructor() {
    const _event = new EventEmitter();

    this.onMessage = {
      addListener: jest.fn(listener => {
        _event.addListener('_spec_', listener);
      }),
      removeListener: jest.fn(listener => {
        _event.removeListener('_spec_', listener);
      }),
      removeAllListeners: jest.fn(() => {
        _event.removeAllListeners();
      })
    };

    this.sendMessage = jest.fn(data => {
      _event.emit('_spec_', data);
    });
  }
}

export class MockChromeApi {
  tabs = new MockTabs();
  tabCapture = new MockTabCapture();
  scripting = new MockChromeApiScripting();
  runtime = new MockChromeApiRuntime();
}

export class MockNwWindowRef {
  window;

  constructor() {
    const _event = new EventEmitter();

    this.window = {
      emit: jest.fn((name, data) => {
        _event.emit(name, data);
      }),
      addEventListener: jest.fn((name, listener) => {
        _event.addListener(name, listener);
      }),
      removeEventListener: jest.fn(_event.addListener),
      removeAllListeners: jest.fn(_event.removeAllListeners),
      chrome: new MockChromeApi()
    };
  }
}

export class MockNwWindow {
  open(url, options, callback) {
    const win = new MockNwWindowRef();

    (global.window as any)?.removeAllListeners();

    global.window = win.window;
    global.chrome = global.window.chrome;

    if (callback) {
      callback(win);
    }
  }
}

global.nw = new (jest.fn(() => ({
  Window: new MockNwWindow()
})))() as any;
