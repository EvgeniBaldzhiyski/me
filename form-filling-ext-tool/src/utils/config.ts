declare const CONFIG: Record<string, unknown>;

class Config {
  envs = CONFIG;

  get<T = unknown>(path: string): T {
    const value: T = path
      .split('.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce<any>((node: Record<string, string | number>, key) => node && node[key], this.envs);

    if (value === undefined) {
      throw new Error(`incorrect config path (${path})`);
    }

    return value;
  }
}

export default new Config();
