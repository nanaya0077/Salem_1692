/**
 * 发牌相位（#10）公共步骤：选第一张候选角色，然后确认身份卡。
 * 全员选好且确认后服务端自己推进到黎明，所以轮询到相位变了就算完成。
 * 调用时机在 start 之后：先等发牌相位的投影到，避免抢在开局前发命令。
 */
export async function passDealPhase({ seatId, getProjection, getPrivate, send, waitFor, timeout = 8000 }) {
  const phase = () => getProjection()?.phase ?? null;
  const currentSeat = () => getProjection()?.seats?.find((s) => s.id === seatId) ?? null;

  await waitFor("进入发牌相位", () => phase() !== null && phase() !== "lobby", timeout);
  if (phase() !== "deal") return;

  const seat = currentSeat();
  if (seat && !seat.roleChosen && (seat.roleOptions ?? []).length) {
    send({
      type: "action",
      commandId: "deal-role-" + seatId,
      action: { kind: "chooseRole", roleId: seat.roleOptions[0] },
    });
    await waitFor("座位 " + seatId + " 选好角色", () => currentSeat()?.roleChosen === true || phase() !== "deal", timeout);
  }
  if (phase() !== "deal") return;
  if (getPrivate()?.acknowledged === true) return;

  send({ type: "action", commandId: "deal-ack-" + seatId, action: { kind: "dealAck" } });
  await waitFor("座位 " + seatId + " 确认发牌", () => phase() !== "deal" || getPrivate()?.acknowledged === true, timeout);
}
