import { describe, expect, it, vi } from 'vitest'
import { createForeverMoneyClient, http, type RpcTransport } from '../index.js'

describe('RPC transports', () => {
    it('sends a valid JSON-RPC request and returns its exact result', async () => {
        const fetch = vi.fn(
            async (_url: string | URL | Request, init?: RequestInit) => {
                const request = JSON.parse(String(init?.body)) as {
                    id: number
                    method: string
                    params: unknown[]
                }
                expect(request.method).toBe('eth_blockNumber')
                expect(request.params).toEqual([])
                return new Response(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: request.id,
                        result: '0x2a',
                    }),
                    { status: 200 }
                )
            }
        )
        const transport = http('https://rpc.example', { fetch })
        await expect(
            transport.request({ method: 'eth_blockNumber' })
        ).resolves.toBe('0x2a')
        expect(fetch).toHaveBeenCalledOnce()
    })

    it('does not hide HTTP or JSON-RPC failures', async () => {
        const httpFailure = http('https://rpc.example', {
            fetch: vi.fn(async () => new Response('', { status: 503 })),
        })
        await expect(
            httpFailure.request({ method: 'eth_chainId' })
        ).rejects.toMatchObject({ code: 'RPC_ERROR' })

        const rpcFailure = http('https://rpc.example', {
            fetch: vi.fn(async (_url, init) => {
                const { id } = JSON.parse(String(init?.body)) as { id: number }
                return new Response(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32_000, message: 'execution reverted' },
                    })
                )
            }),
        })
        await expect(
            rpcFailure.request({ method: 'eth_call' })
        ).rejects.toMatchObject({
            code: 'RPC_ERROR',
            message: 'execution reverted',
        })
    })

    it.each([
        ['a null body', null],
        [
            'the wrong protocol version',
            { jsonrpc: '1.0', id: 1, result: '0x1' },
        ],
        ['the wrong request ID', { jsonrpc: '2.0', id: 2, result: '0x1' }],
        ['no result or error', { jsonrpc: '2.0', id: 1 }],
        [
            'a malformed error',
            {
                jsonrpc: '2.0',
                id: 1,
                error: { code: 'SERVER_ERROR', message: 12 },
            },
        ],
    ])('rejects malformed JSON-RPC responses: %s', async (_label, body) => {
        const transport = http('https://rpc.example', {
            fetch: vi.fn(async () => new Response(JSON.stringify(body))),
        })
        await expect(
            transport.request({ method: 'eth_chainId' })
        ).rejects.toMatchObject({
            code: 'RPC_ERROR',
            message: 'RPC returned an invalid JSON-RPC response.',
        })
    })

    it('rejects insecure remote URLs, unsupported schemes, and invalid timeouts', () => {
        expect(() => http('file:///tmp/socket')).toThrow('HTTP or HTTPS')
        expect(() => http('http://rpc.example')).toThrow(
            'Non-local RPC URLs must use HTTPS'
        )
        expect(() => http('http://127.0.0.1:8545')).not.toThrow()
        expect(() => http('http://[::1]:8545')).not.toThrow()
        expect(() => http('https://rpc.example', { timeoutMs: 0 })).toThrow(
            'positive integer'
        )
    })

    it('rejects malformed requests before calling fetch', async () => {
        const fetch = vi.fn()
        const transport = http('https://rpc.example', { fetch })

        await expect(transport.request({ method: '' })).rejects.toMatchObject({
            code: 'RPC_ERROR',
        })
        await expect(
            transport.request({
                method: 'eth_call',
                params: 1 as unknown as readonly unknown[],
            })
        ).rejects.toMatchObject({ code: 'RPC_ERROR' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('verifies both chain IDs and fails closed on mismatches', async () => {
        const chainTransport = (chainId: number): RpcTransport => ({
            async request({ method }) {
                if (method === 'eth_chainId') return `0x${chainId.toString(16)}`
                throw new Error(`Unexpected RPC method: ${method}`)
            },
        })
        const client = createForeverMoneyClient({
            transports: {
                base: chainTransport(8453),
                subtensor: chainTransport(964),
            },
        })
        await expect(client.verifyConnections()).resolves.toBeUndefined()

        const wrong = createForeverMoneyClient({
            transports: {
                base: chainTransport(1),
                subtensor: chainTransport(964),
            },
        })
        await expect(wrong.verifyConnections()).rejects.toMatchObject({
            code: 'CHAIN_MISMATCH',
        })
    })
})
