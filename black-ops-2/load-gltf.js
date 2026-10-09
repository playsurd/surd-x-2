// Consume the native response body before parsing a model. Keeping progress
// bookkeeping outside a replacement ReadableStream avoids fetch cancellation
// during concurrent model loading and avoids an extra copy of every GLB.
async function fetchBuffer(loader, url, onProgress) {
  const response = await fetch(String(url), {
    headers: loader.requestHeader,
    credentials: loader.withCredentials ? 'include' : 'same-origin',
    signal: loader.manager.abortController.signal,
  });
  if (!response.ok) throw new Error(`Model ${url.pathname}: HTTP ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  onProgress?.({ loaded: 0, total, lengthComputable: total > 0 });
  const data = await response.arrayBuffer();
  onProgress?.({ loaded: data.byteLength, total: data.byteLength, lengthComputable: true });
  return { data, url: response.url || url };
}

const configuredLoaders = new WeakSet();

function configureExternalBuffers(loader) {
  if (configuredLoaders.has(loader)) return;
  loader.register(parser => {
    // Buffer views share one fetch per external buffer within this parse.
    // Embedded GLBs continue through GLTFLoader's normal in-memory path.
    const buffers = new Map();
    return {
      name: 'NATIVE_external_buffers',
      loadBufferView(index) {
        const view = parser.json.bufferViews[index];
        const buffer = parser.json.buffers[view.buffer];
        if (buffer.uri === undefined) return null;
        if (!buffers.has(view.buffer)) {
          const source = new URL(buffer.uri, parser.options.path).href;
          const url = new URL(loader.manager.resolveURL(source), "https://cdn.jsdelivr.net/gh/playsurd/surd-x-2@main/black-ops-2/");
          buffers.set(view.buffer, fetchBuffer(loader, url).then(({ data }) => {
            if (data.byteLength < buffer.byteLength) throw new Error(`Model ${url.pathname}: truncated buffer`);
            return data;
          }));
        }
        return buffers.get(view.buffer).then(data => {
          const start = view.byteOffset ?? 0;
          return data.slice(start, start + view.byteLength);
        });
      },
    };
  });
  configuredLoaders.add(loader);
}

export async function loadGltf(loader, source, onProgress) {
  configureExternalBuffers(loader);
  const url = new URL(loader.manager.resolveURL(source), "https://cdn.jsdelivr.net/gh/playsurd/surd-x-2@main/black-ops-2/");
  const result = await fetchBuffer(loader, url, onProgress);
  return loader.parseAsync(result.data, new URL('.', url).href);
}
