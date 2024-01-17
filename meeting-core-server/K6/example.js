import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { generateMessage, parseMessage, generateUrl } from './utils.js';

export let options = { 
  stages: [
    { duration: '1m', target: 10}, // add 10 in 1 min
    { duration: '30s', target: 10}, // keep 10 on for in next 30 sek
    { duration: '1m', target: 20 }, // add 10 more
    { duration: '30s', target: 20 }, // keep 20 on for next 30 sek
    { duration: '1m', target: 15 }, // remove 5 in 1 min
    { duration: '30s', target: 15 }, // keep 15 on for 30 sek
    { duration: '1m', target: 25 }, // add 10 in 1 min
    { duration: '1m', target: 25 }, // keep 25 on in nex 1 min

    { duration: '30s', target: 0 }, // remove all in 300 sek
  ],
};

export default function () {
  var response = ws.connect(generateUrl('5ccf6b6e-d5d4-4310-b442-3c4ee3e62e75'), null, function (socket) {
    socket.on('open', function open() {
      // do anything
    });

    socket.on('message', function (message) {
      var body = parseMessage(message);

      if (!body) {
        return;
      }

      if (body.method === 'onConnect' && body.data && body.data.type === 'connectionAccept') {

        ////// ADD ANY ACTIVITY HERE /////
        
        socket.send(generateMessage('emojiFeedback', {
          color: '#d84e43',
          disabled: false,
          groupId: 1,
          id: 1,
          name: 'Laughing',
          ts: (new Date()).getTime(),
          url: './assets/emojis/grin-beam-light.svg',
        }));

        ///////////////////////////////
      }
    });
  });

  check(response, { 'status is 101': (r) => r && r.status === 101 });
}
