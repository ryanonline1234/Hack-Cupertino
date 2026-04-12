import { readFileSync } from 'node:fs';

const USDA_CSV_PATH = new URL('../../public/data/food_atlas.csv', import.meta.url);

export function installUsdaCsvFetchMock() {
  const originalFetch = globalThis.fetch;
  const csvText = readFileSync(USDA_CSV_PATH, 'utf8');

  globalThis.fetch = async function mockedFetch(input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input?.url || '';

    if (url === '/data/food_atlas.csv' || url.endsWith('/data/food_atlas.csv')) {
      return new Response(csvText, {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      });
    }

    if (typeof originalFetch === 'function') {
      return originalFetch(input, init);
    }

    throw new Error(`Unexpected fetch call in test: ${url}`);
  };

  return function restoreFetch() {
    globalThis.fetch = originalFetch;
  };
}
