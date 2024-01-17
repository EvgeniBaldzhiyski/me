import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { generateMessage, parseMessage, generateUrl } from './utils.js';

export let options = { 
  stages: [
    { duration: '2s', target: 2 }, // add 2 in 2 sek
    { duration: '3m', target: 2 }, // keep for 3 mins

    { duration: '2s', target: 0 } // remove all in 2 secs
  ],
};

var details;

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
        details = body.data.data.attendeesIndex[body.data.data.attendeeID];

        socket.send(generateMessage('emojiFeedback', {
          color: '#d84e43',
          disabled: false,
          groupId: 1,
          id: 1,
          name: 'Laughing',
          ts: (new Date()).getTime(),
          url: './assets/emojis/grin-beam-light.svg',
        }));
      }

      if (details && body.method === 'onChatMessage') {
        parseCommand(body.data.post, socket);
      }
    });
  });

  check(response, { 'status is 101': (r) => r && r.status === 101 });
}

// @sut:command-name:command-value:...
function parseCommand(post, socket) {
  if (post[0] !== '@') {
    return;
  }

  var cmd = post.split(":");

  if (cmd[0] !== '@sut') {
    return;
  }

  execCommand(cmd, socket);
}

function execCommand(cmd, socket) {
  if (cmd[1] === 'send-msg') {
    function sendChatMsg(iteration) {
      socket.send(generateMessage('onChatMessage', {
        from: details.id,
        post: '('+iteration+') ' + cmd[2],
        to: ""
      }));
    }

    if (cmd[3]) {
      var max = cmd[4] || 1;
      var spl = cmd[3] == 'r' ? getRandomArbitrary(2, 5) : cmd[3];

      for(var i = 0; i < max; i++) {
        sleep(spl);
        
        sendChatMsg(i);
      }
    } else {
      sendChatMsg();
    }
  }

  if (cmd[1] === 'empty-command') {
    // write your code here 
  }
}

function getRandomArbitrary(min, max) {
  return Math.random() * (max - min) + min;
}
