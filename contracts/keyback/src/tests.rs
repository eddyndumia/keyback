use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const DEP: u128 = 500_000_000; // 500 tUSD
const W: u64 = 60; // every window: 60 s
const START: u64 = 1_000;
const END: u64 = START + 100;
const H1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
const ADMIN: &str = "admin.testnet";
const LANDLORD: &str = "landlord.testnet";
const TENANT: &str = "tenant.testnet";
const ASSESSOR: &str = "assessor.testnet";
const ARBITER: &str = "arbiter.testnet";
const TOKEN: &str = "tusd.testnet";
const STRANGER: &str = "stranger.testnet";

fn ctx(caller: &str, near_yocto: u128, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("keyback.testnet"))
        .predecessor_account_id(id(caller))
        .signer_account_id(id(caller))
        .attached_deposit(NearToken::from_yoctonear(near_yocto))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(ts * NS);
    testing_env!(b.build());
}

fn new_contract() -> Contract {
    ctx(ADMIN, 0, START);
    Contract::new(id(ADMIN), id(TOKEN), id(ASSESSOR), id(ARBITER))
}

fn create(c: &mut Contract) -> u64 {
    ctx(LANDLORD, NearToken::from_near(1).as_yoctonear(), START);
    c.create_lease(id(TENANT), U128(DEP), "Kilimani 2BR".into(), END - START, W, W, W)
}

fn fund(c: &mut Contract, lease: u64) {
    ctx(TOKEN, 0, START + 1);
    let _ = c.ft_on_transfer(id(TENANT), U128(DEP), format!("{{\"lease_id\":{lease}}}"));
}

fn activate(c: &mut Contract, lease: u64) {
    ctx(LANDLORD, 0, START + 2);
    c.sign_checkin(lease, H1.into());
    ctx(TENANT, 0, START + 3);
    c.sign_checkin(lease, H1.into());
}

/// A lease at move-out (claim window open until END + W).
fn at_moveout() -> (Contract, u64) {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    activate(&mut c, l);
    ctx(TENANT, 0, END);
    c.submit_checkout(l, H2.into());
    (c, l)
}

fn claimed(amount: u128) -> (Contract, u64) {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 10);
    c.file_claim(l, U128(amount), H1.into());
    (c, l)
}

fn disputed(amount: u128) -> (Contract, u64) {
    let (mut c, l) = claimed(amount);
    ctx(TENANT, 0, END + 20);
    c.dispute(l, H2.into());
    (c, l)
}

fn assessed(claim: u128, award: u128) -> (Contract, u64) {
    let (mut c, l) = disputed(claim);
    ctx(ASSESSOR, 0, END + 30);
    c.submit_assessment(l, U128(award), H1.into(), H2.into(), 8_000);
    (c, l)
}

fn claimable(c: &Contract, who: &str) -> u128 {
    c.get_claimable(id(who)).0
}

// ------------------------------------------------------------ creation + funding

#[test]
fn create_lease_records_parties() {
    let mut c = new_contract();
    let l = create(&mut c);
    let lease = c.get_lease(l).unwrap();
    assert_eq!(lease.state, State::Created);
    assert_eq!(lease.landlord, id(LANDLORD));
    assert_eq!(c.leases_of(id(TENANT)).len(), 1);
    assert_eq!(c.leases_of(id(LANDLORD)).len(), 1);
    assert_eq!(c.get_config().lease_count, 1);
}

#[test]
#[should_panic(expected = "attach at least")]
fn create_requires_storage_payment() {
    let mut c = new_contract();
    ctx(LANDLORD, 0, START);
    c.create_lease(id(TENANT), U128(DEP), "x".into(), 100, W, W, W);
}

#[test]
#[should_panic(expected = "landlord and tenant must differ")]
fn landlord_cannot_be_tenant() {
    let mut c = new_contract();
    ctx(LANDLORD, NearToken::from_near(1).as_yoctonear(), START);
    c.create_lease(id(LANDLORD), U128(DEP), "x".into(), 100, W, W, W);
}

