// Stand-in for `next/headers`. Tests call setCookie() to choose what cookies() returns.
const jar = new Map<string, string>();

export const setCookie = (name: string, value: string) => void jar.set(name, value);
export const clearCookies = () => jar.clear();

export async function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  };
}
