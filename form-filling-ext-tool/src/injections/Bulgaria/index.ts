import { TargetPosting } from '../../utils/comm.map';
import {ProcessingEnterType, enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import { BulgariaPostingInfo, localNeedsState } from './interfaces';
import {
  addAllEmployees, fillContactPerson, fillCustomerRecipient, fillEmployeeData,
  fillPersonOfLiase, fillPlaceOfPosting, fillPostingPerson
} from './lib';
import { Targets } from '../../targets.enum';

void enter(Targets.Bulgaria, (targetPosting: TargetPosting<BulgariaPostingInfo, localNeedsState>, type: ProcessingEnterType) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  if (type === 'push') {
    void fillPostingPerson(posting.data);
  } else {
    const { data: info, state } = posting;
    switch (state?.step) {
      case 0:
        void fillPostingPerson(info);
        break;
      case 1:
        void fillCustomerRecipient(info);
        break;
      case 2:
        void fillPlaceOfPosting(info);
        break;
      case 3:
        void addAllEmployees(info, +(state.employeeIndex || 0), employees);
        break;
      case 4:
        void fillEmployeeData(info, +(state.employeeIndex || 0), employees);
        break;
      case 5:
        void fillPersonOfLiase(info);
        break;
      case 6:
        void fillContactPerson(info);
        break;
      case 7:
        void fillingEnd(fillingIsEndMessage);
        break;
      default:
        console.log('Processing pending');
    }
  }
});
