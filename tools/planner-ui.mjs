// Existing interaction checks accept either interface casing. Focused checks
// separately verify lowercase presentation and ASCII punctuation.
export function plannerUI(target) {
  return new Proxy(target, { get(object, property) {
    const value = object[property];
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (property === 'getByRole' && typeof args[1]?.name === 'string') {
        const options = args[1], pattern = options.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        args[1] = { ...options, name: new RegExp(options.exact ? `^${pattern}$` : pattern, 'i') };
      }
      const result = value.apply(object, args);
      return result && typeof result.locator === 'function' && typeof result.getByRole === 'function' ? plannerUI(result) : result;
    };
  } });
}
