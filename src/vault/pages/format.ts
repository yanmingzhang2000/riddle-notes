const pad2 = (n: number) => String(n).padStart(2, '0');

/** 本地时间的 YYYY-MM-DD。用本地时间,和用户的时钟一致 */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 本地时间的 YYYY-MM-DD HH:mm */
export function formatDateTime(ms: number): string {
  const date = new Date(ms);
  return `${formatDate(ms)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
