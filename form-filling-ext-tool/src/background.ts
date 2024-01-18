import { fetchData, getFile, getTargetPosting, getTargetPostings, isLogged, login, logout } from './utils/api.facade';
import { Command, Commands, TargetId } from './utils/comm.map';
import { GetFileOptions, loginCredentials } from './utils/interfaces';
import { runtimeStorage } from './utils/storage';

function sendTransactionResponse(id: string, data, messenger?: chrome.runtime.MessageSender) {
  if (messenger?.tab?.id) {
    void chrome.tabs.sendMessage(messenger.tab.id, {cmd: Commands.RESPONSE_TRANSACTION, id, data} as Command);
  } else {
    void chrome.runtime.sendMessage({cmd: Commands.RESPONSE_TRANSACTION, id, data} as Command);
  }
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
chrome.runtime.onMessage.addListener(async ({cmd, target, data, id}: Command, messenger: chrome.runtime.MessageSender, res) => {
  console.log('Request: ', cmd, target, data, messenger.tab?.id || messenger.id);

  switch(cmd) {
    case Commands.GET_TARGET_POSTINGS: {
      res('OK');

      const {refresh} = (data || {}) as {refresh: boolean};

      if (!refresh) {
        const postings = runtimeStorage.getTargetPostings(target);
        const selectedId = runtimeStorage.getSelectedPostingId(target);

        if (postings) {
          sendTransactionResponse(id, {postings, selectedId});
          return;
        }
      }

      try {
        const postings = await getTargetPostings(target);
        const selectedId = runtimeStorage.getSelectedPostingId(target);

        runtimeStorage.setTargetPostings(target, postings);

        sendTransactionResponse(id, {postings, selectedId});
      } catch(err) {
        console.error(err);
        sendTransactionResponse(id, err);
      }
      break;
    }

    case Commands.FETCH_DATA: {
      try {
        const {url, payload, options} = (data || {}) as {url: string; payload: object; options: object };
        const fetchDataRes = await fetchData(url, payload, options);

        sendTransactionResponse(id, fetchDataRes, messenger);
      } catch(err) {
        console.error(err);
        sendTransactionResponse(id, err);
      }
      break;
    }

    case Commands.GET_FILE: {
      res('OK');

      try {
        const {options} = data as {options: GetFileOptions};

        const {blob, name} = await getFile(options);

        const base64 = await new Promise(resolve => {
          const reader = new FileReader();

          reader.readAsDataURL(blob);
          reader.onloadend = () => resolve(reader.result);
        });

        sendTransactionResponse(id, {base64, name}, messenger);
      } catch(err) {
        console.error(err);
        sendTransactionResponse(id, err);
      }

      break;
    }

    case Commands.LOGIN: {
      res('OK');
      try {
        const {name, pass} = data as loginCredentials;
        const loginInfo = await login(name, pass);

        sendTransactionResponse(id, loginInfo);
      } catch(err) {
        console.error(err);
        sendTransactionResponse(id, {type: 'ApiClientError', code: 501, text: err.text});
      }
      break;
    }

    case Commands.LOGOUT: {
      res(logout());
      break;
    }

    case Commands.IS_LOGGED: {
      res(isLogged());
      break;
    }

    case Commands.GET_TARGET_ID: {
      res('OK');

      const tabs = await chrome.tabs.query({currentWindow: true, active: true});
      const currentTarget = await new Promise<TargetId>(resolve => {
        setTimeout(() => resolve(undefined), 2000);

        chrome.tabs.sendMessage<Command, TargetId>(tabs[0].id, {cmd: Commands.GET_TARGET_ID}, tgr => {
          if (chrome.runtime.lastError) {
            // do nothing
          }
          resolve(tgr);
        });
      });

      sendTransactionResponse(id, currentTarget);

      break;
    }

    case Commands.SET_SELECTED_POSTING_ID: {
      const {id: iid} = (data || {}) as {id: string};

      runtimeStorage.setSelectedPostingId(target, iid);
      break;
    }

    case Commands.GET_SELECTED_POSTING_ID: {
      res(runtimeStorage.getSelectedPostingId(target));
      break;
    }

    case Commands.SET_SELECTED_EMPLOYEE_IDS: {
      const {ids} = (data || {}) as {ids: string[]};

      runtimeStorage.setSelectedEmployees(target, ids);
      break;
    }

    case Commands.GET_SELECTED_EMPLOYEE_IDS: {
      res(runtimeStorage.getSelectedEmployees(target));
      break;
    }

    case Commands.GET_TARGET_POSTING: {
      res({
        posting: runtimeStorage.getTarget(target),
        employees: runtimeStorage.getSelectedEmployees(target)
      });
      break;
    }

    case Commands.SET_TARGET_POSTING: {
      res('OK');

      let {id: iid} = data as {id?: string};
      if (!iid) {
        iid = runtimeStorage.getSelectedPostingId(target);
      }

      try {
        const posting = await getTargetPosting<{
          data: object;
          additionData: object;
          ismId: string;
          countryName: string;
        }>(target, iid);
        const formattedPosting = {
          ...posting.data,
          ismId: posting.ismId,
          countryName: posting.countryName,
        };

        // avoid overriding null and undefined fields
        for (const p in posting.additionData) {
          if (posting.additionData[p] !== undefined && posting.additionData[p] !== null) {
            formattedPosting[p] = posting.additionData[p];
          }
        }

        runtimeStorage.setTarget(target, {data: formattedPosting, state: {step: -1}, id: iid});

        sendTransactionResponse(id, runtimeStorage.getTarget(target));
      } catch (err) {
        console.error(err);
        sendTransactionResponse(id, err);
      }
      break;
    }

    case Commands.CLEAR_TARGET_POSTING: {
      runtimeStorage.removeTarget(target);

      break;
    }

    case Commands.SET_POSTING_STATE: {
      runtimeStorage.setTarget(target, data);
      break;
    }

    case Commands.PREPARE_FILLING: {
      runtimeStorage.setTarget(target, {
        id: runtimeStorage.getSelectedPostingId(target),
        state: {step: 0}
      });

      const tabs = await chrome.tabs.query({currentWindow: true, active: true});
      const sendData = {
        posting: runtimeStorage.getTarget(target),
        employees: runtimeStorage.getSelectedEmployees(target)
      };

      const accept = await chrome.tabs.sendMessage<Command, object>(tabs[0].id, {cmd: Commands.START_FILLING, data: sendData});

      sendTransactionResponse(id, accept);

      break;
    }

    case Commands.END_FILLING: {
      // double safe :)
      runtimeStorage.setTarget(target, {
        state: {step: -1}
      });
      break;
    }

    default:
      res({});
  }
});

/**
 * Self keep alive
 */
setInterval(() => {
  chrome.runtime.sendMessage({ status: 'keepAlive' }, () => {
    if (chrome.runtime.lastError) {
      // do nothing
    }
  });
}, 20000);
