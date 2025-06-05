import {
  BatchId,
  Bee
} from '@ethersphere/bee-js';

export async function buyStamp(bee: Bee, amount: string | bigint, depth: number, label?: string): Promise<BatchId> {
  const stamp = (await bee.getAllPostageBatch()).find((b) => b.label === label);
  if (stamp && stamp.usable) {
    return stamp.batchID;
  }

  return await bee.createPostageBatch(amount, depth, {
    waitForUsable: true,
    label,
  });
}