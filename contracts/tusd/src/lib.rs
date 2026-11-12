//! tUSD: a testnet-only stablecoin stand-in (NEP-141 + NEP-148) with an open faucet.
//! Accounts are registered automatically, so nobody needs a storage deposit.
//! Never deploy this to mainnet: anyone can mint.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, PromiseOrValue, PromiseResult,
};

const FAUCET_MAX: u128 = 10_000_000_000; // 10,000 tUSD (6 decimals) per call
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(5);
const GAS_FOR_CALL: Gas = Gas::from_tgas(25);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Balances,
}

#[near(serializers = [json])]
pub struct Metadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[ext_contract(ext_receiver)]
pub trait Receiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}

#[ext_contract(ext_self)]
pub trait SelfCb {
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    balances: LookupMap<AccountId, u128>,
    supply: u128,
}

#[near]
impl Token {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(Key::Balances), supply: 0 }
    }

    /// Open testnet faucet: mints up to 10,000 tUSD to the caller.
    pub fn mint(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= FAUCET_MAX, "mint 1..=10000 tUSD per call");
        let who = env::predecessor_account_id();
        self.credit(&who, amount.0);
        self.supply += amount.0;
        log!("EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_mint\",\"data\":[{{\"owner_id\":\"{}\",\"amount\":\"{}\"}}]}}", who, amount.0);
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.move_funds(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_one_yocto();
        require!(env::prepaid_gas() > GAS_FOR_CALL.saturating_add(GAS_FOR_RESOLVE), "more gas needed");
        let sender = env::predecessor_account_id();
        self.move_funds(&sender, &receiver_id, amount.0, memo);
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_CALL)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .ft_resolve_transfer(sender, receiver_id, amount),
            )
            .into()
    }

    /// Refunds whatever the receiver did not use. Returns the amount used.
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result(0) {
            PromiseResult::Successful(v) => near_sdk::serde_json::from_slice::<U128>(&v)
                .map(|u| u.0.min(amount.0))
                .unwrap_or(amount.0),
            PromiseResult::Failed => amount.0,
        };
        if unused > 0 {
            let available = self.ft_balance_of(receiver_id.clone()).0;
            let refund = unused.min(available);
            if refund > 0 {
                self.move_funds(&receiver_id, &sender_id, refund, Some("refund".into()));
            }
            return U128(amount.0 - refund);
        }
        amount
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.supply)
    }

    pub fn ft_metadata(&self) -> Metadata {
        Metadata {
            spec: "ft-1.0.0".into(),
            name: "Test USD (testnet only)".into(),
            symbol: "tUSD".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }

    /// Wallet compatibility: everyone is registered; any deposit is returned.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let d = env::attached_deposit();
        if !d.is_zero() {
            let _ = near_sdk::Promise::new(env::predecessor_account_id()).transfer(d);
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    fn credit(&mut self, who: &AccountId, amount: u128) {
        let b = self.balances.get(who).copied().unwrap_or(0);
        self.balances.insert(who.clone(), b.checked_add(amount).expect("overflow"));
    }

    fn move_funds(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<String>) {
        require!(amount > 0, "amount must be > 0");
        require!(from != to, "sender and receiver must differ");
        let b = self.balances.get(from).copied().unwrap_or(0);
        require!(b >= amount, "not enough tUSD");
        self.balances.insert(from.clone(), b - amount);
        self.credit(to, amount);
        let memo = memo.map(|m| format!(",\"memo\":{}", near_sdk::serde_json::to_string(&m).unwrap())).unwrap_or_default();
        log!("EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\"{}}}]}}", from, to, amount, memo);
    }
}

#[allow(dead_code)]
fn _unused(_: NearToken) {}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: usize, yocto: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(yocto));
        testing_env!(b.build());
    }

    #[test]
    fn mint_and_transfer() {
        ctx(0, 0);
        let mut t = Token::new();
        t.mint(U128(5_000_000));
        ctx(0, 1);
        t.ft_transfer(accounts(1), U128(2_000_000), None);
        assert_eq!(t.ft_balance_of(accounts(0)).0, 3_000_000);
        assert_eq!(t.ft_balance_of(accounts(1)).0, 2_000_000);
        assert_eq!(t.ft_total_supply().0, 5_000_000);
    }

    #[test]
    #[should_panic(expected = "mint 1..=10000 tUSD per call")]
    fn faucet_is_capped() {
        ctx(0, 0);
        let mut t = Token::new();
        t.mint(U128(FAUCET_MAX + 1));
    }

    #[test]
    #[should_panic(expected = "not enough tUSD")]
    fn cannot_overspend() {
        ctx(0, 0);
        let mut t = Token::new();
        t.mint(U128(1));
        ctx(0, 1);
        t.ft_transfer(accounts(1), U128(2), None);
    }
}
