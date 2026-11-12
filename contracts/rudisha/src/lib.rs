//! Rudisha: rent deposit protection on NEAR.
//!
//! The tenant's deposit is held by this contract, never by the landlord.
//! Both sides sign the move-in report; at move-out the landlord has a fixed
//! window to claim deductions, the undisputed part goes back to the tenant at
//! once, and a dispute goes to a private AI assessor and then, on appeal, to a
//! human arbiter. Every deadline is enforced here, on-chain. Every landlord and
//! tenant builds a public record.
//!
//! Lifecycle:
//!   Created -> Funded -> Active -> MoveOut -> (Settled | Claimed)
//!   Claimed -> (Settled | Disputed) -> Assessed -> (Settled | Appealed) -> Settled
//!   Disputed -> Appealed (assessor missed its deadline)
//!   Created | Funded -> Cancelled
//!
//! Payouts are pull-based: settlements credit `claimable`, and each person
//! calls `withdraw`. A failed token transfer restores the balance.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue, PromiseResult,
};

const NS: u64 = 1_000_000_000;
const MIN_WINDOW_SECS: u64 = 30;
const MAX_WINDOW_SECS: u64 = 90 * 24 * 3600;
const MAX_LEASE_SECS: u64 = 10 * 365 * 24 * 3600;
const MAX_LABEL: usize = 80;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Leases,
    ByAccount,
    Records,
    Claimable,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Created,
    Funded,
    Active,
    MoveOut,
    Claimed,
    Disputed,
    Assessed,
    Appealed,
    Settled,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Claim {
    pub amount: U128,
    /// sha256 of the itemised deductions (stored off-chain).
    pub items_hash: String,
    pub filed_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Assessment {
    pub to_landlord: U128,
    pub reason_hash: String,
    /// sha256 of the TEE proof bundle (attestation report + signed chat).
    pub attestation_hash: String,
    pub confidence_bps: u16,
    pub at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Appeal {
    pub by: AccountId,
    pub reason_hash: String,
    pub at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Ruling {
    pub to_landlord: U128,
    pub reason_hash: String,
    pub by: AccountId,
    pub at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Lease {
    pub id: u64,
    pub landlord: AccountId,
    pub tenant: AccountId,
    pub deposit: U128,
    /// Short public label, e.g. "Kilimani 2BR". No addresses or names.
    pub label: String,
    pub lease_end: U64,
    pub claim_window_secs: u64,
    pub response_window_secs: u64,
    pub appeal_window_secs: u64,
    pub state: State,
    pub checkin_hash: Option<String>,
    pub checkin_by_landlord: bool,
    pub checkin_by_tenant: bool,
    pub checkout_hash: Option<String>,
    /// Who recorded the move-out report.
    pub checkout_by: Option<AccountId>,
    /// The other party's own move-out report, if they disagree with the first one.
    pub counter_checkout_hash: Option<String>,
    /// Assessor and arbiter are fixed when the lease is created, so nobody can
    /// swap the judge in the middle of a case.
    pub assessor: AccountId,
    pub arbiter: AccountId,
    pub claim: Option<Claim>,
    pub dispute_reason_hash: Option<String>,
    pub assessment: Option<Assessment>,
    pub appeal: Option<Appeal>,
    pub ruling: Option<Ruling>,
    pub paid_to_tenant: U128,
    pub paid_to_landlord: U128,
    pub created_at: U64,
    pub funded_at: U64,
    pub active_at: U64,
    pub moveout_at: U64,
    pub settled_at: U64,
    /// When `finalize` may act on the current state (0 = no deadline).
    pub deadline: U64,
}

/// Public track record. Landlord and tenant sides are kept separately.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Record {
    pub landlord_leases: u32,
    pub landlord_settled: u32,
    pub full_returns: u32,
    pub claims_filed: u32,
    pub claims_accepted: u32,
    pub disputes_faced: u32,
    pub disputes_lost: u32,
    pub deposits_held: U128,
    pub returned_to_tenants: U128,
    /// Sum over settled leases of (settled_at - moveout_at), in seconds.
    pub return_secs_total: u64,
    pub tenant_leases: u32,
    pub tenant_settled: u32,
    pub disputes_raised: u32,
    pub disputes_won: u32,
    pub deducted_from_me: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub admin: AccountId,
    pub token: AccountId,
    pub assessor: AccountId,
    pub arbiter: AccountId,
    pub lease_count: u64,
}

#[near(serializers = [json])]
pub struct FundMsg {
    pub lease_id: u64,
}

#[ext_contract(ext_ft)]
pub trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
pub trait SelfCb {
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    token: AccountId,
    assessor: AccountId,
    arbiter: AccountId,
    leases: IterableMap<u64, Lease>,
    by_account: LookupMap<AccountId, Vec<u64>>,
    records: LookupMap<AccountId, Record>,
    claimable: LookupMap<AccountId, u128>,
    next_id: u64,
}

fn now() -> u64 {
    env::block_timestamp()
}

fn check_hash(h: &str, what: &str) {
    require!(
        h.len() == 64 && h.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        format!("{what} must be a lowercase 64-char hex sha256")
    );
}

fn check_window(secs: u64, what: &str) {
    require!(
        (MIN_WINDOW_SECS..=MAX_WINDOW_SECS).contains(&secs),
        format!("{what} must be {MIN_WINDOW_SECS}..={MAX_WINDOW_SECS} seconds")
    );
}

fn event(name: &str, lease_id: u64, extra: &str) {
    log!(
        "EVENT_JSON:{{\"standard\":\"rudisha\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{{\"lease_id\":{}{}}}]}}",
        name,
        lease_id,
        extra
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(admin: AccountId, token: AccountId, assessor: AccountId, arbiter: AccountId) -> Self {
        Self {
            admin,
            token,
            assessor,
            arbiter,
            leases: IterableMap::new(Key::Leases),
            by_account: LookupMap::new(Key::ByAccount),
            records: LookupMap::new(Key::Records),
            claimable: LookupMap::new(Key::Claimable),
            next_id: 0,
        }
    }

    /// Changes the assessor and arbiter for leases created from now on.
    /// Existing leases keep the ones they were created with.
    pub fn set_roles(&mut self, assessor: AccountId, arbiter: AccountId) {
        require!(env::predecessor_account_id() == self.admin, "only admin");
        self.assessor = assessor;
        self.arbiter = arbiter;
    }

    // ------------------------------------------------------------ landlord

    /// The landlord opens a lease. Attach NEAR for storage; the excess is refunded.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_lease(
        &mut self,
        tenant: AccountId,
        deposit: U128,
        label: String,
        lease_ends_in_secs: u64,
        claim_window_secs: u64,
        response_window_secs: u64,
        appeal_window_secs: u64,
    ) -> u64 {
        let landlord = env::predecessor_account_id();
        require!(landlord != tenant, "landlord and tenant must differ");
        require!(deposit.0 > 0, "deposit must be > 0");
        require!(!label.is_empty() && label.len() <= MAX_LABEL, "label must be 1..=80 bytes");
        require!(lease_ends_in_secs <= MAX_LEASE_SECS, "lease too long");
        check_window(claim_window_secs, "claim_window_secs");
        check_window(response_window_secs, "response_window_secs");
        check_window(appeal_window_secs, "appeal_window_secs");

        let before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        let t = now();
        self.leases.insert(
            id,
            Lease {
                id,
                landlord: landlord.clone(),
                tenant: tenant.clone(),
                deposit,
                label,
                lease_end: U64(t + lease_ends_in_secs * NS),
                claim_window_secs,
                response_window_secs,
                appeal_window_secs,
                state: State::Created,
                checkin_hash: None,
                checkin_by_landlord: false,
                checkin_by_tenant: false,
                checkout_hash: None,
                checkout_by: None,
                counter_checkout_hash: None,
                assessor: self.assessor.clone(),
                arbiter: self.arbiter.clone(),
                claim: None,
                dispute_reason_hash: None,
                assessment: None,
                appeal: None,
                ruling: None,
                paid_to_tenant: U128(0),
                paid_to_landlord: U128(0),
                created_at: U64(t),
                funded_at: U64(0),
                active_at: U64(0),
                moveout_at: U64(0),
                settled_at: U64(0),
                deadline: U64(0),
            },
        );
        for who in [&landlord, &tenant] {
            let mut ids = self.by_account.get(who).cloned().unwrap_or_default();
            ids.push(id);
            self.by_account.insert(who.clone(), ids);
        }
        self.leases.flush();
        self.by_account.flush();
        let cost = (env::storage_usage().saturating_sub(before) as u128)
            * env::storage_byte_cost().as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= cost,
            format!("attach at least {cost} yoctoNEAR for storage")
        );
        if attached > cost {
            let _ = Promise::new(landlord.clone()).transfer(NearToken::from_yoctonear(attached - cost));
        }
        event("lease_created", id, &format!(",\"landlord\":\"{landlord}\",\"tenant\":\"{tenant}\",\"deposit\":\"{}\"", deposit.0));
        id
    }

    /// Landlord returns the whole deposit at move-out (the fast, good-record path).
    pub fn return_in_full(&mut self, lease_id: u64) {
        let l = self.lease(lease_id);
        require!(env::predecessor_account_id() == l.landlord, "only the landlord");
        require!(l.state == State::MoveOut, "lease is not at move-out");
        self.settle(lease_id, 0);
    }

    /// Landlord claims deductions within the claim window. The undisputed part
    /// of the deposit is credited to the tenant immediately.
    pub fn file_claim(&mut self, lease_id: u64, amount: U128, items_hash: String) {
        check_hash(&items_hash, "items_hash");
        let l = self.lease(lease_id);
        require!(env::predecessor_account_id() == l.landlord, "only the landlord");
        require!(l.state == State::MoveOut, "lease is not at move-out");
        require!(now() <= l.deadline.0, "claim window has closed");
        require!(amount.0 > 0, "use return_in_full for a zero claim");
        require!(amount.0 <= l.deposit.0, "claim exceeds the deposit");

        let undisputed = l.deposit.0 - amount.0;
        let tenant = l.tenant.clone();
        let landlord = l.landlord.clone();
        {
            let lm = self.lease_mut(lease_id);
            lm.claim = Some(Claim { amount, items_hash, filed_at: U64(now()) });
            lm.paid_to_tenant = U128(undisputed);
            lm.state = State::Claimed;
            lm.deadline = U64(now() + lm.response_window_secs * NS);
        }
        self.credit(&tenant, undisputed);
        self.bump(&landlord, |r| r.claims_filed += 1);
        event("claim_filed", lease_id, &format!(",\"amount\":\"{}\",\"released_to_tenant\":\"{undisputed}\"", amount.0));
    }

    // ------------------------------------------------------------ tenant

    /// NEP-141 receiver: the tenant funds a lease with
    /// `ft_transfer_call(rudisha, deposit, msg = {"lease_id": N})`.
    /// Any mismatch panics, which makes the token refund the tenant in full.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "only the configured token");
        let m: FundMsg = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("msg must be {\"lease_id\": N}"));
        let l = self.lease(m.lease_id);
        require!(l.state == State::Created, "lease is not awaiting a deposit");
        require!(sender_id == l.tenant, "only the lease's tenant can fund it");
        require!(amount.0 == l.deposit.0, "amount must equal the deposit exactly");
        let (landlord, tenant) = (l.landlord.clone(), l.tenant.clone());
        {
            let lm = self.lease_mut(m.lease_id);
            lm.state = State::Funded;
            lm.funded_at = U64(now());
        }
        self.bump(&landlord, |r| {
            r.landlord_leases += 1;
            r.deposits_held = U128(r.deposits_held.0 + amount.0);
        });
        self.bump(&tenant, |r| r.tenant_leases += 1);
        event("lease_funded", m.lease_id, &format!(",\"amount\":\"{}\"", amount.0));
        PromiseOrValue::Value(U128(0))
    }

    pub fn accept_claim(&mut self, lease_id: u64) {
        let l = self.lease(lease_id);
        require!(env::predecessor_account_id() == l.tenant, "only the tenant");
        require!(l.state == State::Claimed, "no open claim");
        let amount = l.claim.as_ref().unwrap().amount.0;
        let landlord = l.landlord.clone();
        self.bump(&landlord, |r| r.claims_accepted += 1);
        self.settle(lease_id, amount);
    }

    pub fn dispute(&mut self, lease_id: u64, reason_hash: String) {
        check_hash(&reason_hash, "reason_hash");
        let l = self.lease(lease_id);
        require!(env::predecessor_account_id() == l.tenant, "only the tenant");
        require!(l.state == State::Claimed, "no open claim");
        require!(now() <= l.deadline.0, "response window has closed");
        let (landlord, tenant) = (l.landlord.clone(), l.tenant.clone());
        {
            let lm = self.lease_mut(lease_id);
            lm.state = State::Disputed;
            lm.dispute_reason_hash = Some(reason_hash);
            // The assessor gets one response window to rule.
            lm.deadline = U64(now() + lm.response_window_secs * NS);
        }
        self.bump(&landlord, |r| r.disputes_faced += 1);
        self.bump(&tenant, |r| r.disputes_raised += 1);
        event("disputed", lease_id, "");
    }

    // ------------------------------------------------------------ both parties

    /// Both parties sign the same move-in report hash. Signing a different
    /// hash replaces the report and resets the other party's signature.
    pub fn sign_checkin(&mut self, lease_id: u64, checkin_hash: String) {
        check_hash(&checkin_hash, "checkin_hash");
        let caller = env::predecessor_account_id();
        let l = self.lease(lease_id);
        require!(l.state == State::Funded, "lease is not funded");
        let is_landlord = caller == l.landlord;
        require!(is_landlord || caller == l.tenant, "only the landlord or tenant");
        let active = {
            let lm = self.lease_mut(lease_id);
            if lm.checkin_hash.as_deref() != Some(checkin_hash.as_str()) {
                lm.checkin_hash = Some(checkin_hash);
                lm.checkin_by_landlord = false;
                lm.checkin_by_tenant = false;
            }
            if is_landlord {
                lm.checkin_by_landlord = true;
            } else {
                lm.checkin_by_tenant = true;
            }
            if lm.checkin_by_landlord && lm.checkin_by_tenant {
                lm.state = State::Active;
                lm.active_at = U64(now());
                true
            } else {
                false
            }
        };
        event(if active { "checkin_complete" } else { "checkin_signed" }, lease_id, &format!(",\"by\":\"{caller}\""));
    }

    /// Either party records the move-out report once the lease has ended.
    /// This opens the landlord's claim window.
    pub fn submit_checkout(&mut self, lease_id: u64, checkout_hash: String) {
        check_hash(&checkout_hash, "checkout_hash");
        let caller = env::predecessor_account_id();
        let l = self.lease(lease_id);
        require!(l.state == State::Active, "lease is not active");
        require!(caller == l.landlord || caller == l.tenant, "only the landlord or tenant");
        require!(now() >= l.lease_end.0, "lease has not ended yet");
        {
            let lm = self.lease_mut(lease_id);
            lm.checkout_hash = Some(checkout_hash);
            lm.checkout_by = Some(caller.clone());
            lm.state = State::MoveOut;
            lm.moveout_at = U64(now());
            lm.deadline = U64(now() + lm.claim_window_secs * NS);
        }
        event("moved_out", lease_id, &format!(",\"by\":\"{caller}\""));
    }

    /// The party who did NOT record the move-out report can add their own,
    /// once, any time before the case is assessed. The assessor sees both.
    pub fn counter_checkout(&mut self, lease_id: u64, checkout_hash: String) {
        check_hash(&checkout_hash, "checkout_hash");
        let caller = env::predecessor_account_id();
        let l = self.lease(lease_id);
        require!(caller == l.landlord || caller == l.tenant, "only the landlord or tenant");
        require!(
            matches!(l.state, State::MoveOut | State::Claimed | State::Disputed),
            "move-out reports can only be added before the assessment"
        );
        require!(l.checkout_by.as_ref() != Some(&caller), "you already recorded the move-out report");
        require!(l.counter_checkout_hash.is_none(), "a second move-out report was already added");
        self.lease_mut(lease_id).counter_checkout_hash = Some(checkout_hash);
        event("counter_checkout", lease_id, &format!(",\"by\":\"{caller}\""));
    }

    /// Before move-in only. A funded deposit goes straight back to the tenant.
    pub fn cancel(&mut self, lease_id: u64) {
        let caller = env::predecessor_account_id();
        let l = self.lease(lease_id);
        match l.state {
            State::Created => require!(caller == l.landlord || caller == l.tenant, "only the landlord or tenant"),
            State::Funded => require!(caller == l.landlord || caller == l.tenant, "only the landlord or tenant"),
            _ => env::panic_str("only a lease that is not yet active can be cancelled"),
        }
        let refund = if l.state == State::Funded { l.deposit.0 } else { 0 };
        let tenant = l.tenant.clone();
        {
            let lm = self.lease_mut(lease_id);
            lm.state = State::Cancelled;
            lm.paid_to_tenant = U128(refund);
            lm.settled_at = U64(now());
        }
        self.credit(&tenant, refund);
        event("cancelled", lease_id, &format!(",\"by\":\"{caller}\""));
    }

    /// Ask a human arbiter: after an assessment, or if the assessor missed its deadline.
    pub fn appeal(&mut self, lease_id: u64, reason_hash: String) {
        check_hash(&reason_hash, "reason_hash");
        let caller = env::predecessor_account_id();
        let l = self.lease(lease_id);
        require!(caller == l.landlord || caller == l.tenant, "only the landlord or tenant");
        match l.state {
            State::Assessed => require!(now() <= l.deadline.0, "appeal window has closed"),
            State::Disputed => require!(now() > l.deadline.0, "the assessor still has time"),
            _ => env::panic_str("nothing to appeal"),
        }
        {
            let lm = self.lease_mut(lease_id);
            lm.appeal = Some(Appeal { by: caller.clone(), reason_hash, at: U64(now()) });
            lm.state = State::Appealed;
            lm.deadline = U64(0);
        }
        event("appealed", lease_id, &format!(",\"by\":\"{caller}\""));
    }

    // ------------------------------------------------------------ assessor + arbiter

    pub fn submit_assessment(
        &mut self,
        lease_id: u64,
        to_landlord: U128,
        reason_hash: String,
        attestation_hash: String,
        confidence_bps: u16,
    ) {
        check_hash(&reason_hash, "reason_hash");
        check_hash(&attestation_hash, "attestation_hash");
        require!(confidence_bps <= 10_000, "confidence_bps must be <= 10000");
        let l = self.lease(lease_id);
        require!(env::predecessor_account_id() == l.assessor, "only the assessor");
        require!(l.state == State::Disputed, "lease is not in dispute");
        require!(now() <= l.deadline.0, "assessment deadline has passed");
        require!(to_landlord.0 <= l.claim.as_ref().unwrap().amount.0, "cannot award more than claimed");
        {
            let lm = self.lease_mut(lease_id);
            lm.assessment = Some(Assessment {
                to_landlord,
                reason_hash,
                attestation_hash,
                confidence_bps,
                at: U64(now()),
            });
            lm.state = State::Assessed;
            lm.deadline = U64(now() + lm.appeal_window_secs * NS);
        }
        event("assessed", lease_id, &format!(",\"to_landlord\":\"{}\",\"confidence_bps\":{confidence_bps}", to_landlord.0));
    }

    pub fn rule(&mut self, lease_id: u64, to_landlord: U128, reason_hash: String) {
        let arbiter = env::predecessor_account_id();
        check_hash(&reason_hash, "reason_hash");
        let l = self.lease(lease_id);
        require!(arbiter == l.arbiter, "only the arbiter");
        require!(l.state == State::Appealed, "lease is not under appeal");
        require!(to_landlord.0 <= l.claim.as_ref().unwrap().amount.0, "cannot award more than claimed");
        self.lease_mut(lease_id).ruling = Some(Ruling {
            to_landlord,
            reason_hash,
            by: arbiter,
            at: U64(now()),
        });
        self.settle(lease_id, to_landlord.0);
    }

    // ------------------------------------------------------------ anyone

    /// Applies the default outcome once a deadline has passed:
    /// no claim -> tenant gets everything; no response -> claim stands;
    /// no appeal -> assessment stands.
    pub fn finalize(&mut self, lease_id: u64) {
        let l = self.lease(lease_id);
        require!(l.deadline.0 > 0 && now() > l.deadline.0, "no deadline has passed");
        let to_landlord = match l.state {
            State::MoveOut => 0,
            State::Claimed => {
                let landlord = l.landlord.clone();
                self.bump(&landlord, |r| r.claims_accepted += 1);
                l.claim.as_ref().unwrap().amount.0
            }
            State::Assessed => l.assessment.as_ref().unwrap().to_landlord.0,
            _ => env::panic_str("nothing to finalize in this state"),
        };
        self.settle(lease_id, to_landlord);
    }

    /// Pull your credited balance. On a failed transfer the balance is restored.
    pub fn withdraw(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.claimable.get(&who).copied().unwrap_or(0);
        require!(amount > 0, "nothing to withdraw");
        self.claimable.insert(who.clone(), 0);
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("rudisha withdrawal".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_WITHDRAW)
                    .on_withdraw(who, U128(amount)),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        match env::promise_result(0) {
            PromiseResult::Successful(_) => {
                log!("withdrew {} to {}", amount.0, account_id);
                true
            }
            PromiseResult::Failed => {
                self.credit(&account_id, amount.0);
                log!("withdrawal to {} failed; balance restored", account_id);
                false
            }
        }
    }

    // ------------------------------------------------------------ views

    pub fn get_config(&self) -> Config {
        Config {
            admin: self.admin.clone(),
            token: self.token.clone(),
            assessor: self.assessor.clone(),
            arbiter: self.arbiter.clone(),
            lease_count: self.next_id,
        }
    }

    pub fn get_lease(&self, lease_id: u64) -> Option<Lease> {
        self.leases.get(&lease_id).cloned()
    }

    pub fn list_leases(&self, from_id: Option<u64>, limit: Option<u64>) -> Vec<Lease> {
        let from = from_id.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.next_id)
            .filter_map(|i| self.leases.get(&i).cloned())
            .take(limit as usize)
            .collect()
    }

    pub fn leases_of(&self, account_id: AccountId) -> Vec<Lease> {
        self.by_account
            .get(&account_id)
            .map(|ids| ids.iter().filter_map(|i| self.leases.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_record(&self, account_id: AccountId) -> Record {
        self.records.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_claimable(&self, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&account_id).copied().unwrap_or(0))
    }

    // ------------------------------------------------------------ internal

    fn lease(&self, id: u64) -> Lease {
        self.leases
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such lease"))
    }

    fn lease_mut(&mut self, id: u64) -> &mut Lease {
        self.leases
            .get_mut(&id)
            .unwrap_or_else(|| env::panic_str("no such lease"))
    }

    fn credit(&mut self, who: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let b = self.claimable.get(who).copied().unwrap_or(0);
        self.claimable.insert(who.clone(), b.checked_add(amount).expect("overflow"));
    }

    fn bump(&mut self, who: &AccountId, f: impl FnOnce(&mut Record)) {
        let mut r = self.records.get(who).cloned().unwrap_or_default();
        f(&mut r);
        self.records.insert(who.clone(), r);
    }

    /// Pays out what is still held: `to_landlord` to the landlord, the rest to the tenant.
    fn settle(&mut self, lease_id: u64, to_landlord: u128) {
        let l = self.lease(lease_id);
        let held = l.deposit.0 - l.paid_to_tenant.0;
        require!(to_landlord <= held, "award exceeds the held amount");
        let to_tenant = held - to_landlord;
        let t = now();
        let claimed = l.claim.as_ref().map(|c| c.amount.0).unwrap_or(0);
        let was_disputed = l.dispute_reason_hash.is_some();
        let return_secs = t.saturating_sub(l.moveout_at.0) / NS;
        {
            let lm = self.lease_mut(lease_id);
            lm.paid_to_tenant = U128(lm.paid_to_tenant.0 + to_tenant);
            lm.paid_to_landlord = U128(to_landlord);
            lm.state = State::Settled;
            lm.settled_at = U64(t);
            lm.deadline = U64(0);
        }
        self.credit(&l.tenant, to_tenant);
        self.credit(&l.landlord, to_landlord);
        let returned = l.deposit.0 - to_landlord;
        // A dispute is "lost" by the landlord when they end up with less than half their claim.
        let landlord_lost = was_disputed && to_landlord * 2 < claimed;
        self.bump(&l.landlord, |r| {
            r.landlord_settled += 1;
            r.returned_to_tenants = U128(r.returned_to_tenants.0 + returned);
            r.return_secs_total += return_secs;
            if to_landlord == 0 {
                r.full_returns += 1;
            }
            if landlord_lost {
                r.disputes_lost += 1;
            }
        });
        self.bump(&l.tenant, |r| {
            r.tenant_settled += 1;
            r.deducted_from_me = U128(r.deducted_from_me.0 + to_landlord);
            if landlord_lost {
                r.disputes_won += 1;
            }
        });
        event(
            "settled",
            lease_id,
            &format!(",\"to_landlord\":\"{to_landlord}\",\"to_tenant_total\":\"{returned}\""),
        );
    }
}

#[cfg(test)]
mod tests;
