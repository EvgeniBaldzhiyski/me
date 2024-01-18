import { TargetPosting, TargetDataState } from '../../utils/comm.map';
import { enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import { SwedenPostingInfo } from './interfaces';
import {
  fillHostCompanyData,
  fillHostCompanyAddress,
  addAllEmployees,
  fillProjectPeriodOfActivities,
  fillPostingSituations,
  fillContactPerson,
} from './lib';
import { element } from '../utils/dom';
import config from '../../utils/config';
import { Targets } from '../../targets.enum';

void enter(
  Targets.Sweden,
  () => {
    try {
      element('#accessibletabsnavigation0-0');
    } catch(error) {
      return { error: config.get<string>(`targets.${window.currentTarget}.invalidEntryPoint`) };
    }

    return {};
  },
  (targetPosting: TargetPosting<SwedenPostingInfo, TargetDataState>) => {
    const { posting, employees } = targetPosting;

    if (!posting) {
      return;
    }

    const { data, state } = posting;

    switch (state?.step) {
      case 0:
        void fillHostCompanyData(data);
        break;
      case 1:
        void fillHostCompanyAddress(data);
        break;
      case 2:
        void addAllEmployees(data, employees);
        break;
      case 3:
        void fillProjectPeriodOfActivities(data, employees);
        break;
      case 4:
        void fillPostingSituations(data);
        break;
      case 5:
        void fillContactPerson(data);
        break;
      case 6:
        void fillingEnd(fillingIsEndMessage);
        break;
    }
  }
);
