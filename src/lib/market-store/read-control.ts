/** Retired payloads cannot be recovered by switching a read gate back to Firestore. */
export function assertReadControl(data: Record<string, unknown> | undefined): asserts data is Record<string, unknown> & {ready:boolean} {
    if (data?.version !== 1 || typeof data.ready !== 'boolean')
        throw Error('Market migration control is missing or invalid');
    if (!data.ready && Array.isArray(data.cleanedCollections) && data.cleanedCollections.length)
        throw Error('Firestore fallback is retired for cleaned market collections');
}
