module sivraj_seal_policy::owner_policy;

use sui::object::{Self, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const VERSION: u64 = 1;

const ENotPolicyOwner: u64 = 1;
const EInvalidSealId: u64 = 2;
const EUnsupportedPolicyVersion: u64 = 3;

public struct OwnerPolicy has key {
    id: UID,
    version: u64,
    owner: address,
}

public fun owner(policy: &OwnerPolicy): address {
    policy.owner
}

public fun namespace(policy: &OwnerPolicy): vector<u8> {
    policy.id.to_bytes()
}

public fun new(owner: address, ctx: &mut TxContext): OwnerPolicy {
    OwnerPolicy {
        id: object::new(ctx),
        version: VERSION,
        owner,
    }
}

entry fun create(owner: address, ctx: &mut TxContext) {
    transfer::share_object(new(owner, ctx));
}

entry fun transfer_owner(
    policy: &mut OwnerPolicy,
    new_owner: address,
    ctx: &TxContext,
) {
    assert_owner(policy, ctx);
    policy.owner = new_owner;
}

public fun seal_approve(id: vector<u8>, policy: &OwnerPolicy, ctx: &TxContext) {
    assert!(policy.version == VERSION, EUnsupportedPolicyVersion);
    assert_owner(policy, ctx);
    assert!(has_prefix(&id, &namespace(policy)), EInvalidSealId);
}

fun assert_owner(policy: &OwnerPolicy, ctx: &TxContext) {
    assert!(tx_context::sender(ctx) == policy.owner, ENotPolicyOwner);
}

fun has_prefix(id: &vector<u8>, prefix: &vector<u8>): bool {
    let prefix_len = prefix.length();

    if (id.length() < prefix_len) {
        return false
    };

    let mut i = 0;
    while (i < prefix_len) {
        if (id[i] != prefix[i]) {
            return false
        };

        i = i + 1;
    };

    true
}
