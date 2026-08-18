const entries = new Map();

export async function cached(key, loader) {
  if (!entries.has(key)) entries.set(key, loader());
  return entries.get(key);
}
