export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = items.slice();
  const current = next[index];
  next[index] = next[nextIndex];
  next[nextIndex] = current;
  return next;
}
