import { PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface PolishPostingInfo extends PostingInfo {
  attorneyPowerId: string;
  reasonForPosting: string;
  postCompanyCorrespondenceAddress: PostingInfoAddress;
  documentsKeepingAddress: PostingInfoAddress;
  nameOfDocumentsKeepingLocation: string;
}
