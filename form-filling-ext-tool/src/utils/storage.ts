import { Targets } from '../targets.enum';
import { TargetData } from './comm.map';

class RuntimeStorage {
  private targetPostings = new Map<Targets, object[]>();
  private targetInfo = new Map<Targets, TargetData>();

  private selectedPostingId = new Map<Targets, string>();
  private selectedEmployees = new Map<Targets, string[]>();

  getTargetPostings(target: Targets): object[] {
    return this.targetPostings.get(target);
  }

  getTarget<D = object, S = unknown>(target: Targets): TargetData<D, S> | undefined {
    return this.targetInfo.get(target) as TargetData<D, S>;
  }

  setTarget<D = object, S = unknown>(target: Targets, data: TargetData): TargetData<D, S> {
    const targetData = this.getTarget(target) || {};
    const updatedData = {...targetData, ...data, time: Date.now()};

    this.targetInfo.set(target, updatedData);

    return updatedData as TargetData<D, S>;
  }

  setTargetPostings(target: Targets, postings: object[]) {
    this.targetPostings.set(target, postings);
  }

  removeTarget(target: Targets): boolean {
    return this.targetInfo.delete(target);
  }

  removeTargetPostings(target: Targets): boolean {
    return this.targetPostings.delete(target);
  }

  getSelectedPostingId(target: Targets): string {
    return this.selectedPostingId.get(target);
  }

  setSelectedPostingId(target: Targets, id: string): void {
    this.selectedPostingId.set(target, id);
  }

  deleteSelectedPostingId(target: Targets): boolean {
    return this.selectedPostingId.delete(target);
  }

  getSelectedEmployees(target: Targets): string[] {
    return this.selectedEmployees.get(target);
  }

  setSelectedEmployees(target: Targets, ids: string[]): void {
    this.selectedEmployees.set(target, ids);
  }

  deleteSelectedEmployees(target: Targets): boolean {
    return this.selectedEmployees.delete(target);
  }
}

export const runtimeStorage = new RuntimeStorage();
