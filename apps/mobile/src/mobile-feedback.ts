export type DeferredMobileOperationScheduler = (task: () => void) => void;

export function deferMobileOperation(
  operation: () => Promise<void>,
  onError: (error: unknown) => void,
  scheduler: DeferredMobileOperationScheduler = (task) => {
    setTimeout(task, 0);
  },
): void {
  scheduler(() => {
    void operation().catch(onError);
  });
}
