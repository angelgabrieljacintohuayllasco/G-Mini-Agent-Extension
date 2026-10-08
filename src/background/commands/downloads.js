export async function downloadsList(api, { limit }) {
  // Safari no implementa la API de descargas.
  if (typeof api.downloads?.search !== 'function') {
    return { success: false, error: 'Downloads API is not available in this browser' };
  }
  const items = await api.downloads.search({ limit, orderBy: ['-startTime'] });
  const downloads = items.map(({ id, filename, url, state, fileSize, startTime, endTime, mime }) => ({
    id,
    filename,
    url,
    state,
    fileSize,
    startTime,
    endTime,
    mime,
  }));
  return { success: true, downloads, count: downloads.length };
}
