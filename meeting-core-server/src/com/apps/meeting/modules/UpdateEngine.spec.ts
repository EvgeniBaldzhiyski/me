jest.mock('elastic-apm-node/start');
jest.mock('elastic-apm-http-client');
jest.mock('@container/apm-utils', () => {
  return {
    ApmSpan: () => { return () => {}},
    ApmTransaction: () => { return () => {}},
    TransactionType: { WS_REQUEST: null }
  };
});

import { Attendee, AttendeeBase, ClientConnectionAPI, Model, Roles, ServerConnectionAPI } from '@container/models';
import { AttendeeStorage } from '../utils/attendee.storage';
import { BaseModuleInterface } from './BaseModule';
import UpdateEngine from './UpdateEngine';
import { createModule, MockServerApi } from './_TEST_/meeting-mocks.lib';

describe('UpdateEngine', () => {
  let engine: UpdateEngine;
  let storage: AttendeeStorage;
  let updateList;
  let spySendTo;

  const server = {};

  beforeEach(async () => {
    spySendTo = jest.spyOn(MockServerApi.prototype, 'sendTo').mockImplementation((...rest) => {
      updateList = (rest as any)[1];
    });
    jest.spyOn(MockServerApi.prototype, 'onSocket').mockImplementation((name, handler) => {
      server[`_${name}`] = handler;
    });
    engine = createModule(UpdateEngine);
    engine['inst'].attendeeStorage.addAttendee({id: '<ATTENDEE_ID>'});
    engine['inst'].attendeeStorage.addAttendee({id: '<ATTENDEE_ID_1>'});

    storage = (engine['inst'] as any).attendeeStorage;
  });

  it('base', () => {
    engine.registerApprover({
      approveAttendeeChange: async (client, id, data, callback) => {
        expect(storage.getAttendeeById(id).role).toBe(Roles.ATTENDEE);

        data.role = Roles.LEAD;

        await callback(data);

        expect(storage.getAttendeeById(id).role).toBe(Roles.HOST);
      },
    } as BaseModuleInterface);

    engine.registerApprover({
      approveAttendeeChange: async (client, id, data, callback) => {
        expect(storage.getAttendeeById(id).role).toBe(Roles.ATTENDEE);

        data.role = Roles.HOST;

        await callback(data);

        expect(storage.getAttendeeById(id).role).toBe(Roles.HOST);
      },
    } as BaseModuleInterface);

    server[`_${ServerConnectionAPI.UPDATE}`]({
      data: {aid: '<ATTENDEE_ID>'}
    }, {
      id: '<ATTENDEE_ID>',
      data: {
        role: Roles.LEAD
      }
    });
  });

  it('veto', async () => {
    engine.registerApprover({
      approveAttendeeChange: async (client, id, data, callback) => {
        data.role = Roles.HOST;

        await callback(data);
      },
    } as BaseModuleInterface);

    engine.registerApprover({
      approveAttendeeChange: (client, id, data, callback) => {
        if (id === '<ATTENDEE_ID>') {
          callback(null);
        } else {
          data.role = Roles.HOST;

          callback(data);
        }
      },
    } as BaseModuleInterface);

    await engine.updateAttendees(null, [
      { id: '<ATTENDEE_ID>', data: { role: Roles.HOST } },
      { id: '<ATTENDEE_ID_1>', data: { role: Roles.HOST } }
    ]);

    expect(storage.getAttendeeById('<ATTENDEE_ID>').role).toBe(Roles.ATTENDEE);
    expect(storage.getAttendeeById('<ATTENDEE_ID_1>').role).toBe(Roles.HOST);

    expect(spySendTo).toBeCalledWith(ClientConnectionAPI.UPDATE, expect.arrayContaining([{
      id: expect.any(String),
      data: expect.objectContaining({
        role: Roles.HOST
      })
    }]));

    expect(updateList && updateList.length).toBe(1);
  });

  it('without approver', async () => {
    await engine.updateAttendees(null, [
      { id: '<ATTENDEE_ID>', data: { role: Roles.HOST } },
      { id: '<ATTENDEE_ID_1>', data: { role: Roles.HOST } }
    ]);

    expect(storage.getAttendeeById('<ATTENDEE_ID>').role).toBe(Roles.HOST);
    expect(storage.getAttendeeById('<ATTENDEE_ID_1>').role).toBe(Roles.HOST);

    expect(spySendTo).toBeCalledWith(ClientConnectionAPI.UPDATE, expect.arrayContaining([{
      id: expect.any(String),
      data: expect.objectContaining({
        role: Roles.HOST
      })
    }]));

    expect(updateList && updateList.length).toBe(2);
  });

  it('remove approver', async () => {
    const approver: any = { approveAttendeeChange: jest.fn() };

    engine.registerApprover(approver);
    engine.removeApprover(approver)

    await engine.updateAttendees(null, [
      { id: '<ATTENDEE_ID>', data: { role: Roles.HOST } },
      { id: '<ATTENDEE_ID_1>', data: { role: Roles.HOST } }
    ]);

    expect(approver.approveAttendeeChange).not.toHaveBeenCalled();
  });
});
