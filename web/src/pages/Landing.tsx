import { useApp } from '../ctx'
import { ArtEnclave, ArtMoveOut, ArtPay, ArtRecord, ArtSettle, ArtSign, HeroArt, Ic, Wordmark } from '../art'

const STEPS = [
  {
    art: <ArtPay />,
    title: 'Pay the deposit into the contract',
    body: 'The tenant pays Keyback, not the landlord. The landlord can see the money is there but has no way to move it.',
  },
  {
    art: <ArtSign />,
    title: 'Sign one move-in report',
    body: 'Both sides sign the same room-by-room condition report. Its hash goes on-chain and becomes the only baseline a deduction can be measured against.',
  },
  {
    art: <ArtMoveOut />,
    title: 'Record the move-out',
    body: 'Either side records the condition on the way out. If the other side disagrees, they file their own report, and the landlord has to prove any difference.',
  },
  {
    art: <ArtSettle />,
    title: 'Settle by the rules',
    body: 'Return in full with one click, or claim specific items. The unclaimed part is released right away. Disputed items go to the assessor, then to a person if either side appeals.',
  },
]

const GUARANTEES: [string, string, string][] = [
  ['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4', 'The landlord cannot withdraw the deposit', 'Money only leaves the contract through a return, an accepted claim, a decision or a ruling.'],
  ['M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'Every deadline has a default', 'No claim by the deadline means a full refund. No reply to a claim means it stands. Anyone can trigger the default once time is up.'],
  ['M4 12h11 M11 6l6 6-6 6 M20 5v14', 'Undisputed money moves first', 'If the landlord claims $60 of a $500 deposit, the tenant can withdraw $440 the same minute.'],
  ['M9 5h6 M7 3h10v18H7z M10 11h4 M10 15h4', 'No baseline, no deduction', 'An item that is not in the signed move-in report cannot be charged for. Fair wear and tear is not chargeable either.'],
  ['M12 3v3 M5 9h14 M7 9l-3 7h6z M17 9l-3 7h6z M8 21h8', 'Judges are fixed per lease', 'The assessor and arbiter are recorded when the lease is created. Changing them later only affects new leases.'],
  ['M4 7h16v10H4z M8 12h.01 M16 12h.01 M12 10v4', 'Payouts cannot get stuck', 'Each payout is credited to a balance and withdrawn by its owner. A failed transfer puts the balance back.'],
]

export default function Landing() {
  const { dep } = useApp()
  const contractUrl = `${dep.explorer}/address/${dep.contractId}`
  return (
    <div className="lp">
      <header style={{ borderBottom: '1px solid var(--kb-line)', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="lp-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 68 }}>
          <a href="#/" style={{ textDecoration: 'none' }} aria-label="Keyback home">
            <Wordmark />
          </a>
          <nav style={{ display: 'flex', gap: 24, alignItems: 'center', fontSize: 15, fontWeight: 600 }}>
            <a href="#how" className="hide-sm" style={{ color: 'var(--kb-ink)', textDecoration: 'none' }} onClick={scrollTo('how')}>
              How it works
            </a>
            <a href="#rules" className="hide-sm" style={{ color: 'var(--kb-ink)', textDecoration: 'none' }} onClick={scrollTo('rules')}>
              Guarantees
            </a>
            <a href="#/landlords" className="hide-sm" style={{ color: 'var(--kb-ink)', textDecoration: 'none' }}>
              Landlord records
            </a>
            <a href="#/app" className="lp-btn primary" style={{ padding: '8px 18px', fontSize: 15 }}>
              Open the demo
            </a>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <p className="lp-kicker">Rent deposits, held on NEAR</p>
            <h1>Get your rent deposit back.</h1>
            <p className="lp-lede">
              Keyback holds a tenant's deposit in a smart contract for the length of the lease. The landlord can only deduct for damage
              the signed move-in report proves, and every deadline is enforced on-chain.
            </p>
            <div className="lp-cta">
              <a className="lp-btn primary" href="#/app">
                Open the live demo
              </a>
              <a className="lp-btn ghost" href="#how" onClick={scrollTo('how')}>
                See how it works
              </a>
            </div>
            <p className="lp-fine">Runs on NEAR testnet with test dollars. Nothing to install, no wallet needed to try it.</p>
          </div>
          <div>
            <HeroArt />
          </div>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap lp-grid-2" style={{ alignItems: 'start' }}>
          <div>
            <p className="lp-kicker">The problem</p>
            <h2>The landlord holds the money, so the landlord decides.</h2>
            <p>
              A deposit is usually one to three months of rent, paid straight to the landlord at move-in. At move-out the landlord decides
              how much comes back. A tenant who disagrees has one option: a court claim that often costs more time and money than the
              amount in dispute.
            </p>
            <p>
              England and Wales fixed this in 2007 by requiring deposits to sit in a government-approved scheme. Most renters elsewhere have
              nothing like it. Keyback puts the same protection in a contract anyone can use, in any country, without a government scheme
              behind it.
            </p>
          </div>
          <div className="lp-card" style={{ padding: 8 }}>
            <table className="lp-compare">
              <thead>
                <tr>
                  <th />
                  <th>Today</th>
                  <th>With Keyback</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Who holds it</td>
                  <td>The landlord</td>
                  <td>A contract neither side controls</td>
                </tr>
                <tr>
                  <td>What can be deducted</td>
                  <td>Whatever the landlord says</td>
                  <td>Damage the move-in report proves</td>
                </tr>
                <tr>
                  <td>Landlord goes quiet</td>
                  <td>Tenant chases them</td>
                  <td>Full refund when the claim window closes</td>
                </tr>
                <tr>
                  <td>A disagreement</td>
                  <td>Small-claims court</td>
                  <td>Assessor, then a human appeal, with written reasons</td>
                </tr>
                <tr>
                  <td>Landlord's history</td>
                  <td>Word of mouth</td>
                  <td>Public record from settled leases</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="lp-section tint" id="how">
        <div className="lp-wrap">
          <p className="lp-kicker">How it works</p>
          <h2>Four steps from keys in to money back.</h2>
          <p className="lp-lede" style={{ marginBottom: 44 }}>
            Each step is a transaction on NEAR. Each one has a deadline, and missing it has a published consequence.
          </p>
          <div className="lp-grid-4">
            {STEPS.map((s, i) => (
              <div className="lp-step" key={s.title}>
                <span className="n">{i + 1}</span>
                {s.art}
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" id="rules">
        <div className="lp-wrap lp-grid-2" style={{ alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 100 }}>
            <p className="lp-kicker">Guarantees</p>
            <h2>Enforced by the contract, not by a policy page.</h2>
            <p className="lp-lede">
              These are checks in the contract code. Neither the landlord, the tenant nor Keyback can switch them off for an existing lease.
            </p>
            <a href={contractUrl} target="_blank" rel="noreferrer">
              Read the deployed contract on the NEAR explorer
            </a>
          </div>
          <div>
            {GUARANTEES.map(([d, t, b]) => (
              <div className="lp-rule" key={t}>
                <Ic d={d} />
                <div>
                  <b>{t}</b>
                  <span>{b}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section dark">
        <div className="lp-wrap">
          <div className="lp-grid-2">
            <div>
              <p className="lp-kicker">Private assessment</p>
              <h2 style={{ color: '#fff' }}>Disputes are judged in private. The result can be checked by anyone.</h2>
              <p>
                The assessor runs on NEAR AI Cloud inside a trusted execution environment. It reads both reports and the claim, applies
                eight published rules, and returns an amount and a reason for every item. The enclave signs the request and the response,
                and Keyback re-checks that signature every time the decision is shown.
              </p>
              <p>
                Only hashes of the evidence go on-chain. Reports, photos and written reasons stay off-chain, and the server refuses to serve
                any document whose hash no longer matches.
              </p>
            </div>
            <ArtEnclave />
          </div>
          <div className="lp-card" style={{ marginTop: 40 }}>
            <p className="lp-kicker" style={{ marginBottom: 8 }}>From the testnet demo</p>
            <h3>A landlord claims $450 of a $500 deposit. The assessor allows $60.</h3>
            <p style={{ marginBottom: 0 }}>
              The claim lists a cracked window ($60), a full repaint ($150), a new sofa ($200) and cooker cleaning ($40). The window is
              allowed: it was "good" at move-in and "damaged" at move-out. The walls and sofa went from "good" to "fair", which is one step
              of normal wear (rule R3). The cooker was in the same state both times (rule R6). The tenant gets $440 back.
            </p>
          </div>
          <div className="lp-stats">
            <div>
              <b>49</b>
              <span>contract tests</span>
            </div>
            <div>
              <b>8</b>
              <span>assessment rules, published</span>
            </div>
            <div>
              <b>3</b>
              <span>deadlines enforced on-chain</span>
            </div>
            <div>
              <b>10</b>
              <span>lease states, each one tested</span>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap lp-grid-2">
          <ArtRecord />
          <div>
            <p className="lp-kicker">Landlord records</p>
            <h2>Check a landlord before you pay them.</h2>
            <p>
              Every settled lease updates the landlord's public record: the share of deposits they returned, how often they returned in
              full, and how many disputes they lost. It is read from contract state, so it cannot be edited, deleted or paid for.
            </p>
            <p>For a good landlord, that record is a reason to be picked. Returning a deposit takes one click.</p>
            <a className="lp-btn ghost" href="#/landlords">
              Browse landlord records
            </a>
          </div>
        </div>
      </section>

      <section className="lp-section tint">
        <div className="lp-wrap">
          <p className="lp-kicker">Who it is for</p>
          <h2>Built for both sides of the lease.</h2>
          <div className="lp-grid-3" style={{ marginTop: 32 }}>
            <div className="lp-card">
              <h3>Tenants</h3>
              <p style={{ margin: 0, color: 'var(--kb-text-2)' }}>
                Your deposit is safe from the day you pay it. You see every deadline, every claim and the reason for every deduction.
              </p>
            </div>
            <div className="lp-card">
              <h3>Landlords</h3>
              <p style={{ margin: 0, color: 'var(--kb-text-2)' }}>
                Real damage gets paid, with evidence both sides signed. No holding money in trust, no back-and-forth over email.
              </p>
            </div>
            <div className="lp-card">
              <h3>Agents and rental platforms</h3>
              <p style={{ margin: 0, color: 'var(--kb-text-2)' }}>
                Use the contract and API behind your own app. Every lease exports to CSV for your accounts.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap lp-grid-2">
          <div>
            <p className="lp-kicker">Try it</p>
            <h2>Run a whole lease in five minutes.</h2>
            <p>
              The demo runs on NEAR testnet with test dollars. Switch between the landlord, the tenant, the assessor and the arbiter from the
              top bar, and take a lease from deposit to payout. Deadlines are one minute long so you can watch them expire.
            </p>
            <div className="lp-cta">
              <a className="lp-btn primary" href="#/app">
                Open the demo
              </a>
            </div>
          </div>
          <div className="lp-code">
            <span className="c"># or run everything yourself</span>
            {'\n'}cd app && npm install
            {'\n'}npm run setup  <span className="c"># testnet accounts and contracts</span>
            {'\n'}npm run demo   <span className="c"># five leases, end to end</span>
            {'\n'}npm run api    <span className="c"># API and assessor on :8787</span>
            {'\n'}cd ../web && npm install && npm run dev
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <Wordmark light />
          <span>
            Built for the NEAR Hackathon. Testnet only. Contract{' '}
            <a href={contractUrl} target="_blank" rel="noreferrer">
              {dep.contractId}
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}

function scrollTo(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
