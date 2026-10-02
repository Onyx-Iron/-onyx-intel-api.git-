/** Share one in-flight lookup per key, then keep the resolved value. */
export function coalesceAsync<T>(
  cache: Map<string, T>,
  inflight: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = load()
    .then((value) => {
      cache.set(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
