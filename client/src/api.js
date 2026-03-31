async function req(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  dashboard: {
    get: () => req('GET', '/api/dashboard'),
  },

  assets: {
    list: (includeArchived = false) =>
      req('GET', `/api/assets${includeArchived ? '?includeArchived=true' : ''}`),
    get: (id) => req('GET', `/api/assets/${id}`),
    create: (data) => req('POST', '/api/assets', data),
    update: (id, data) => req('PUT', `/api/assets/${id}`, data),
    archive: (id) => req('DELETE', `/api/assets/${id}`),
    xirrSummary: () => req('GET', '/api/assets/xirr-summary'),
    xirr: (id, period = 'all') => req('GET', `/api/assets/${id}/xirr?period=${period}`),
  },

  transactions: {
    list: (assetId) => req('GET', `/api/transactions?assetId=${assetId}`),
    create: (data) => req('POST', '/api/transactions', data),
    delete: (id) => req('DELETE', `/api/transactions/${id}`),
  },

  prices: {
    list: (assetId) => req('GET', `/api/prices?assetId=${assetId}`),
    create: (data) => req('POST', '/api/prices', data),
    delete: (id) => req('DELETE', `/api/prices/${id}`),
    refreshAll: () => req('POST', '/api/prices/refresh'),
    refreshOne: (assetId) => req('POST', `/api/prices/refresh/${assetId}`),
    bndFunds: () => req('GET', '/api/prices/bnd-funds'),
  },

  snapshots: {
    list: (assetId) => req('GET', `/api/snapshots?assetId=${assetId}`),
    create: (data) => req('POST', '/api/snapshots', data),
    delete: (id) => req('DELETE', `/api/snapshots/${id}`),
  },

  liabilities: {
    list: () => req('GET', '/api/liabilities'),
    get: (id) => req('GET', `/api/liabilities/${id}`),
    create: (data) => req('POST', '/api/liabilities', data),
    update: (id, data) => req('PUT', `/api/liabilities/${id}`, data),
    delete: (id) => req('DELETE', `/api/liabilities/${id}`),
  },

  liabilitySnapshots: {
    list: (liabilityId) => req('GET', `/api/liability-snapshots?liabilityId=${liabilityId}`),
    create: (data) => req('POST', '/api/liability-snapshots', data),
    delete: (id) => req('DELETE', `/api/liability-snapshots/${id}`),
  },

  benchmark: {
    list: () => req('GET', '/api/benchmark'),
    create: (data) => req('POST', '/api/benchmark', data),
    delete: (id) => req('DELETE', `/api/benchmark/${id}`),
    getReturn: (from, to) => req('GET', `/api/benchmark/return?from=${from}&to=${to}`),
  },

  cpi: {
    list: () => req('GET', '/api/cpi'),
    create: (data) => req('POST', '/api/cpi', data),
    delete: (id) => req('DELETE', `/api/cpi/${id}`),
  },

  portfolio: {
    xirr: (period = 'all') => req('GET', `/api/portfolio/xirr?period=${period}`),
    history: () => req('GET', '/api/portfolio/history'),
    contributionsVsGrowth: () => req('GET', '/api/portfolio/contributions-vs-growth'),
    yearlySummary: () => req('GET', '/api/portfolio/yearly-summary'),
  },

  import: {
    mappings: (broker) => req('GET', `/api/import/mappings${broker ? '?broker=' + broker : ''}`),
    preview: async (file, format) => {
      const fd = new FormData();
      fd.append('file', file);
      if (format) fd.append('format', format);
      const res = await fetch('/api/import/preview', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    commit: (rows, mappings) => req('POST', '/api/import/commit', { rows, mappings }),
  },
};
