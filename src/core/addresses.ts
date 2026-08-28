import { isHex, u8aToHex } from '@polkadot/util'
import {
    decodeAddress,
    encodeAddress,
    evmToAddress,
} from '@polkadot/util-crypto'
import { ZeroAddress, getAddress, isAddress } from 'ethers'
import { ForeverMoneyError } from './errors.js'

const BITTENSOR_SS58_PREFIX = 42

export function normalizeEvmAddress(value: string): string {
    if (!isAddress(value) || value === ZeroAddress) {
        throw new ForeverMoneyError(
            'INVALID_ADDRESS',
            'Expected a non-zero EVM address.'
        )
    }
    return getAddress(value)
}

export function evmToMirrorSS58(evmAddress: string): string {
    return evmToAddress(normalizeEvmAddress(evmAddress), BITTENSOR_SS58_PREFIX)
}

function decodeBittensorAddress(value: string): Uint8Array {
    try {
        if (!value || isHex(value)) throw new Error('Raw hex is not SS58.')
        const publicKey = decodeAddress(value, false, BITTENSOR_SS58_PREFIX)
        if (publicKey.length !== 32) throw new Error('Invalid key length.')
        return publicKey
    } catch {
        throw new ForeverMoneyError(
            'INVALID_SS58',
            'Expected a Bittensor SS58 address with prefix 42.'
        )
    }
}

export function normalizeSS58(value: string): string {
    return encodeAddress(decodeBittensorAddress(value), BITTENSOR_SS58_PREFIX)
}

export function isBittensorSS58(value: string): boolean {
    try {
        decodeBittensorAddress(value)
        return true
    } catch {
        return false
    }
}

export function ss58ToPublicKey(value: string): string {
    return u8aToHex(decodeBittensorAddress(value))
}
