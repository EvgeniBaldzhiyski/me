import { TargetDataState } from '../../utils/comm.map';
import { PostingInfo } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}

export interface inputData {
  postingData: PostingInfo;
  postingState: localNeedsState;
  selectEmployeeIds: string[];
}
