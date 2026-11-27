// Test files read response bodies as loose JSON.
interface Response {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json<T = any>(): Promise<T>;
}
