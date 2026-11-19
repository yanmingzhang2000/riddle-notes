/**
 * 字节处理的小工具。
 *
 * TS 5.7+ 里 Uint8Array 默认是 Uint8Array<ArrayBufferLike>,而 Web Crypto 的参数要 ArrayBuffer 支撑的
 * BufferSource,因为 SharedArrayBuffer 不能传给它。这里的数据全部来自 new Uint8Array(n) 或 subtle 的返回值,
 * 都是 ArrayBuffer 支撑的,所以用类型断言。不用 Uint8Array<ArrayBuffer> 是因为 package.json 允许 TS 5.6。
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

/** 清零。Uint8Array 只清它自己的视图范围,ArrayBuffer 整个清 */
export function wipe(buffer: ArrayBuffer | Uint8Array): void {
  if (ArrayBuffer.isView(buffer)) {
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0);
  } else {
    new Uint8Array(buffer).fill(0);
  }
}
