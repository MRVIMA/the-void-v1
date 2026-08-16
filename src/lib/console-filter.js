/**
 * libsignal writes complete ratchet sessions (including private key material)
 * directly to console.info, bypassing Baileys' configured logger. Suppress only
 * those known dumps; all application and diagnostic console output is retained.
 */
export function installSignalLogFilter() {
  if (globalThis.__signalLogFilterInstalled) return;
  globalThis.__signalLogFilterInstalled = true;

  const originalInfo = console.info.bind(console);
  const sensitivePrefixes = [
    'Closing session:',
    'Opening session:',
    'Removing old closed session:',
  ];

  console.info = (...args) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (sensitivePrefixes.some((prefix) => first.startsWith(prefix))) return;
    originalInfo(...args);
  };
}

export default installSignalLogFilter;
