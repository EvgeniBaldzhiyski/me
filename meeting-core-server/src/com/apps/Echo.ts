import { Application } from '../utils/Application';
import { ApmTransaction, TransactionType } from '@container/apm-utils';
import { ServerRequest, ServerResponse } from '../utils/Server';
import { Get, Post, Socket } from '../gateway/decorators/method.decorator';
import { res, req } from '../gateway/decorators/argument.decorator';
import { ErrorCodes } from '@container/models';
import { AppInstanceMessagingEvents } from '../utils/AppInstance';


export default class Echo extends Application {

  async destruct(code: ErrorCodes) {
    this.server.sendMessage(AppInstanceMessagingEvents.SHUTDOWN, {});

    return super.destruct(code);
  }

  @Socket('echo')
  onEcho(data, cl?) {
    this.server.sendTo('echo', {
      app: this.name,
      client: (cl ? cl.data : {}),
      message: data
    });
  }

  @Get('echo')
  @Post('echo')
  onHttpEcho(data, @res res: ServerResponse, @req req: ServerRequest) {
    res.send(200, {
      app: this.name,
      method: req.method,
      message: data
    });
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onConnect(client) {
    if (client.data.methods) {
      client.data.methods.split(',').forEach(method => {
        this.server.onSocket(method, (_, data) => {
          this.server.sendTo(method, data);
        });
      });
    }

    this.server.sendTo('join', {
      app: this.name,
      client: client.data,
      message: 'Welcome'
    });
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  onDisconnect(client) {
    this.server.sendTo('leave', {
      app: this.name,
      client: client.data,
      message: 'Goodby'
    });
  }
}
