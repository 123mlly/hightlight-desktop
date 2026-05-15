type Task<T> = () => Promise<T>;

export class JobQueue {
  private chain: Promise<unknown> = Promise.resolve();

  enqueue<T>(fn: Task<T>): Promise<T> {
    const run = this.chain.then(() => fn());
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }
}