#[test]
#[should_panic(expected = "claim_window_secs must be")]
fn windows_are_bounded() {
    let mut c = new_contract();
    ctx(LANDLORD, NearToken::from_near(1).as_yoctonear(), START);
    c.create_lease(id(TENANT), U128(DEP), "x".into(), 100, 5, W, W);
}

#[test]
fn funding_moves_lease_to_funded() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    assert_eq!(c.get_lease(l).unwrap().state, State::Funded);
    assert_eq!(c.get_record(id(LANDLORD)).deposits_held.0, DEP);
    assert_eq!(c.get_record(id(TENANT)).tenant_leases, 1);
}

#[test]
#[should_panic(expected = "only the configured token")]
fn funding_from_other_token_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    ctx(STRANGER, 0, START + 1);
    let _ = c.ft_on_transfer(id(TENANT), U128(DEP), format!("{{\"lease_id\":{l}}}"));
}

#[test]
#[should_panic(expected = "only the lease's tenant can fund it")]
fn funding_by_non_tenant_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    ctx(TOKEN, 0, START + 1);
    let _ = c.ft_on_transfer(id(STRANGER), U128(DEP), format!("{{\"lease_id\":{l}}}"));
}

#[test]
#[should_panic(expected = "amount must equal the deposit exactly")]
fn funding_wrong_amount_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    ctx(TOKEN, 0, START + 1);
    let _ = c.ft_on_transfer(id(TENANT), U128(DEP - 1), format!("{{\"lease_id\":{l}}}"));
}

#[test]
#[should_panic(expected = "lease is not awaiting a deposit")]
fn double_funding_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    fund(&mut c, l);
}

#[test]
#[should_panic(expected = "msg must be")]
fn funding_bad_msg_rejected() {
    let mut c = new_contract();
    create(&mut c);
    ctx(TOKEN, 0, START + 1);
    let _ = c.ft_on_transfer(id(TENANT), U128(DEP), "hello".into());
}

// ------------------------------------------------------------ check-in

#[test]
fn checkin_needs_both_signatures() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    ctx(LANDLORD, 0, START + 2);
    c.sign_checkin(l, H1.into());
    assert_eq!(c.get_lease(l).unwrap().state, State::Funded);
    ctx(TENANT, 0, START + 3);
    c.sign_checkin(l, H1.into());
    assert_eq!(c.get_lease(l).unwrap().state, State::Active);
}

#[test]
fn different_checkin_hash_resets_other_signature() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    ctx(LANDLORD, 0, START + 2);
    c.sign_checkin(l, H1.into());
    ctx(TENANT, 0, START + 3);
    c.sign_checkin(l, H2.into());
    let lease = c.get_lease(l).unwrap();
    assert_eq!(lease.state, State::Funded);
    assert!(!lease.checkin_by_landlord && lease.checkin_by_tenant);
    assert_eq!(lease.checkin_hash.unwrap(), H2);
}

#[test]
#[should_panic(expected = "only the landlord or tenant")]
fn stranger_cannot_sign_checkin() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    ctx(STRANGER, 0, START + 2);
    c.sign_checkin(l, H1.into());
}

#[test]
#[should_panic(expected = "lowercase 64-char hex sha256")]
fn bad_hash_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    ctx(LANDLORD, 0, START + 2);
    c.sign_checkin(l, "ABC".into());
}

// ------------------------------------------------------------ move-out + claims

#[test]
#[should_panic(expected = "lease has not ended yet")]
fn checkout_before_end_rejected() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    activate(&mut c, l);
    ctx(TENANT, 0, END - 1);
    c.submit_checkout(l, H2.into());
}

