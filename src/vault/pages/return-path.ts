/**
 * 解锁之后回到哪里。守卫把用户从某个保险箱页面踢到解锁页时,会在 location.state.from 里带上原路径。
 * 状态是路由状态,理论上可以被构造,所以只接受 /vault 之内的路径,并且不回到解锁、设置、恢复这三个页面
 * (回去会形成循环)。其他一律回保险箱首页。
 */
const AUTH_ROUTES = ['/vault/setup', '/vault/unlock', '/vault/recover'];

export function vaultReturnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (typeof from !== 'string') return '/vault';
  if (from !== '/vault' && !from.startsWith('/vault/')) return '/vault';
  if (AUTH_ROUTES.some(route => from === route || from.startsWith(`${route}/`) || from.startsWith(`${route}?`))) {
    return '/vault';
  }
  return from;
}
