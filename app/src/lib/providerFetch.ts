/** Fetch an AI provider using the browser's network and CORS policies. */
export const providerFetch: typeof fetch = (input, init) => fetch(input, init)
