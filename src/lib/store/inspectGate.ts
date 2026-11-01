/**
 * 「元素检视」请求闸门。
 *
 * 一次点击要 await 索引补建（可能几次网络往返），而人是连着点的：第二次点击开始后，
 * 第一次的 Promise 仍可能在更晚的时候完成，然后把面板写成上一个元素的数据 ——
 * 甚至第一次没命中、返回空结果，把第二次已经开好的面板关掉。
 *
 * 规矩：每次请求领一张号（单调递增），每个 await 之后、最终 set 之前验票；
 * 过期就整份丢弃。切文档 / 关抽屉时把在途请求一并作废（epoch +1）。
 *
 * 放在模块级而不是 zustand state 里：它纯粹是请求簿记，不该进持久化快照、
 * 也不该触发重渲染；坏处只是测试里需要 reset。
 */

export type InspectTicket = {
  /** 单调递增的请求号：后来的点击一定更大 */
  id: number;
  /** 作废代数：切文档 / 关抽屉后变大 */
  epoch: number;
};

let nextId = 0;
let epoch = 0;

/** 领一张票（每次检视请求一张）。 */
export function beginInspect(): InspectTicket {
  nextId += 1;
  return { id: nextId, epoch };
}

/**
 * 作废所有在途请求：切文档、关抽屉、重新载入预览时调用。
 * 已经在 await 里的请求不会被打断，但它们醒过来验票时会发现自己过期了。
 */
export function invalidateInspect(): void {
  epoch += 1;
}

/** 这张票还算数吗：之后没有更新的请求，也没有发生作废。 */
export function isInspectCurrent(ticket: InspectTicket): boolean {
  return ticket.id === nextId && ticket.epoch === epoch;
}

/** 测试用：闸门复位。 */
export function resetInspectGate(): void {
  nextId = 0;
  epoch = 0;
}
