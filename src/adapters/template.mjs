export function expandTemplate(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
    if (!(name in variables)) throw new Error('Unknown command template variable: ' + name);
    return String(variables[name]);
  });
}

export function expandList(values = [], variables) {
  return values.map((value) => expandTemplate(value, variables));
}
