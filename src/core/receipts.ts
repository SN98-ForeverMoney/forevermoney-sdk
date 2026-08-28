export interface ReceiptLog {
    readonly address: string
    readonly data: string
    readonly topics: readonly string[]
}

export interface TransactionReceiptLike {
    readonly logs: readonly ReceiptLog[]
}

export function isLogFrom(log: ReceiptLog, address: string): boolean {
    return log.address.toLowerCase() === address.toLowerCase()
}
