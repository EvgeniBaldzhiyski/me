import crypto from 'crypto';
import uuidv4 from 'uuid/v4';

export default class HashUtils {
  static md5(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  static guid(): string {
    // we use https://www.npmjs.com/package/uuid
    return uuidv4();
  }
}
