import apm from 'elastic-apm-node/start';
import { ApmSpan, ApmTransaction, TransactionType } from '@container/apm-utils';
import BaseModule from './../BaseModule';
import Meeting from '../../Meeting';
import { Subject, timer as timerObservable } from 'rxjs';
import { switchMap, mapTo, startWith, scan, takeWhile, takeUntil } from 'rxjs/operators';

import {
  Attendee, ClientConnectionAPI,
  ServerConnectionAPI,
  TimerActionData,
  TimerClass, TimerFormClass,
  TimerName, TimersClass,
  TimerSource, TimerState,
  TimerType, TimerTypeName, TimerVisibility
} from '@container/models';

interface counterOne {
  endRange: number,
  currentNumber: number
}

export default class TimersModule extends BaseModule {

  private _counterOneSub$: Subject<counterOne | false>;
  private _counterTwoSub$: Subject<counterOne | false>;
  private _onDestroy$ = new Subject();

  private timerOneActiveCounter: TimerType;
  private timerTwoActiveCounter: TimerType;

  private countInterval = 1000;
  private stopWatchMaxVal = 14400;
  private syncInterval = 5;

  private timer1: TimerClass;
  private timer2: TimerClass;
  private pausedTime: Record<string, number> = {};

  private testRoomLogMessage = 'Unexpected Action in TimersModule for Test Room.';

  private timeInMili = 0;

  constructor(protected inst: Meeting) {
    super(inst);

    this.timer1 = this.timerFactory(TimerName.TIMER_1);
    this.timer2 = this.timerFactory(TimerName.TIMER_2);

    this.inst.server.onSocket(ServerConnectionAPI.TIMER_INIT,
      (client) => this.timerInit(client)
    );

    this.inst.server.onSocket(ServerConnectionAPI.TIMER_ACTION,
      (client, data) => this.timerAction(client, data)
    );

    this.inst.server.onSocket(ServerConnectionAPI.TIMER_VISIBILITY,
      (client, data) => this.applyTimerVisibility(client, data)
    );

    this._counterOneSub$ = this.createCounter(TimerSource.TIMER1);
    this._counterTwoSub$ = this.createCounter(TimerSource.TIMER2);
  }

  destruct() {
    this._onDestroy$.next();
    this._onDestroy$.complete();

    this._onDestroy$ = null;
    this._counterOneSub$ = null;
    this._counterTwoSub$ = null;

    return super.destruct();
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  timerAction(client, data: TimerActionData) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      const errorMessage = `Cannot run timerAction(). Attendee (${client.data.aid}) not found`;
      apm.captureError(new Error(errorMessage));
      this.inst.logger.error(errorMessage);
      return;
    }
    if (attendee.room !== '' && this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }

    const isMainRoomPresenter = this.inst.roomEngine.isRoomPresenter(attendee, '');
    if (!isMainRoomPresenter) {
      return;
    }