#[test]
fn return_in_full_credits_tenant_and_record() {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 5);
    c.return_in_full(l);
    assert_eq!(claimable(&c, TENANT), DEP);
    assert_eq!(claimable(&c, LANDLORD), 0);
    let r = c.get_record(id(LANDLORD));
    assert_eq!((r.full_returns, r.landlord_settled, r.return_secs_total), (1, 1, 5));
    assert_eq!(r.returned_to_tenants.0, DEP);
}

#[test]
fn no_claim_in_window_means_full_refund() {
    let (mut c, l) = at_moveout();
    ctx(STRANGER, 0, END + W + 1);
    c.finalize(l);
    assert_eq!(c.get_lease(l).unwrap().state, State::Settled);
    assert_eq!(claimable(&c, TENANT), DEP);
}

#[test]
#[should_panic(expected = "no deadline has passed")]
fn finalize_before_deadline_rejected() {
    let (mut c, l) = at_moveout();
    ctx(STRANGER, 0, END + 5);
    c.finalize(l);
}

#[test]
fn claim_releases_undisputed_part_immediately() {
    let (c, l) = claimed(100_000_000);
    assert_eq!(claimable(&c, TENANT), DEP - 100_000_000);
    let lease = c.get_lease(l).unwrap();
    assert_eq!(lease.state, State::Claimed);
    assert_eq!(c.get_record(id(LANDLORD)).claims_filed, 1);
}

#[test]
#[should_panic(expected = "claim window has closed")]
fn late_claim_rejected() {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + W + 1);
    c.file_claim(l, U128(1), H1.into());
}

#[test]
#[should_panic(expected = "claim exceeds the deposit")]
fn claim_above_deposit_rejected() {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 1);
    c.file_claim(l, U128(DEP + 1), H1.into());
}

#[test]
#[should_panic(expected = "only the landlord")]
fn tenant_cannot_file_claim() {
    let (mut c, l) = at_moveout();
    ctx(TENANT, 0, END + 1);
    c.file_claim(l, U128(1), H1.into());
}

#[test]
fn tenant_accepts_claim() {
    let (mut c, l) = claimed(100_000_000);
    ctx(TENANT, 0, END + 20);
    c.accept_claim(l);
    assert_eq!(claimable(&c, LANDLORD), 100_000_000);
    assert_eq!(claimable(&c, TENANT), DEP - 100_000_000);
    assert_eq!(c.get_record(id(LANDLORD)).claims_accepted, 1);
    assert_eq!(c.get_record(id(TENANT)).deducted_from_me.0, 100_000_000);
}

#[test]
fn silence_means_claim_stands() {
    let (mut c, l) = claimed(100_000_000);
    ctx(STRANGER, 0, END + 10 + W + 1);
    c.finalize(l);
    assert_eq!(claimable(&c, LANDLORD), 100_000_000);
    assert_eq!(c.get_lease(l).unwrap().state, State::Settled);
}

#[test]
#[should_panic(expected = "response window has closed")]
fn late_dispute_rejected() {
    let (mut c, l) = claimed(100_000_000);
    ctx(TENANT, 0, END + 10 + W + 1);
    c.dispute(l, H2.into());
}

// ------------------------------------------------------------ disputes

#[test]
fn assessment_stands_if_nobody_appeals() {
    let claim = 300_000_000;
    let (mut c, l) = assessed(claim, 60_000_000);
    ctx(STRANGER, 0, END + 30 + W + 1);
    c.finalize(l);
    assert_eq!(claimable(&c, LANDLORD), 60_000_000);
    assert_eq!(claimable(&c, TENANT), DEP - 60_000_000);
    let lr = c.get_record(id(LANDLORD));
    assert_eq!((lr.disputes_faced, lr.disputes_lost), (1, 1));
    let tr = c.get_record(id(TENANT));
    assert_eq!((tr.disputes_raised, tr.disputes_won), (1, 1));
}

