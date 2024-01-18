import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { ProcessingEnterType, enter, fillingEnd } from '../utils/simplify-api';
import { PortugalPostingInfo, localNeedsState } from './interfaces';
import {
  run, runStep0, runStep1, runStep10, runStep11, runStep12, runStep13, runStep14, runStep15, runStep16,
  runStep17, runStep2, runStep3, runStep4, runStep50, runStep51, runStep52, runStep6, runStep7, runStep8, runStep9,
} from './lib';
import { Targets } from '../../targets.enum';

void enter(Targets.Belgium, (targetPosting: TargetPosting<PortugalPostingInfo, localNeedsState>, type: ProcessingEnterType) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  if (type === 'push') {
    void run(posting.data);
  } else {
    const { data: info, state } = posting;

    switch (state.step) {
      case 0:
        void runStep0();
        break;
      case 1:
        void runStep1(info);
        break;
      case 2:
        void runStep2();
        break;
      case 3:
        void runStep3(info);
        break;
      case 4:
        void runStep4(info);
        break;
      case 5: {
        switch (state.phase) {
          case 0:
            void runStep50(info);
            break;
          case 1:
            void runStep51(info);
            break;
          case 2:
            void runStep52(info);
            break;
        }
        break;
      }
      case 6:
        void runStep6(info);
        break;
      case 7:
        void runStep7();
        break;
      case 8:
        void runStep8();
        break;
      case 9:
        void runStep9();
        break;
      case 10:
        void runStep10();
        break;
      case 11:
        void runStep11(info);
        break;
      case 12:
        void runStep12(info, +(state.employeeIndex || 0), employees);
        break;
      case 13:
        void runStep13(info, +(state.employeeIndex || 0), employees);
        break;
      case 14:
        void runStep14();
        break;
      case 15:
        void runStep15(info);
        break;
      case 16:
        void runStep16();
        break;
      case 17:
        void runStep17();
        break;
      case 18:
        void fillingEnd(fillingIsEndMessage);
        break;
    }
  }
});