    switch (data.action) {
      case TimerState.START:
        this.timerStart(attendee, data);
        break;
      case TimerState.STOP:
        this.timerStop(attendee, data);
        break;
      case TimerState.PAUSE:
        this.timerPause(attendee, data);
        break;
      case TimerState.RESUME:
        this.timerResume(attendee, data);
        break;
    }
  }

  @ApmSpan()
  timerStart(attendee: Attendee, data: TimerActionData) {
    const senderID = attendee.id;
    const timer = this[data.timerSource].timers[data.timerType];
    const endRange = this.getEndRange(data);

    timer.initialValue = (data.timerForm.minutes * 60);
    timer.start = (data.timerForm.minutes * 60);

    if (data.timerType === TimerTypeName.STOPWATCH) {
      timer.initialValue = 0;
      timer.start = 0;
    }

    timer.end = endRange;
    timer.state = data.action;
    this[data.timerSource].timerForm = data.timerForm;

    const startValue = timer.initialValue;

    if (data.timerSource === TimerSource.TIMER1) {
      this.timerOneActiveCounter = timer;
      this._counterOneSub$.next({currentNumber: startValue, endRange: endRange});
    } else {
      this.timerTwoActiveCounter = timer;
      this._counterTwoSub$.next({currentNumber: startValue, endRange: endRange});
    }

    this.inst.server.sendTo(ClientConnectionAPI.TIMER_ACTION, {senderID: senderID, data});

  }

  @ApmSpan()
  timerStop(attendee: Attendee, data) {
    const senderID = attendee.id;
    const timer = this[data.timerSource].timers[data.timerType];

    timer.initialValue = null;
    timer.state = data.action;

    this.pauseStopCounter(data);

    this.inst.server.sendTo(ClientConnectionAPI.TIMER_ACTION, {senderID: senderID, data});
  }

  @ApmSpan()
  timerPause(attendee: Attendee, data) {
    const senderID = attendee.id;
    const timer = this[data.timerSource].timers[data.timerType];
    this.pausedTime[data.timerSource] = timer.initialValue;

    timer.state = data.action;

    this.pauseStopCounter(data);

    this.inst.server.sendTo(ClientConnectionAPI.TIMER_ACTION, {senderID: senderID,
      data: {...data, pausedTime: this.pausedTime[data.timerSource]}});
  }

  @ApmSpan()
  timerResume(attendee: Attendee, data) {
    // check if last interaction was before less then 1 sec and if so skip action
    const tmpTime = new Date().getTime();
    if ( tmpTime - this.timeInMili < 1000) {
      return '';
    }
    this.timeInMili = tmpTime;

    const senderID = attendee.id;
    const timer = this[data.timerSource].timers[data.timerType];
    const endRange = timer.end;
    const startValue = this.pausedTime[data.timerSource];

    timer.state = data.action;

    if (data.timerSource === TimerSource.TIMER1) {
      this._counterOneSub$.next({currentNumber: startValue, endRange: endRange});
    } else {
      this._counterTwoSub$.next({currentNumber: startValue, endRange: endRange});
    }

    this.inst.server.sendTo(ClientConnectionAPI.TIMER_ACTION, {senderID: senderID, data: {...data, resumeTime: startValue}});
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  timerInit(client) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      const errorMessage = `Cannot run timerInit(). Attendee (${client.data.aid}) not found`;
      apm.captureError(new Error(errorMessage));
      this.inst.logger.error(errorMessage);
      return;
    }
    if (attendee.room !== '' && this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const timersData = {
      timer1: this.timer1,
      timer2: this.timer2
    };

    this.inst.sendToAttendee(attendee.id, ClientConnectionAPI.TIMER_INIT, timersData);
  }

  @ApmTransaction(TransactionType.WS_REQUEST)
  applyTimerVisibility(client, data: {visibility, timerSource}) {
    const attendee: Attendee = this.inst.model.attendeesIndex[client.data.aid];
    if (!attendee) {
      const errorMessage = `Cannot run applyTimerVisibility(). Attendee (${client.data.aid}) not found`;
      apm.captureError(new Error(errorMessage));
      this.inst.logger.error(errorMessage);
      return;
    }
    if (attendee.room !== '' && this.inst.roomEngine.getRoomById(attendee.room).isTestRoom) {
      this.inst.logger.debug(this.testRoomLogMessage);
      return;
    }
    const senderID = attendee.id;
    const {visibility, timerSource} = data;
    this[timerSource].timers.timerVisibility = visibility;

    this.inst.server.sendTo(ClientConnectionAPI.TIMER_VISIBILITY, {senderID, visibility, timerSource});
  }

  @ApmSpan()
  syncClient(timerSource, timerType, currentCounterTime) {
    if (timerType === TimerTypeName.COUNTDOWN) {
      currentCounterTime += 1;
    }
    if (timerType === TimerTypeName.STOPWATCH) {
      currentCounterTime -= 1;
    }
    this.inst.server.sendTo(ClientConnectionAPI.TIMER_SYNC, {timerSource, timerType, currentCounterTime});
  }

  @ApmSpan()
  createCounter<T>(timerSource): Subject<T> {
    const subs = new Subject<T>();

    subs.pipe(
        switchMap(counterData => {
          return timerObservable(0, this.countInterval).pipe(
            mapTo(this.positiveOrNegative(counterData)),
            startWith(counterData['currentNumber']),
            scan((acc: number, curr: number) => acc + curr),
            takeWhile(this.isApproachingEnd(counterData))
          );
        }),
        takeUntil(this._onDestroy$)
      )
      .subscribe((val: number) => {
        if (timerSource === TimerSource.TIMER1) {
          this.timerOneActiveCounter.initialValue = val;
          if (val % this.syncInterval === 0 &&
              val !== this.timerOneActiveCounter.start &&
              val !== this.timerOneActiveCounter.end) {
            this.syncClient(timerSource, this.timerOneActiveCounter.type, this.timerOneActiveCounter.initialValue);
          }
          if (this.timerOneActiveCounter.initialValue === this.timerOneActiveCounter.end) {
            this.setCounterToStop(this.timerOneActiveCounter);
          }
        } else {
          this.timerTwoActiveCounter.initialValue = val;
          if (val % this.syncInterval === 0 &&
              val !== this.timerTwoActiveCounter.start &&
              val !== this.timerTwoActiveCounter.end) {
            this.syncClient(timerSource, this.timerTwoActiveCounter.type, this.timerTwoActiveCounter.initialValue);
          }
          if (this.timerTwoActiveCounter.initialValue === this.timerTwoActiveCounter.end) {
            this.setCounterToStop(this.timerTwoActiveCounter);

          }
        }
      });

    return subs;
  }

  @ApmSpan()
  timerFactory(timerName: string): TimerClass {
    let countDown: TimerType = {
      state: TimerState.STOP,
      type: TimerTypeName.COUNTDOWN,
      initialValue: null,
      start: 0,
      end: 0
    };
    let stopWatch: TimerType = {
      state: TimerState.STOP,
      type: TimerTypeName.STOPWATCH,
      initialValue: null,
      start: 0,
      end: 0
    }

    let timers = new TimersClass(countDown, stopWatch, TimerVisibility.HIDDEN);
    let timerForm = new TimerFormClass(timerName, TimerTypeName.COUNTDOWN, 1, 'allAttendees', {soundAlert: 'lastSeconds', seconds: 1});

    return new TimerClass(timers, timerForm);
  }

  @ApmSpan()
  pauseStopCounter(data) {
    if (data.timerSource === TimerSource.TIMER1) {
      this._counterOneSub$.next(false);
    } else {
      this._counterTwoSub$.next(false);
    }
  }

  getEndRange(data) {
    let endRange = 0;
    if (data.timerType === TimerTypeName.STOPWATCH) {
      endRange = this.stopWatchMaxVal;
    }

    return endRange;
  }

  @ApmSpan()
  setCounterToStop(curentCounter) {
    curentCounter.state = TimerState.STOP;
    curentCounter.initialValue = null;
    curentCounter.start = 0;
    curentCounter.end = 0;
  }

  positiveOrNegative(counterData) {
    return counterData.endRange > counterData.currentNumber ? 1 : -1;
  }

  isApproachingEnd(counterData) {
    return counterData.endRange > counterData.currentNumber
      ? val => val <= counterData.endRange
      : val => val >= counterData.endRange;
  }

}
