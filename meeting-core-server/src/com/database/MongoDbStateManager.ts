import { Collection } from 'mongodb';

export class MongoDbStateManager<T> {
  private collectionIndexPromise: Promise<string>;
  constructor(
    protected readonly collection: Collection,
    protected mid: string
  ) {
  }

  async initialize() {
    if (!this.collectionIndexPromise) {
      this.collectionIndexPromise = this.collection.createIndex({ stateRefId: 1 });
    }

    return await this.collectionIndexPromise;
  }

  async saveState(state: T): Promise<void> {
    await this.collection.replaceOne(
      { stateRefId: this.mid },
      { stateRefId: this.mid, ...state },
      { upsert: true }
    );
  }

  async loadState(): Promise<T> {
    return await this.collection.findOne<T>({ stateRefId: this.mid });
  }

  async deleteState(): Promise<void> {
    await this.collection.deleteOne({ stateRefId: this.mid });
  }
}

export async function createMongoDbStateManager(collection: Collection, mid: string) {
  const stateManager = new MongoDbStateManager(collection, mid);
  try {
    await stateManager.initialize();
    return stateManager;
  } catch {
    throw new Error('Mongodb creation failed creation');
  }
}
