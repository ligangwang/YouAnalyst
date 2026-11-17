/** BulkWriter buffers the final partial batch until flush/close. Attach result
 * handlers before flushing so failures are observed without unhandled rejection. */
export async function flushBulkWrites<T>(writer:{flush:()=>Promise<void>},writes:Promise<T>[]):Promise<PromiseSettledResult<T>[]> {
    const results=Promise.allSettled(writes);
    await writer.flush();
    return results;
}