#[test]
#[should_panic(expected = "cannot award more than claimed")]
fn assessor_cannot_award_above_claim() {
    let (mut c, l) = disputed(100_000_000);
    ctx(ASSESSOR, 0, END + 30);
    c.submit_assessment(l, U128(100_000_001), H1.into(), H2.into(), 8_000);
}

#[test]
#[should_panic(expected = "only the assessor")]
fn landlord_cannot_assess() {
    let (mut c, l) = disputed(100_000_000);
    ctx(LANDLORD, 0, END + 30);
    c.submit_assessment(l, U128(1), H1.into(), H2.into(), 8_000);
}

#[test]
#[should_panic(expected = "assessment deadline has passed")]
fn late_assessment_rejected() {
    let (mut c, l) = disputed(100_000_000);
    ctx(ASSESSOR, 0, END + 20 + W + 1);
    c.submit_assessment(l, U128(1), H1.into(), H2.into(), 8_000);
}

#[test]
fn silent_assessor_lets_parties_go_to_arbiter() {
    let (mut c, l) = disputed(100_000_000);
    ctx(TENANT, 0, END + 20 + W + 1);
    c.appeal(l, H1.into());
    assert_eq!(c.get_lease(l).unwrap().state, State::Appealed);
}

#[test]
#[should_panic(expected = "the assessor still has time")]
fn cannot_skip_assessor() {
    let (mut c, l) = disputed(100_000_000);
    ctx(TENANT, 0, END + 25);
    c.appeal(l, H1.into());
}

#[test]
fn appeal_then_arbiter_rules() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(LANDLORD, 0, END + 40);
    c.appeal(l, H1.into());
    ctx(ARBITER, 0, END + 50);
    c.rule(l, U128(200_000_000), H2.into());
    let lease = c.get_lease(l).unwrap();
    assert_eq!(lease.state, State::Settled);
    assert_eq!(lease.ruling.unwrap().to_landlord.0, 200_000_000);
    assert_eq!(claimable(&c, LANDLORD), 200_000_000);
    assert_eq!(claimable(&c, TENANT), DEP - 200_000_000);
    // landlord got >= half of the claim: not a lost dispute
    assert_eq!(c.get_record(id(LANDLORD)).disputes_lost, 0);
}

#[test]
#[should_panic(expected = "appeal window has closed")]
fn late_appeal_rejected() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(LANDLORD, 0, END + 30 + W + 1);
    c.appeal(l, H1.into());
}

#[test]
#[should_panic(expected = "only the arbiter")]
fn assessor_cannot_rule() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(LANDLORD, 0, END + 40);
    c.appeal(l, H1.into());
    ctx(ASSESSOR, 0, END + 50);
    c.rule(l, U128(1), H2.into());
}

#[test]
#[should_panic(expected = "only the landlord or tenant")]
fn stranger_cannot_appeal() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(STRANGER, 0, END + 40);
    c.appeal(l, H1.into());
}

#[test]
#[should_panic(expected = "no open claim")]
fn settled_lease_cannot_be_reopened() {
    let (mut c, l) = claimed(100_000_000);
    ctx(TENANT, 0, END + 20);
    c.accept_claim(l);
    c.accept_claim(l);
}

// ------------------------------------------------------------ cancel + withdraw

#[test]
fn cancel_funded_lease_refunds_tenant() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    ctx(LANDLORD, 0, START + 2);
    c.cancel(l);
    assert_eq!(c.get_lease(l).unwrap().state, State::Cancelled);
    assert_eq!(claimable(&c, TENANT), DEP);
}

#[test]
#[should_panic(expected = "only a lease that is not yet active can be cancelled")]
fn active_lease_cannot_be_cancelled() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    activate(&mut c, l);
    ctx(LANDLORD, 0, START + 4);
    c.cancel(l);
}

#[test]
fn withdraw_zeroes_balance() {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 1);
    c.return_in_full(l);
    ctx(TENANT, 0, END + 2);
    let _ = c.withdraw();
    assert_eq!(claimable(&c, TENANT), 0);
}

