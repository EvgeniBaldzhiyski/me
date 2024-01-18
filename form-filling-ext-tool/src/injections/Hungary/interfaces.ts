import { PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface HungaryPostingInfo extends PostingInfo {
  formIdentificationName: string;
  natureOfTheService: string;
  workplaceAddress: PostingInfoAddress;
}
