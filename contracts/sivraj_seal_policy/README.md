# Sivraj Seal Policy

Sivraj-specific Sui Move policy package for Seal decryption approval.

This package does not implement Seal. It gives Seal key servers an on-chain rule to dry-run before releasing decryption key shares.

## Policy

`owner_policy::OwnerPolicy` is a shared object with one owner address.

`seal_approve(id, policy, ctx)` approves only when:

- the policy object version is supported,
- the transaction sender equals `policy.owner`,
- the Seal full ID is namespaced under the policy object ID.

For first testnet smoke testing, create one policy owned by the test wallet you use in Slush. Future production work should mint one policy namespace per Twin and add scoped agent permissions.

## Build

Requires Sui CLI.

```bash
sui move build --path contracts/sivraj_seal_policy
```

## Deploy To Testnet

```bash
sui client switch --env testnet
sui client publish contracts/sivraj_seal_policy --gas-budget 100000000
```

Record the published package ID:

```env
SEAL_PACKAGE_ID=0x...
```

## Create Policy Object

Use the Slush testnet wallet address that should be allowed to decrypt the first smoke-test memory.

```bash
sui client call \
  --package <SEAL_PACKAGE_ID> \
  --module owner_policy \
  --function create \
  --args <OWNER_WALLET_ADDRESS> \
  --gas-budget 10000000
```

Record the new shared `OwnerPolicy` object ID:

```env
SEAL_POLICY_ID=0x...
```

`SEAL_POLICY_ID` is passed to the Seal SDK as the inner identity. Seal derives the full identity from `SEAL_PACKAGE_ID || SEAL_POLICY_ID`; `seal_approve` validates that the full ID belongs to this policy namespace.

## Next Production Work

- add per-Twin policy creation,
- add delegated agent grants,
- add revocation,
- add expiry windows,
- add retrieval/decryption endpoint that builds the `seal_approve` transaction bytes.

## Current Testnet Deployment

- `SEAL_PACKAGE_ID`: `0x8a5490f87e7d8be38af59390beebf50d512b3cb4a509d84dc0e50d99a6465b37`
- `SEAL_POLICY_ID`: `0xe612bfa28620970c89eaadc9c68668784f6c8a5380f8ab98bd94e59e4f7d69df`
- Owner wallet: `0x4de7f2a04ffb363c8a4f4591a77167cc1bf28fba3c8cf81ea333ddce342f6d26`
- Publish transaction: `GPh8PEXarAMoSgNaTzFvP9qodmo3ccyVZUQdqmk5d5wk`
- Policy creation transaction: `CApEs5ivsFbYB3mFc5LkJ4VHJiSRBHKJ2dBoi9Zyx5ea`