#[test]
#[should_panic(expected = "nothing to withdraw")]
fn empty_withdraw_rejected() {
    let mut c = new_contract();
    ctx(TENANT, 0, START);
    let _ = c.withdraw();
}

#[test]
fn failed_withdrawal_restores_balance() {
    let mut c = new_contract();
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("keyback.testnet"))
        .predecessor_account_id(id("keyback.testnet"))
        .block_timestamp(START * NS);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!c.on_withdraw(id(TENANT), U128(DEP)));
    assert_eq!(claimable(&c, TENANT), DEP);
}

// ------------------------------------------------------------ trust fixes

#[test]
fn role_change_does_not_touch_open_cases() {
    let (mut c, l) = disputed(100_000_000);
    ctx(ADMIN, 0, END + 21);
    c.set_roles(id(STRANGER), id(STRANGER));
    // the lease keeps the assessor it was created with
    ctx(ASSESSOR, 0, END + 30);
    c.submit_assessment(l, U128(1), H1.into(), H2.into(), 8_000);
    assert_eq!(c.get_lease(l).unwrap().state, State::Assessed);
}

#[test]
#[should_panic(expected = "only the assessor")]
fn new_assessor_cannot_judge_old_case() {
    let (mut c, l) = disputed(100_000_000);
    ctx(ADMIN, 0, END + 21);
    c.set_roles(id(STRANGER), id(STRANGER));
    ctx(STRANGER, 0, END + 30);
    c.submit_assessment(l, U128(1), H1.into(), H2.into(), 8_000);
}

#[test]
#[should_panic(expected = "only the arbiter")]
fn admin_cannot_become_arbiter_mid_case() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(TENANT, 0, END + 40);
    c.appeal(l, H1.into());
    ctx(ADMIN, 0, END + 41);
    c.set_roles(id(ADMIN), id(ADMIN));
    ctx(ADMIN, 0, END + 50);
    c.rule(l, U128(300_000_000), H2.into());
}

#[test]
fn other_party_can_answer_the_move_out_report() {
    // tenant recorded move-out in at_moveout(); the landlord answers with their own
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 5);
    c.counter_checkout(l, H1.into());
    let lease = c.get_lease(l).unwrap();
    assert_eq!(lease.checkout_by.unwrap(), id(TENANT));
    assert_eq!(lease.counter_checkout_hash.unwrap(), H1);
}

#[test]
fn tenant_can_answer_during_a_dispute() {
    let mut c = new_contract();
    let l = create(&mut c);
    fund(&mut c, l);
    activate(&mut c, l);
    ctx(LANDLORD, 0, END);
    c.submit_checkout(l, H2.into());
    ctx(LANDLORD, 0, END + 10);
    c.file_claim(l, U128(100_000_000), H1.into());
    ctx(TENANT, 0, END + 20);
    c.dispute(l, H2.into());
    c.counter_checkout(l, H1.into());
    assert!(c.get_lease(l).unwrap().counter_checkout_hash.is_some());
}

#[test]
#[should_panic(expected = "you already recorded the move-out report")]
fn cannot_answer_your_own_report() {
    let (mut c, l) = at_moveout();
    ctx(TENANT, 0, END + 5);
    c.counter_checkout(l, H1.into());
}

#[test]
#[should_panic(expected = "a second move-out report was already added")]
fn only_one_answer() {
    let (mut c, l) = at_moveout();
    ctx(LANDLORD, 0, END + 5);
    c.counter_checkout(l, H1.into());
    c.counter_checkout(l, H2.into());
}

#[test]
#[should_panic(expected = "move-out reports can only be added before the assessment")]
fn no_new_evidence_after_assessment() {
    let (mut c, l) = assessed(300_000_000, 60_000_000);
    ctx(LANDLORD, 0, END + 40);
    c.counter_checkout(l, H1.into());
}
