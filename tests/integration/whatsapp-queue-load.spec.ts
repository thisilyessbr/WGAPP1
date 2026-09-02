import { describe, it, expect } from 'vitest';
import { PartitionedFifoQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';

describe('PHASE WHATSAPP-QUEUE-DISTRIBUTED-IDEMPOTENCY-AUDIT-IMPLEMENT-39: Load & Stress Test', () => {
  it('1. Handles 1,000 distinct users with 10,000 total messages preserving 100% FIFO correctness', async () => {
    const queue = new PartitionedFifoQueue<InboundQueueJob>();
    const TOTAL_USERS = 1000;
    const MSGS_PER_USER = 10;
    const TOTAL_MSGS = TOTAL_USERS * MSGS_PER_USER;

    // Track processed messages per user to verify strict FIFO ordering
    const userProcessedSequences = new Map<string, number[]>();
    for (let u = 0; u < TOTAL_USERS; u++) {
      userProcessedSequences.set(`user-${u}`, []);
    }

    let processedCount = 0;

    queue.registerHandler(async (job) => {
      const seqNum = Number(job.message.replace('seq-', ''));
      const list = userProcessedSequences.get(job.waId);
      if (list) {
        list.push(seqNum);
      }
      processedCount++;
    });

    const startTime = Date.now();

    // 1. Enqueue 10,000 messages interleaved across 1,000 partitions
    for (let m = 0; m < MSGS_PER_USER; m++) {
      for (let u = 0; u < TOTAL_USERS; u++) {
        const userId = `user-${u}`;
        const partitionKey = `tenant-1:acc-1:${userId}`;
        const job: InboundQueueJob = {
          id: `wamid.${userId}.${m}`,
          partitionKey,
          tenantId: 'tenant-1',
          accountId: 'acc-1',
          phoneNumberId: 'phone-1',
          waId: userId,
          wamid: `wamid.${userId}.${m}`,
          message: `seq-${m}`,
          timestamp: Date.now(),
          rawType: 'text',
          enqueuedAt: Date.now()
        };
        await queue.enqueue(job, partitionKey);
      }
    }

    const enqueueDuration = Date.now() - startTime;
    const enqueueRate = Math.round((TOTAL_MSGS / enqueueDuration) * 1000);

    // Wait for all 10,000 jobs to process
    while (processedCount < TOTAL_MSGS) {
      await new Promise(r => setTimeout(r, 20));
    }

    const totalProcessingDuration = Date.now() - startTime;
    const overallThroughput = Math.round((TOTAL_MSGS / totalProcessingDuration) * 1000);

    // 2. Verify all 10,000 messages processed
    expect(processedCount).toBe(TOTAL_MSGS);

    // 3. Verify strict FIFO ordering for every single one of the 1,000 users
    const expectedSequence = Array.from({ length: MSGS_PER_USER }, (_, i) => i);
    for (let u = 0; u < TOTAL_USERS; u++) {
      const actualSequence = userProcessedSequences.get(`user-${u}`);
      expect(actualSequence).toEqual(expectedSequence);
    }

    // 4. Verify queue is fully drained
    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getActiveCount()).toBe(0);

    console.log(`[LOAD TEST RESULTS]`);
    console.log(`- Total Messages: ${TOTAL_MSGS}`);
    console.log(`- Total Partitions / Users: ${TOTAL_USERS}`);
    console.log(`- Enqueue Time: ${enqueueDuration}ms (${enqueueRate} msgs/sec)`);
    console.log(`- Total Process Time: ${totalProcessingDuration}ms (${overallThroughput} msgs/sec)`);
    console.log(`- FIFO Accuracy: 100.00% (1,000/1,000 user queues verified)`);
  });
});
