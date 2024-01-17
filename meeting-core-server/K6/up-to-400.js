import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { generateMessage, parseMessage, generateUrl } from './utils.js';

export let options = { 
  // stages: [
  //   { duration: '30s', target: 200 },
  //   { duration: '1m', target: 200 },
  //   { duration: '30s', target: 400 },
  //   { duration: '1m', target: 400 },
  //   // { duration: '10s', target: 100 },
  //   // { duration: '10s', target: 100 },
  //   // { duration: '10s', target: 100 },
  //   // { duration: '1m', target: 400 },
  //   // { duration: '20s', target: 100 },
  //   // { duration: '50s', target: 100 },
  //   // { duration: '20s', target: 150 },
  //   // { duration: '50s', target: 150 }, 
  //   // { duration: '20s', target: 200 },
  //   // { duration: '50s', target: 200 },
  //   // { duration: '20s', target: 250 },
  //   // { duration: '50s', target: 250 },
  //   // { duration: '20s', target: 300 },
  //   // { duration: '50s', target: 350 },

  //   { duration: '30s', target: 0 },
  // ],
};

export default function () {
  console.log(generateUrl('5ccf6b6e-d5d4-4310-b442-3c4ee3e62e75'));
  
  var response = ws.connect(generateUrl('5ccf6b6e-d5d4-4310-b442-3c4ee3e62e75'), null, function (socket) {
    socket.on('open', function open() {

    });

    socket.on('message', function (message) {
      var body = {};
      try {
        body = JSON.parse(message);
      } catch(e) {
        return;
      }

      if (body.method === 'onConnect' && body.data && body.data.type === 'connectionAccept') {
        socket.send(generateMessage('emojiFeedback', {
          color:'#d84e43',
          disabled:false,
          groupId:1,
          id:1,
          name:'Laughing',
          ts: (new Date()).getTime(),
          url:'./assets/emojis/grin-beam-light.svg',
        }));
      }
    });
  });

  check(response, { 'status is 101': (r) => r && r.status === 101 });
}
