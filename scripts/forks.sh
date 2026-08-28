#!/usr/bin/env bash
set -euo pipefail

: "${BASE_RPC_URL:?BASE_RPC_URL is required}"
: "${SUBTENSOR_RPC_URL:?SUBTENSOR_RPC_URL is required}"

base_port=18545
subtensor_port=19545
base_log="$(mktemp -t forevermoney-base-fork.XXXXXX)"
subtensor_log="$(mktemp -t forevermoney-subtensor-fork.XXXXXX)"

anvil --silent --fork-url "$BASE_RPC_URL" --chain-id 8453 --port "$base_port" >"$base_log" 2>&1 &
base_pid=$!
anvil --silent --fork-url "$SUBTENSOR_RPC_URL" --chain-id 964 --port "$subtensor_port" >"$subtensor_log" 2>&1 &
subtensor_pid=$!

cleanup() {
    kill "$base_pid" "$subtensor_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for_rpc() {
    local port="$1"
    local log_file="$2"
    for _attempt in $(seq 1 60); do
        if curl --silent --fail \
            --header 'content-type: application/json' \
            --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
            "http://127.0.0.1:${port}" >/dev/null; then
            return 0
        fi
        sleep 0.25
    done
    sed -n '1,120p' "$log_file" >&2
    return 1
}

wait_for_rpc "$base_port" "$base_log"
wait_for_rpc "$subtensor_port" "$subtensor_log"

FOREVERMONEY_BASE_FORK_RPC_URL="http://127.0.0.1:${base_port}" \
FOREVERMONEY_SUBTENSOR_FORK_RPC_URL="http://127.0.0.1:${subtensor_port}" \
npm test -- --run src/integration/fork.test.ts
