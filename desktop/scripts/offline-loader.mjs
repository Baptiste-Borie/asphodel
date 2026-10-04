const networkFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('External network disabled for desktop smoke');
  return networkFetch(url, options);
};
