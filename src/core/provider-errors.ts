import { ForeverMoneyError } from './errors.js'

function stringProperty(value: unknown, property: string): string | undefined {
    if (typeof value !== 'object' || value === null || !(property in value)) {
        return undefined
    }
    const entry = (value as Record<string, unknown>)[property]
    return typeof entry === 'string' ? entry : undefined
}

export async function providerOperation<T>(
    operation: string,
    action: () => Promise<T>
): Promise<T> {
    try {
        return await action()
    } catch (error) {
        if (error instanceof ForeverMoneyError) throw error
        const causeCode = stringProperty(error, 'code')
        const reason = stringProperty(error, 'reason')
        const reverted = causeCode === 'CALL_EXCEPTION'
        throw new ForeverMoneyError(
            reverted ? 'SIMULATION_REVERTED' : 'RPC_ERROR',
            reverted ? `${operation} reverted.` : `${operation} failed.`,
            {
                ...(causeCode === undefined ? {} : { causeCode }),
                ...(reason === undefined ? {} : { reason }),
            }
        )
    }
}
