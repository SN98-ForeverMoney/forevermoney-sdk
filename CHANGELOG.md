# Changelog

## 0.1.0

- Added canonical Base and Subtensor production deployment metadata.
- Added the canonical Robinhood deployment, bridge plans, receipt parsing, and
  CCIP delivery tracking.
- Added unsigned, approval-aware bridge plans in both directions.
- Enforced the 1:1 bridge invariant by encoding the bridged principal as the
  minimum destination output while charging network fees separately.
- Rejected liquid Base-to-Subtensor deliveries below the `0.01 TAO` Subtensor
  unstaking minimum.
- Added vault create, deposit, withdrawal, fee-claim, stake, and unstake plans.
- Added EIP-1193 and ethers transaction adapters plus canonical receipt parsers.
- Added destination-chain checkpoints and CCIP delivery status tracking with
  Base-to-Subtensor recovery detection.
- Restricted delivery events to the current lane's authorized CCIP off-ramps.
- Added source transaction confirmation and canonical message-ID lookup.
- Added strict bigint, uint256, EVM address, Bittensor SS58, bytes32, whole-RAO,
  source/delivery, and boolean validation.
- Added offline unit/property/protocol tests, production-fork checks, package
  verification, and a guarded real-key canary workflow.
- Added pinned CI, production-fork, and npm trusted-publishing workflows.
- Rejected plaintext remote RPC endpoints and malformed transport requests.
- Raised the supported Node.js baseline to the maintained Node.js 22 line.
