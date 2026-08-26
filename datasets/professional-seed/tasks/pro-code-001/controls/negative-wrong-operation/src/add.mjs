export function add(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new TypeError('add requires finite numbers');
  }
  return left * right;
}
