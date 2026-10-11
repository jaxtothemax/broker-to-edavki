# Doh-Div: eDavki XML import format (plus Doh-Obr and D-IFI)

> Researched: 2026-10-06 · Verification: adversarially verified (22 claims: 22 confirmed, 0 refuted, 0 uncertain) · Updated: 2026-10-11 (§5.1: who the payer is for a dividend a foreign broker passes on, from primary sources, not independently verified: not found) and 2026-10-09 (§5: a broker as the payer of its dividends, one eDavki record, low confidence)
>
> Research for building TaxReporter. It is not tax advice, and FURS publications and the law win over anything written here. Inline markers are explained in the [README](README.md#confidence-and-verification-legend).

**Scope.** Covers tax year (TY) 2025, which was filed in Feb/Mar 2026, and TY 2026, which will be filed in Jan–Feb 2027. Doh-Div (dividends) is the main subject; Doh-Obr (interest) and D-IFI (derivatives) are covered in §10 and §11. Doh-KDVP is in [01](01-furs-doh-kdvp.md).

## 1. Summary for implementers

- **Current schemas:** `Doh_Div_3.xsd`, `Doh_Obr_2.xsd`, `D_IFI_4.xsd` and the shared `EDP-Common-1.xsd`, all under `https://edavki.durs.si/Documents/Schemas/`. On 2026-10-06, probes for `Doh_Div_4`, `Doh_Obr_3`, `D_IFI_5` and `EDP-Common-2` all returned 404. FURS's own Excel→XML templates, last modified 2026-02-10, still emit `Doh_Div_3` and `Doh_Obr_2`.
- **Structural traps in Doh-Div v3:**
  - `<Dividend>` elements are **siblings** of `<Doh_Div>` inside `<body>`. They are not its children.
  - `<body>` has **no** `edp:bodyContent`. Doh-Obr v2 and D-IFI v4 both **require** `<edp:bodyContent/>` as the first child of `<body>`.
- **The XSD is permissive.** It enforces element order, `xs:date`, 2-decimal amounts and the 8-digit pattern of the tax number when one is present; it does not require a tax number at all ([01 §3](01-furs-doh-kdvp.md#3-envelope-namespaces-header-encoding)) (corrected after verification). It does **not** enforce the `Type` enum, country-code format, positive amounts or mandatory fields. eDavki enforces those on import or submission, so our app has to validate them itself (§9).
- **One `<Dividend>` per payment.** FURS has rejected summed payments. Two records with the same `PayerIdentificationNumber` on the same `Date` trigger a "critical error". FURS's own workaround is to give them sequential IDs.
- **Deadline:** 28 February of the following year, moved to the next working day when it falls on a weekend. TY2025 was due **2 March 2026**. TY2026 should be due **1 March 2027**, because 28 Feb 2027 is a Sunday.
- **Electronic filing** is mandatory for more than 5 payments. Since 1 Jan 2026 this rule is in the law itself (new Art. 326(8) ZDavP-2, added by ZDavP-2P).
- **Tax rate:** dividends are taxed at 25% as a final tax. The rate was 27.5% only for 2020–2021. The foreign tax credit is capped at the treaty rate (US: 15%), and also at the Slovenian tax due on that income (corrected after verification).

## 2. Sources and versions

| Artifact | URL | Notes |
|---|---|---|
| Doh_Div_3.xsd | https://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd | sha256 `9a78d1e5…c245ac3` |
| EDP-Common-1.xsd | https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd | shared header, signatures and types |
| Doh_Obr_2.xsd / D_IFI_4.xsd | same folder | older versions (Doh_Div_1/2, Doh_Obr_1, D_IFI_2/3) were compared for diffs |
| FURS XML guide, Doh-Div (2026) | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.n.sl.pdf | field rules and Type table |
| FURS Excel→XML template | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.i.xlsx | generator formulas, code lists, cell help. `Last-Modified: Tue, 10 Feb 2026` |
| FURS CSV guide (docx) | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_csv.n.docx | duplicate-ID rule, 100-char ReliefStatement |
| Form instructions (2020, 2021, 2023+) | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div20.n.sl.pdf | Types 1–7, CorpData section |
| Legal form DOHKAP št. 3 | https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.i.sl.pdf | Uradni list RS 43/2022 |
| FURS capital-income guide (saved 2026-08-04) | https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc | rates, 30 April decision |
| Public call for TY2025 | https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2026/Javni-poziv-rok-je-2.3.2026.pdf | deadline 2.3.2026 |
| ZDavP-2P | https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3396 | Ur. l. RS 100/2025 (4.12.2025), in force 1.1.2026 |
| ib-edavki source | https://github.com/ib-edavki/ib-edavki (formerly jamsix/ib-edavki) | reference implementation, last push 2026-03-29 |

## 3. Doh-Div v3 document structure

### 3.1 Namespaces and envelope

```xml
<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd"
          xmlns:edp="http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd">
  <edp:Header> … </edp:Header>          <!-- required -->
  <edp:AttachmentList/>                 <!-- optional -->
  <edp:Signatures/>                     <!-- REQUIRED, may be empty -->
  <body>
    <Doh_Div> … </Doh_Div>              <!-- required, exactly 1 -->
    <Dividend> … </Dividend>            <!-- 0..n, siblings of Doh_Div -->
    <CorpData>…</CorpData>              <!-- 0..n, only for Type 7 -->
    <CorpDataDetail>…</CorpDataDetail>  <!-- 0..n, only for Type 7 -->
    <SubseqSubmissDecision>…            <!-- 0..1, late filing with a decision -->
    <SubseqSubmissProposal>…            <!-- 0..1, late-filing proposal -->
  </body>
</Envelope>
```

All schemas use `elementFormDefault="qualified"`, so unprefixed children belong to the form namespace.

### 3.2 Header (`EDP-Common-1.xsd`)

| Element | Type / restriction | Notes |
|---|---|---|
| `edp:Header/edp:taxpayer/edp:taxNumber` | `positiveInteger`, pattern `[0-9]{8}` | in a choice with `edp:vatNumber`. Use `taxNumber` for individuals. |
| `edp:taxpayer/edp:taxpayerType` | enum `FO` (individual), `PO` (legal person), `SP` (sole proprietor) | always `FO` here |
| `edp:taxpayer/name, address1, address2, city, postNumber (≤12), postName, …` | optional | eDavki pre-fills these from its register when logged in |
| `edp:Header/edp:Workflow/edp:DocumentWorkflowID` | string, maxLength 1 | FURS 2026 templates: `O` = original, `P` = correction before the decision |
| `edp:Header/edp:domain` | string | FURS template writes `edavki.durs.si` |

**Header order and required content** (corrected after verification):

- Element order in `edp:Header` is significant: `taxpayer`, `responseTo?`, `Workflow?`, `CustodianInfo?`, `domain?`. Inside `taxpayer`, the `taxNumber`/`vatNumber` choice comes first, then `taxpayerType`, `name`, `address1` and so on.
- Both options of that choice are `minOccurs=0`, so the XSD accepts a header with no tax number. eDavki requires one, so the generator must enforce it (verified in [01 §3](01-furs-doh-kdvp.md#3-envelope-namespaces-header-encoding); same shared schema).
- The FURS Doh-Div template emits an empty `<edp:DocumentWorkflowName/>` after `edp:DocumentWorkflowID`. The FURS Doh-Obr template has no `edp:Workflow` element at all.

For Doh-Div and D-IFI v4, the document type goes in `edp:Header/edp:Workflow/edp:DocumentWorkflowID`. For Doh-Obr v2 it goes in `Doh_Obr/DocumentWorkflowID`.

The older eDavki help page also lists `I` (self-report), `B` (late filing without a decision) and `R` (late filing with a decision). ib-edavki uses `I` for its "test" mode. **Emit `O` by default.**

### 3.3 `<Doh_Div>`: header fields, in XSD order

| # | Element | Type | Notes |
|---|---|---|---|
| 1 | `Period` | string | tax year, e.g. `2026` |
| 2 | `EmailAddress` | string | recommended |
| 3 | `PhoneNumber` | string | recommended |
| 4 | `ResidentCountry` | string | `SI` |
| 5 | `IsResident` | boolean (default false) | `true` for SI residents |
| 6 | `Locked` | boolean | do not emit |
| 7 | `SelfReport` | boolean | FURS template emits `false`. Probably maps to "samoprijava" (low confidence). |
| 8 | `WfTypeU` | boolean | FURS template emits `false`. Meaning undocumented (low confidence). |
| 9 | `Notes` | string | optional |

### 3.4 `<Dividend>` record

All elements are `minOccurs="0"` in the XSD. The "Required" column is the FURS business rule, taken from the 2026 XML guide and the template cell help. **Order is significant** (`xs:sequence`).

| # | Element | XSD type | Required (FURS) | Rule |
|---|---|---|---|---|
| 1 | `Date` | `xs:date` (YYYY-MM-DD) | yes | Date the dividend was received (paid). Must lie inside `Period`. |
| 2 | `PayerTaxNumber` | string | only for SI payers | Slovenian 8-digit tax number. Leave empty or omit for foreign payers. |
| 3 | `PayerIdentificationNumber` | string (no XSD max) | yes for foreign payers (but see the note below) | ID used for tax purposes in the payer's state (tax ID or another ID). See §5. |
| 4 | `PayerName` | string | yes | The FURS template escapes only `&` (as `&amp;`), not `<`, `>` or quotes, so use a real XML serializer (corrected after verification). |
| 5 | `PayerAddress` | string | yes | |
| 6 | `PayerCountry` | string | yes | 2-letter code from the FURS list (§4.3). `SI` for Slovenian payers. |
| 7 | `Type` | string | yes | code 1–7 (§4.1) |
| 8 | `Value` | `Amount_Type` (decimal, fractionDigits=2) | yes | **Gross** amount in EUR, rounded to 2 decimals, **> 0**. BSI rate valid on the receipt date. |
| 9 | `ForeignTax` | `Amount_Type` | yes unless `PayerCountry`=SI (but see the note below) | Foreign tax in EUR at the same date's BSI rate. Must be **empty** when the payer is SI. Use `0.00` when none was withheld. |
| 10 | `SourceCountry` | string | yes | Source country, "evident from the ISIN". May differ from `PayerCountry`. ISIN prefixes such as `XS`, `EU` or `KY` do not reliably give the source country (corrected after verification). |
| 11 | `ReliefStatement` | string (eDavki UI: max 100 chars) | no | Treaty claim, see §6. |

**FURS's own documents disagree on which fields are mandatory** (corrected after verification):

- `PayerIdentificationNumber`: the 2026 XML guide says it is mandatory for foreign payers ("Vnos ni obvezen, razen v primerih, ko je izplačevalec iz tujine"). The CSV guide makes it mandatory only when the same foreign payer pays several dividends on the same day. The form instructions (`doh_odm_div20.n.sl.pdf`) say "Podatek o tej številki ni obvezen." The conservative choice is to always emit it for foreign payers.
- `ForeignTax`: the XML and CSV guides say it is mandatory except for Slovenian payers, where it must not be filled ("Vnos je obvezen, razen … Slovenija … ne sme biti izpolnjeno"). The eDavki UI help (`NavodiloZaNapovedDiv.html`) calls it "Vnos ni obvezen". The FURS template omits the `ForeignTax` element whenever the cell is blank.

`Amount_Type` here is `xs:decimal` with `fractionDigits=2` and no sign restriction. A minus sign passes the XSD, as a negative test shows (§8), so positivity has to be checked in code. All the other `Dividend` fields are plain `xs:string` with no `maxLength`.

### 3.5 Other body elements (rarely needed)

- **`CorpData`** (`Id`, `TradeId`, `SoldDate`, `CorpAmount`, `CorpShare`, `CorpSoldAmount`, `CorpSoldShare`, `NominalTotalValue`, `Sum`) and **`CorpDataDetail`** (`Id`, `PurchDate`, `PurchType`, `PurchAmount`, `PurchShare`, `ValueOfPurchased`, `ValueAtPurchase`, `SoldAmount`, `SoldShare`, `SoldValue`, `SoldSharesValueAtPurchase`, `GrossSoldValue`).
  - These are only for **Type 7**: own-share buy-backs outside a regulated market, where acquisition cost is deducted (form point 6).
  - Out of scope for broker dividends.
- **`SubseqSubmissDecision`** (`DecisionId`, `DecisionDate`, `SubmissionDeadline`) and **`SubseqSubmissProposal`** (`ProposalSubmitted`, `StartDate`, `ProposalDeadline`, `DelayReasons`).
  - Used for late filing under Art. 62 ZDavP-2.

## 4. Enumerations

### 4.1 `Type`: dividend type (Šifra vrste dividend)

| Code | Meaning (FURS 2026 XML guide and template) |
|---|---|
| **1** | Dividends as distribution of company profit based on an ownership share. **Ordinary stock dividends.** |
| 2 | Hidden profit distribution (prikrito izplačilo dobička) under the corporate income tax law |
| 3 | Profit distributed on profit-participating debt securities |
| **4** | Income from distribution of profit, net profit or revenue of an **investment fund**, except fund income distributed as interest (Art. 90(4)(3) ZDoh-2). **ETF/UCITS distributions.** |
| 5 | Value of returned subsequent contribution (Art. 90(4)(4)) |
| 6 | Additional earn-out payments on disposal of a share (Art. 90(4)(5)) |
| 7 | Value of shares in own-share acquisitions (Art. 90(4)(6)) |

The legal form from 2015 lists only 1–4. Codes 5–7 were added later and appear in the 2020/2021/2023+ instructions and the 2026 template.

ib-edavki writes `Type=1` for everything, including ETFs. FURS's own Q&A treats fund distributions as dividends under Art. 90(4)(3), i.e. code **4**. Both are taxed at the same 25%. **Recommendation: emit 4 for funds and ETFs, 1 for corporate shares.**

### 4.2 Document status

| Where | Values |
|---|---|
| `DocumentWorkflowID` | `O` original, `P` correction (2026 FURS docs) |
| Paper form "Oznaka statusa napovedi" | 1 late filing (Art. 62), 2 self-report (Art. 63), 3 correction before the decision (Art. 64) |

### 4.3 Country codes

These are 2-letter codes, taken from the 251-entry list in FURS's Excel template (sheet "Šifranti", cells A2:A252, used as the validation list for `PayerCountry` and `SourceCountry`). The list is ISO 3166-1 alpha-2 with these deviations:

- **Greece is `EL`; `GR` is absent.** A Greek ISIN prefix `GR` must be mapped to `EL`. The Doh-Obr template lists "EL - GRČIJA" as well.
- `XK` (Kosovo) is included.
- The legacy `AN` (Netherlands Antilles) is included.

## 5. One record per payment, and payer IDs

- **No aggregation.** A FURS reviewer told an ib-edavki user ([issue #42](https://github.com/ib-edavki/ib-edavki/issues/42), 2022): "V napoved je potrebno vpisati toliko izplačil, kot jih je na dokazilu. Seštevanje ni dovoljeno". This translates as "enter as many payments as appear on the evidence; summing is not allowed."
  - In that case two same-day Barrick Gold payments had been merged and the foreign tax misallocated. The two payments were an "Ordinary Dividend" and a "Return of Capital" on 2021-06-15, and FURS's correction table kept the Return of Capital as a separate record with no foreign tax (corrected after verification). Whether a broker's "Return of Capital" is a dividend under Art. 90 ZDoh-2 at all, or instead reduces the acquisition cost, is unresolved (see Open questions).
  - The paper form also has one row per dividend, and the more-than-5-payments rule counts payments.
  - **Sources conflict on broker fragments.** Some brokers split one corporate payment into several rows (eToro per position, XTB per lot), and [07 §3](07-brokers-eu-and-others.md#3-cross-cutting-parser-rules) recommends aggregating those rows per payer and day. FURS's rule above forbids summing *different* payments. Whether fragments of one payment may be merged is not settled by any source; keeping them separate collides with the duplicate-key rule below.
- **Duplicate key rule.** The FURS CSV guide says that if the same identification number appears on several records for the same day, the return cannot be filed ("kritična napaka").
  - FURS recommends entering sequential numbers (1, 2, …) as the ID in that case. The guide frames this for the same foreign payer on the same day, and the workaround means dropping the real payer ID for those records (corrected after verification).
  - Our generator should detect duplicate `(Date, PayerIdentificationNumber)` pairs, for example an ordinary dividend plus a special dividend or a return of capital on the same day, and disambiguate them.
- **Which ID to use.** The XML guide says the ID is mandatory for foreign payers. The form instructions say "the number used for tax purposes in the payer's state of residence (tax or other ID)… not mandatory". The CSV guide requires it only for several same-day payments from one payer (§3.4).
  - Use the US EIN for US issuers, the VAT/tax ID for EU issuers, the company registration number for Irish funds, and the LEI as a fallback.
  - ib-edavki maintainers report that FURS accepts anything ([issue #163](https://github.com/ib-edavki/ib-edavki/issues/163)).
- **Who the payer is, for a broker that pays the dividend out** [L]. FURS's fields name the company that pays (§3.4: payer name, address and country). One eDavki record seen on 2026-10-09, of a Trading 212 dividend that its owner had filed earlier, has the payer name `TRADING 212`, address `LONDON`, country `GB`, no tax number and no identification number, type 1, foreign tax 0.00, and source country `KY` for a US-listed share of a Cayman company. eDavki holds and displays such a record. That shows what the system accepts, not that the broker is the payer FURS means, and no FURS text found says so (primary sources searched on 2026-10-11, §5.1). The web app presets those three values for Trading 212 dividends (the command line does not: its `--payers` file is the only source there, #43), shows where they come from, and lets the user change them. It still writes the security's ISIN as the identification number, where that record had none (see "Which ID to use" above).
  - The source country in that record (`KY`) is the company's, where the app's default is the ISIN's first two letters (`US`). The app only asks for it when the ISIN names no country, so a user cannot set `KY` today.
- **Length** (corrected after verification). In 2023 eDavki accepted IDs longer than 12 characters on import but silently dropped the whole value on submission ([issue #86](https://github.com/ib-edavki/ib-edavki/issues/86)). ib-edavki therefore strips non-alphanumerics and truncates to 12, but only when the ID is longer than 12 (`re.sub('[^a-zA-Z0-9]+','')[0:12]`). On 2025-02-25 the maintainer wrote that the field is no longer limited to 12 characters ([issue #163](https://github.com/ib-edavki/ib-edavki/issues/163), not #86).
  - The XSD has no limit; Doh-Obr's `IdentificationNumber` has `maxLength 30`.
  - Treat this as low confidence and keep a configurable 12-char fallback.

### 5.1 Who the payer is for a dividend a foreign broker passes on

Added on 2026-10-11 for #44, from the primary sources listed at the end of this subsection, all retrieved that day. It is not part of the independent verification above.

**The question.** Who is the *izplačevalec* on Doh-Div for a dividend that a foreign broker passes on, and may the broker be entered in the payer fields (`PayerName`, `PayerAddress`, `PayerCountry`, `PayerIdentificationNumber`)? The web app presets Trading 212 there, on the strength of one eDavki record (§5, [L]).

**Not found.** No FURS instruction, FAQ, schema note or public written answer found says who the *izplačevalec* is when a foreign broker passes a dividend on. None says whether the broker may be entered in the payer fields. Searched on 2026-10-11:

- **ZDoh-2 NPB 36 and ZDavP-2 NPB 32, full texts (PISRS).** ZDoh-2 for *izplačevalec* and its forms. ZDavP-2 for *dividend* and the provisions on withholding agents and returns (arts. 58, 325, 326).
- **The FURS opis (15th edition, August 2026), full text.** Searched for *izplačevalec*, *posrednik*, *borzni posrednik*, *borznoposredniška*, *platform* and the brokers it names (eToro, Interactive Brokers, Revolut, Trade Republic, Mintos), and for Trading 212. It has no Q&A on dividends at all; its §3.3 and Q&A 6.2 Q7 are quoted below.
- **Every FURS Doh-Div document listed under Sources below:** the form instructions, the XML and CSV guides, the legal form and the UI help.
- **The payer elements of `Doh_Div_3.xsd`** (the vendored copy in `packages/furs/schemas/`). They are documented only as "Naziv izplačevalca dividend", "Naslov izplačevalca dividend", "Država izplačevalca dividend" and "Identifikacijska številka izplačevalca dividend". Nothing says who the payer is.
- **FURS's life-event page "Prejel sem dividende" and the e-uprava page on dividend tax.** Neither mentions brokers or the payer fields.
- **Web searches** limited to fu.gov.si, gov.si, edavki.durs.si, pisrs.si and uradni-list.si, plus an open-web search. They found only the documents above and the secondary sources listed below.

**Three terms that must be kept apart:**

- ***Plačnik* in ZDoh-2 art. 90(2)** is the company. The dividend chapter defines it inline. The ownership share is *"vsak delež, ki ga ima fizična oseba (v nadaljnjem besedilu: imetnik deleža) na podlagi vloženih sredstev v gospodarski družbi, zadrugi in drugih oblikah organiziranja, […] (v nadaljnjem besedilu: plačnik)"*. Art. 90(3) taxes as a dividend *"vsaka razdelitev dohodka imetniku deleža iz premoženja plačnika oziroma povezane osebe […] plačnika na podlagi njegovega lastniškega deleža v plačniku"*. In the law, the one who pays a dividend is the company in which the shares are held (**high confidence**; a statutory definition).
- ***Plačnik davka* in ZDavP-2 art. 58** is a Slovenian withholding agent. It must be a Slovenian resident, or a non-resident with a business unit (*poslovna enota*) or branch in Slovenia. Art. 58(1) separates two persons:
  - point 1, *"oseba, ki v svoje breme izplača dohodek"* (the person who pays income at its own expense);
  - point 7, *"oseba, ki za tuj račun prejme dohodek iz finančnih instrumentov, izdanih v nematerializirani obliki"* (the person who receives income from dematerialized instruments on another's account).

  Art. 58(2)(2) then makes the receiving intermediary the withholding agent when a point-1 payer *"izplača dohodek"* to it. The law thus pictures a custodian as receiving a dividend for its client, not as paying it. These provisions define who withholds Slovenian tax, not the form's payer fields.
- ***Izplačevalec* on the form** is not a term ZDoh-2 defines. In ZDoh-2 the word occurs only in unrelated provisions, on income in kind, withholding, advance tax and pension annuities. The legal form (MF-FURS obr. DOHKAP št. 3, Uradni list RS 43/2022) titles section 3 *"PODATKI O IZPLAČEVALCU DIVIDEND"*, with the columns *Firma*, *Sedež*, *Država* and *Davčna ali identifikacijska številka*. Reading the form's *izplačevalec* as art. 90(2)'s *plačnik* is an *(inference)*.

**The return is due whichever reading holds.** A foreign broker with no business unit or branch in Slovenia cannot be a *plačnik davka* (art. 58(1)). ZDavP-2 art. 325(5) then applies:

- *"Če obresti, dividende ali dohodek iz oddajanja premoženja v najem izplača oseba, ki ni plačnik davka, […] dohodnino […] ugotovi davčni organ na podlagi napovedi zavezanca."*
- The FURS opis (§3.3) puts the case as *"V primeru, da dividendo izplača oseba, ki ni plačnik davka (v primeru, ko zavezanec dosega dividende neposredno iz tujine), mora davčni zavezanec dosežene dividende napovedati sam"*.

**What FURS's own documents say about the payer fields:**

- **The form instructions** (`doh_odm_div20.n.sl.pdf`; `doh_odm_div.n.sl.pdf` has the same text) describe what to enter but not who the payer is: *"Davčni zavezanec vpiše podatke o izplačevalcu (ime in priimek oziroma naziv, naslov oziroma sedež, država in davčna številka izplačevalca). Če izplačevalcu ni dodeljena davčna številka po ZDavP-2 in po Zakonu o finančni upravi – ZFU, se navede številka, ki se uporablja za davčne namene v državi rezidentstva izplačevalca dohodka (davčna številka ali druga identifikacijska številka)."*
- **The 2026 XML guide and the CSV guide** both say *"Država vira je lahko enaka ali pa se razlikuje od države izplačevalca dividend. Država vira je razvidna iz oznake za dividende (npr. ISIN)."*
- **The older eDavki UI help required the opposite.** It is `NavodiloZaNapovedDiv.html`, `Last-Modified` 2014, and it still describes quarterly filing, so it is stale. It says *"Država izplačevalca dividende mora biti enaka državi iz katere ste prejeli dividendo in v kateri ste morebiti plačali tuji davek"*.
- So FURS moved from "must be equal" to "may differ". Neither text mentions a broker or an intermediary (*posrednik*). "May differ" also covers a company whose ISIN prefix is not its own country, such as the Cayman company with a US ISIN in §5. It is therefore not permission to enter a broker *(inference)*.
- **The FURS opis, Q&A 6.2 Q7,** is about interest on Slovenian government bonds and the reporting duty of ZDavP-2 art. 337. It uses *izplačati* for both kinds of payer:
  - the withholding agent that pays the interest, when it pays through foreign intermediaries: *"ko plačnik davka tovrstne obresti izplača fizičnim osebam posredno, preko tujih posrednikov"*;
  - the last intermediary in a Slovenian chain: *"posrednik, ki je dohodek izplačal (tj. posrednik, ki je zadnji v verigi)"*.

  It does not concern the Doh-Div fields. It shows only that FURS's use of the verb does not settle the question.

**Secondary sources** (not the rule):

- *Monitor* (Matej Huš, 28 Jan 2025) tells readers to enter *"ime in državo izplačevalca (to bo podjetje, katerega delnice si lastimo)"*: the company whose shares one owns.
- ib-edavki fills the payers of dividends from its `companies.xml` (the company), and the payers of interest from IBKR's own entities ([05 §2.1](05-prior-art.md#21-ib-edavki-ibkr--all-four-forms)).
- The eDavki record in §5 [L] shows what eDavki holds. It does not show what FURS means.

**What the answer changes in the return** (facts and their consequences, no change proposed):

- **Foreign tax.** `ForeignTax` must be left empty only when the payer's country is `SI` (§3.4). A payer in `GB` or in `US` both keep it.
- **Duplicate IDs.** Two records with the same identification number on the same day are a critical error (§5).
  - If the broker were the payer and its own number were entered, two companies' dividends paid on one day through one broker would collide.
  - The app avoids that today by writing the security's ISIN (§5). An ISIN identifies the security, not the payer *"v državi rezidentstva izplačevalca"*. The preset therefore pairs the broker's name with the security's identifier *(inference)*.
  - FURS itself suggests sequential numbers in that field when IDs collide, so the field evidently accepts numbers that are not tax numbers.

**Confidence.**

- In ZDoh-2, the *plačnik* of a dividend is the company: **high**.
- The form's *izplačevalec* means that company: **low**. It is an inference; no FURS text says so.
- A foreign broker may be entered in the payer fields: **not found**. The only support is the one eDavki record [L].

**Recommendation to the maintainer.** Ask FURS in writing; the draft is below.

- Keep the Trading 212 preset as it is until FURS answers or an architect review decides. Do not widen it to other brokers, which #44's checklist offers.
- The only primary text that says who pays a dividend, ZDoh-2 art. 90(2)–(3), names the company. The broker preset rests on the [L] record alone.
- Whether to take the preset back before a release that files real returns is the maintainer's decision, with architect review.

**Draft question to FURS (Slovenian).** It contains no personal data and nothing from the owner's eDavki record. The maintainer sends it; nothing has been sent.

> Zadeva: Podatki o izplačevalcu dividend na napovedi Doh-Div, kadar dividendo pripiše tuji borzni posrednik
>
> Spoštovani,
>
> prosimo za pisno pojasnilo glede vpisa podatkov o izplačevalcu dividend v napoved za odmero dohodnine od dividend (Doh-Div).
>
> Rezident Slovenije ima delnice ameriške družbe na računu pri tujem borznem posredniku, ki v Sloveniji nima poslovne enote ali podružnice. Družba izplača dividendo, posrednik pa jo pripiše na račun zavezanca. V ZDA je bil od dividende odtegnjen davek, v Sloveniji davčni odtegljaj ni bil obračunan. Na izpisku posrednika sta navedena posrednik in vrednostni papir (ime in ISIN), podatkov o družbi (naslov, davčna številka) pa izpisek ne vsebuje.
>
> 1. Kdo je v tem primeru izplačevalec dividend v smislu napovedi Doh-Div:
>    - družba, katere delnice ima zavezanec, ali
>    - borzni posrednik, ki je dividendo pripisal na račun zavezanca?
> 2. Ali je napoved pravilna, če zavezanec v polja »Naziv izplačevalca dividend«, »Naslov izplačevalca dividend« in »Država izplačevalca dividend« vpiše podatke borznega posrednika?
> 3. Katero številko naj zavezanec vpiše v polje »Identifikacijska številka izplačevalca dividend«, kadar davčna številka družbe ni znana? Ali je ustrezna oznaka ISIN vrednostnega papirja ali zaporedna številka, kot jo za več izplačil istega dne priporoča navodilo za pripravo datoteke CSV?
> 4. Ali podatki o izplačevalcu (družba ali posrednik) vplivajo na odbitek tujega davka, ali je za odbitek pomembna le »Država vira«?
>
> Vprašanje je splošno in se ne nanaša na posameznega davčnega zavezanca.
>
> Za odgovor se vam lepo zahvaljujemo.

**Draft question to FURS (English).** The same text, for the record. Send the Slovenian version.

> Subject: Payer details on the Doh-Div return when a foreign broker credits the dividend
>
> Dear Sir or Madam,
>
> We ask for a written explanation of how to enter the payer details on the dividend return (Doh-Div).
>
> A Slovenian resident holds shares of a US company in an account at a foreign broker that has no business unit or branch in Slovenia. The company pays a dividend and the broker credits it to the taxpayer's account. US tax was withheld from the dividend; no Slovenian withholding tax was charged. The broker's statement names the broker and the security (name and ISIN), but not the company's address or tax number.
>
> 1. Who is the payer of the dividend for the purposes of the Doh-Div return:
>    - the company whose shares the taxpayer holds, or
>    - the broker that credited the dividend to the taxpayer's account?
> 2. Is the return correct if the taxpayer enters the broker's details in the fields "Payer name", "Payer address" and "Payer country"?
> 3. Which number should the taxpayer enter in "Payer identification number" when the company's tax number is not known? Is the security's ISIN acceptable, or a sequential number, as the CSV instructions recommend for several payments on the same day?
> 4. Do the payer details (company or broker) affect the foreign tax credit, or does only "Source country" matter for it?
>
> The question is general and does not concern any particular taxpayer.
>
> Thank you for your answer.

**Still unknown:**

- Who the *izplačevalec* is for a dividend a foreign broker passes on.
- Whether entering the broker is accepted as correct, as opposed to merely held by eDavki.
- What FURS expects in `PayerIdentificationNumber` when the company's tax number is unknown.
- Whether any payer field matters to the foreign tax credit.

**Sources for this subsection**, all retrieved 2026-10-11:

- **ZDoh-2, NPB 36** (from 5 Mar 2026): [PISRS consolidated-text file](https://pisrs.si/api/datoteke/integracije/358727637). Art. 90. The file was served with no `Last-Modified`; its SHA-256 is `173eaefcd5b2c29abcba9380771812eb1cf042d831512d30c09894e1d27e938b`.
- **ZDavP-2, NPB 32** (from 2 Jul 2026): [PISRS consolidated-text file](https://pisrs.si/api/datoteke/integracije/594731150). Arts. 58 and 325. No `Last-Modified`; SHA-256 `2e20ae8dce5295364fbde66834f6dec1eeea720deca833ef2b679f5293c8aaf6`.
- **Form instructions (2020, 2021, 2023+)**: [doh_odm_div20.n.sl.pdf](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div20.n.sl.pdf). `Last-Modified: Mon, 30 Mar 2026 11:10:58 GMT`; SHA-256 `82801e8342fb5c4f81dd6eefaa1d40f4fb3c3d55a6c3d314d8a0046a26f066e5`.
- **Form instructions, the other file**: [doh_odm_div.n.sl.pdf](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.n.sl.pdf). `Last-Modified: Wed, 11 Mar 2026 10:52:32 GMT`; SHA-256 `29afd5a92ddaaf65ac40b3349621cecbe5fc10fceb4f28d35cdc0e6a86a13465`.
- **XML guide (2026)**: [doh_odm_div_xml.n.sl.pdf](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.n.sl.pdf). `Last-Modified: Wed, 04 Feb 2026 12:05:00 GMT`; SHA-256 `58500ea1911ff0883e7fc68e251773927cc57ed20545783ed4bb3f3a25f8356e`.
- **CSV guide**: [doh_odm_div_csv.n.docx](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_csv.n.docx). `Last-Modified: Tue, 04 Mar 2025 11:34:04 GMT`; SHA-256 `7b259235063502581c864c1a3f632e2d1d4ded292512c166b4a062ab993a9cff`.
- **eDavki UI help (stale)**: [NavodiloZaNapovedDiv.html](https://edavki.durs.si/OpenPortal/Doc/Durs/Dohodnina/NavodiloZaNapovedDiv.html). Windows-1250 encoded. `Last-Modified: Fri, 09 May 2014 08:10:34 GMT`; SHA-256 `86e1a7c46d557d8af5084789ad1f5d847136ae1bf0fd695ed328415829b6d3e7`.
- **Legal form DOHKAP št. 3** (Uradni list RS 43/2022): [doh_odm_div.i.sl.pdf](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.i.sl.pdf). `Last-Modified: Wed, 30 Mar 2022 05:56:42 GMT`; SHA-256 `30ed62f17493dd9e18da3731d879c55827323c65b4e86f0d0ca373e65e0feec1`.
- **FURS opis**, 15th edition, August 2026: [fu.gov.si](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc). §3.3 and Q&A 6.2 Q7. `Last-Modified: Tue, 04 Aug 2026 10:10:50 GMT`.
- **FURS life-event pages.** Neither covers brokers or the payer fields:
  - [Prejel sem dividende](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_dividende/), refreshed 14 Apr 2025;
  - [e-uprava: Obdavčitev dividend](https://e-uprava.gov.si/si/podrocja/davki/dohodek-iz-kapitala/obdavcitev-dividend.html), changed 5 Jul 2024.
- **Secondary**: [Monitor, "Furs pozna neobanke in spletne borzne posrednike" (28 Jan 2025)](https://www.monitor.si/clanek/furs-pozna-neobanke-in-spletne-borzne-posrednike/238067/).

## 6. Foreign tax, `ReliefStatement` and treaties

- **Tax rate.** Dividend income tax is 25%, final, and not part of the annual return. The rate was 27.5% for 2020–2021 and 25% again from 1.1.2022 (ZDoh-2Z). FURS issues the assessment decision by 30 April.
- **Credit cap.** Slovenia credits foreign tax only "po stopnji, določeni v mednarodni pogodbi", i.e. at the treaty rate (FURS treaty guide, section 8). There is a second cap (corrected after verification): the credited foreign tax may not exceed the Slovenian tax due under ZDoh-2 on that income (FURS brochure *Mednarodna obdavčitev posameznikov*; SI–US Art. 23(2), "shall in no case exceed that portion of the income tax … attributable").
  - SI–US convention (Ur. l. RS – MP 10/2001), Art. 10(2)(b): 15% for portfolio dividends. Art. 23(2): credit method.
  - If 30% US withholding was suffered, put the real `ForeignTax` in the record. FURS will cap the credit, and the excess has to be reclaimed in the US.
- **Evidence is part of the return** (corrected after verification). When the foreign tax credit is claimed, evidence of the foreign tax amount, its base, and that it is final and actually paid is an integral part of the return (Art. 137 ZDoh-2, Art. 273 ZDavP-2, per `doh_odm_div20.n.sl.pdf`). Without it, the credit can be denied.
- **`ReliefStatement`.** Official sources disagree:
  - The legal form and its instructions title the column "Uveljavljam oprostitev po mednarodni pogodbi (odstavek, člen)". You enter the paragraph and article of the treaty under which you claim **exemption**.
  - The eDavki UI help and CSV guide add a **100-character limit**. The UI help also says that filling `ReliefStatement` opens the Attachments section, where proof of foreign tax must be submitted (corrected after verification).
  - The **2026 XML guide and template** say "Vnesite DA/NE" and restrict the Excel cell to `DA`/`NE`.
  - The XSD is free `xs:string`.
  - Long-standing community practice (ib-edavki `relief-statements.xml`) is `"<MP gazette no.>, <paragraph> odstavek 10. člena"`, e.g. US `10/01, 2b odstavek 10. člena`, IE `25/02, 2b odstavek 10. člena`, DE `22/06, 2b odstavek 10. člena`. These returns are accepted.
- **Recommendation** (corrected after verification):
  - Every FURS description frames `ReliefStatement` as a claim to an **exemption** under a treaty. A Slovenian resident with US dividends gets a **credit** under Art. 23(2), not an exemption. Filling the field, with a treaty reference or with `DA`, may therefore be read as an exemption claim, and what FURS does with the value is an open question. The prior-art research recommends emitting it only on an explicit user choice, never by default ([05 §9](05-prior-art.md#9-gaps-lessons-and-what-our-project-should-do-differently)); TaxBrokerReport already leaves it empty unless a treaty exemption is claimed.
  - When it is emitted, make the format configurable (`treaty-ref` default ≤100 chars, or `DA`), and only when foreign tax > 0 and a treaty exists.
  - Generate the PDF of foreign-tax evidence that must be attached, e.g. the broker's dividend report. The attachment can be added after submission.
- Gazette numbers for every treaty in force come from MF's table `TABELA-veljavneKIDO-internet-maj-2025.pdf`. ib-edavki's `CH 15/97, 5/137` is a typo for `5/13`.

## 7. Deadlines and what changed

| Period | Rule | Source |
|---|---|---|
| ≤ TY2015 | Quarterly return, by the 15th of the month after the quarter | eDavki help `Documents_New_Doh_Div.htm` |
| TY2016 onward | **Annual, by 28 Feb of the next year** when the payer is not a Slovenian withholding agent ("oseba, ki ni plačnik davka") | Art. 326(1) ZDavP-2 as amended by ZDavP-2I (Ur. l. RS 91/2015). The amending law is medium confidence. |
| TY2024 | Due 28.2.2025 (Friday) | FURS public call 2025 |
| TY2025 | Due **2.3.2026**, because 28.2.2026 was a Saturday | FURS public call 2026 |
| TY2026 | Expected **1.3.2027**, because 28.2.2027 is a Sunday; next-working-day rule. Re-check against FURS's 2027 public call | inferred from the same practice |
| From 1.1.2026 | Art. 326(8) ZDavP-2: Doh-Obr, Doh-Div and deposit-interest returns must be filed electronically if there were **more than 5 payments** in the year | ZDavP-2P Art. 45, Ur. l. RS 100/2025. FURS instructions already required this earlier. |

Other points:

- **Who must file.** Residents and non-residents file whenever the payer is not a Slovenian withholding agent. This includes reinvested dividends (DRIP) and dividends in kind.
- **Fines.** €250–400 for late or incorrect filing (eDavki page).
- **No exceptions for small foreign dividends.** The €1,000 threshold applies only to SI/EU *deposit* interest.
- **INR.** The ZINR individual investment account is new (in force 2025, FURS services from 5.3.2026). Dividends earned *inside* an INR are not reported on Doh-Div; they are taxed on withdrawal.
- **Do not confuse with Art. 323** (corrected after verification). ZDavP-2P also amended Art. 323 ZDavP-2: the self-assessment deadline becomes "do 15. dne v mesecu za dohodke, dosežene v prejšnjem mesecu". That is a different procedure from the Doh-Div return.

## 8. Example Doh-Div (2 dividends) and validation

The BSI USD rates were taken from BSI's full-history file ([dtecbs-l.xml](https://www.bsi.si/_data/tecajnice/dtecbs-l.xml)) and match the ECB: 2026-05-14 = 1.1702, 2026-06-24 = 1.1340.

- **US dividend:** USD 26.00 gross with USD 3.90 (15%) withheld. 26.00/1.1702 = 22.22 and 3.90/1.1702 = 3.33.
- **Irish ETF:** USD 15.00 with 0 withheld. 15.00/1.1340 = 13.23.

```xml
<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd"
          xmlns:edp="http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd">
  <edp:Header>
    <edp:taxpayer><edp:taxNumber>12345678</edp:taxNumber><edp:taxpayerType>FO</edp:taxpayerType></edp:taxpayer>
    <edp:Workflow><edp:DocumentWorkflowID>O</edp:DocumentWorkflowID></edp:Workflow>
    <edp:domain>edavki.durs.si</edp:domain>
  </edp:Header>
  <edp:AttachmentList/>
  <edp:Signatures/>
  <body>
    <Doh_Div>
      <Period>2026</Period><EmailAddress>janez.novak@example.com</EmailAddress>
      <PhoneNumber>041123456</PhoneNumber><ResidentCountry>SI</ResidentCountry>
      <IsResident>true</IsResident><SelfReport>false</SelfReport><WfTypeU>false</WfTypeU>
    </Doh_Div>
    <Dividend>
      <Date>2026-05-14</Date>
      <PayerIdentificationNumber>94-2404110</PayerIdentificationNumber>
      <PayerName>Apple Inc.</PayerName>
      <PayerAddress>One Apple Park Way, Cupertino, CA 95014, United States</PayerAddress>
      <PayerCountry>US</PayerCountry>
      <Type>1</Type><Value>22.22</Value><ForeignTax>3.33</ForeignTax>
      <SourceCountry>US</SourceCountry>
      <ReliefStatement>10/01, 2b odstavek 10. člena</ReliefStatement>
    </Dividend>
    <Dividend>
      <Date>2026-06-24</Date>
      <PayerIdentificationNumber>499158</PayerIdentificationNumber>
      <PayerName>Vanguard Funds plc (Vanguard FTSE All-World UCITS ETF Dist)</PayerName>
      <PayerAddress>70 Sir John Rogerson's Quay, Dublin 2, Ireland</PayerAddress>
      <PayerCountry>IE</PayerCountry>
      <Type>4</Type><Value>13.23</Value><ForeignTax>0.00</ForeignTax>
      <SourceCountry>IE</SourceCountry>
    </Dividend>
  </body>
</Envelope>
```

The Apple and Vanguard IDs and the payment dates are illustrative; the IDs are not verified against official registers. The `ReliefStatement` line shows community practice only; read the caveat in §6 before emitting it (corrected after verification). The contact data is placeholder data.

**Validation:** `xmllint --noout --schema Doh_Div_3.xsd` on this example reports **validates** (libxml 2.9.13). The minimal Doh-Obr and D-IFI examples the researcher built also validate against `Doh_Obr_2.xsd` and `D_IFI_4.xsd`.

**What the XSD catches** (negative tests):

| Test | Result |
|---|---|
| `edp:bodyContent` added to the Doh-Div body | **fails** ("Expected is Doh_Div") |
| `Value` with 3 decimals | **fails** (fractionDigits) |
| `Value` placed before `Type` | **fails** (sequence) |
| `<Dividend>` nested inside `<Doh_Div>` | **fails** |
| `edp:Signatures` missing | **fails** |
| 7-digit `taxNumber` | **fails** (pattern) |
| `Doh_Div_2` namespace | **fails** |
| Negative `Value` | *passes* |
| `Type=99`, `SourceCountry=IRL` | *passes* |
| Doh-Obr without `edp:bodyContent` | **fails** |
| Doh-Obr `Country2` placed before `Type` | **fails** (the bug in ib-edavki issue #176) |

The verifier independently reproduced the "passes" rows: `Value` -13.23, `Type` 99 and `SourceCountry` IRL validate.

## 9. Business-rule validation the app must add

1. `Date` within `Period` and inside the tax year. eDavki enforces this, not the XSD; the FURS template only checks for a date after 1990 (corrected after verification).
2. `Value` > 0, at 2 decimals (ROUND_HALF_UP after converting from the foreign currency at the BSI rate of `Date`). If the date has no rate, use the last published rate. This report found that ib-edavki looks back up to 6 days; the BSI and prior-art research found up to 9 days in ib-edavki's main rate lookup, and a separate 6-step loop in its Doh-Obr generator ([03 §9](03-bsi-exchange-rates.md#9-weekends-holidays-and-target-closing-days), [05 §2.1](05-prior-art.md#21-ib-edavki-ibkr--all-four-forms)). The sources conflict; 03 recommends a 7-day cap.
3. `ForeignTax` ≥ 0 and ≤ `Value`. Emit `0.00` for foreign payers with no tax. Omit it for SI payers.
4. `Type` ∈ {1..7}.
5. Country codes must be in the FURS list, with `GR`→`EL`.
6. `PayerName`, `PayerAddress`, `PayerCountry` and `SourceCountry` must be non-empty.
7. `PayerTaxNumber` only when `PayerCountry`=SI.
8. Unique `(Date, PayerIdentificationNumber)`.
9. `ReliefStatement` ≤ 100 characters.
10. Drop zero or negative records. Net reversals with their originals first; IBKR "Payment in Lieu" on short positions is an example. Allocate withholding to the correct same-day dividend by matching descriptions (ib-edavki issue #42).
11. Write UTF-8 with an XML declaration, so č/š/ž survive.
12. Import via eDavki → Dokumenti → Uvoz. The imported document can be reviewed before signing. A test sandbox exists at `beta.edavki.durs.si`.
13. `edp:taxNumber` present, 8 digits; the XSD does not require it (corrected after verification).
14. Serialize with a real XML library rather than string templates; the FURS template escapes only `&` (corrected after verification).

## 10. Doh-Obr (interest), `Doh_Obr_2.xsd`

- **Root:** `body` = `edp:bodyContent` (required), then `Doh_Obr`, then optional `SubseqSubmissDecision` and `SubseqSubmissProposal`.
- **`Doh_Obr` sequence:** `SelfReport`, `WfTypeU`, `Notes`, `Period`, `DocumentWorkflowID` (here, not in the Header), `Email`, `TelephoneNumber`, `ResidentOfRepublicOfSlovenia`, `Country`, then **`Interest*` inside `Doh_Obr`**, then `Reduction?`, `Attachment*`, `CustodianNotes`, `CustodianSubmitDate`.
- **`Interest` sequence:**
  - `Date`
  - `TaxNumber` (`xs:int`)
  - `IdentificationNumber` (max 30)
  - `Name`, `Address`, `Country`
  - `Type`
  - `Value` and `ForeignTax`: pattern `\d{1,12}(\.\d{1,2})?`, so negative values are impossible
  - `Country2` (source country)
  - `ReliefStatement` (max 100)
- **`Type` codes:**

| Code | Meaning |
|---|---|
| 1 | loans |
| 2 | debt securities, including convertibles |
| 3 | deposits at banks **not** established in SI/EU |
| 4 | similar financial claims |
| 5 | finance lease |
| 6 | life insurance |
| 7 | investment-fund income distributed as interest |
| 8 | fees, discounts, bonuses, premiums taxed as interest |
| 9 | supplementary pension income |
| 10 | interest paid via a payer not obliged to withhold (official-duty returns only). The 2026 XML guide's taxpayer table omits this code; a taxpayer-generated Doh-Obr must never use it (corrected after verification) |
| 11 | asset-manager compensation |
| 12 | interest from assigned claims |

- **Same rules as Doh-Div:** 28 Feb (or next working day), electronic if more than 5 payments, BSI rate, duplicate-ID critical error.
- **Deposit interest** at SI or EU banks goes on a *different* form, filed only when the yearly total exceeds €1,000.
- ib-edavki codes IBKR "Broker Interest Received" as Type 2. This should be reviewed: type 3 or 4 may fit better (open question).

## 11. D-IFI (derivatives), `D_IFI_4.xsd`

- **Root:** `body` = `edp:bodyContent` (required), then `D_IFI`. `D_IFI` contains `PeriodStart`, `PeriodEnd`, `TelephoneNumber`, `Email`, `TItem*`, `Attachment*/Document` (max 70).
- **`DocumentWorkflowID`** moved to `edp:Header/edp:Workflow` in v4. In v3 it was inside `D_IFI`.
- **`TItem` (one inventory sheet per instrument):**
  - `TypeId` is required: `PLIFI` (long) or `PLIFIShort` (short).
  - `Type` pattern `0[1-4]`: 01 futures (terminska pogodba), 02 CFD (finančne pogodbe na razliko), 03 options and certificates (opcija in certifikat), 04 other (drugo).
  - Then `TypeName`, `Name`, `Code`, `ISIN`, `HasForeignTax`, `ForeignTax` (`\d{1,12}(\.\d{1,4})?`), `CountryId`, `CountryName`.
  - `ISIN` is optional but, when present, must be exactly 12 characters (corrected after verification). Most exchange-traded options and futures have no ISIN, so omit the element and identify the instrument with `Code`/`Name`; putting a ticker in `ISIN` fails validation.
  - Then a choice of `TSubItem*` or `TShortSubItem*`, so long and short sub-items cannot be mixed in one `TItem`.
- **`TSubItem` (long):**
  - `Purchase(F1 date, F2 acquisition code, F3 quantity 12.8, F4 unit cost 14.8, F9 leverage bool)`, or
  - `Sale(F5 date, F6 quantity, F7 unit value)`, all three required in Sale;
  - then `F8` running inventory, which may be negative (`[-]?\d{1,12}(\.\d{1,8})?`).
- **`TShortSubItem` (short):** `Sale(F1, F2, F3, F9)` or `Purchase(F4, F5 code, F6, F7)`, then `F8`.
- **Acquisition code mismatch:**
  - The paper form defines A nakup (purchase), B dedovanje (inheritance), C darilo (gift), D drugo (other).
  - The XSD enum annotations are copied from KDVP: A vložek kapitala, B nakup, … H.
  - ib-edavki uses **A** for purchases. Follow the form, but this is medium confidence: which meaning eDavki applies on import is unverified.
- **Other rules:**
  - The form asks for amounts in EUR to 4 decimals; the XSD allows 8.
  - FIFO inventory.
  - Only instruments acquired on or after 15.7.2008 are reported.
  - Deadline 28 Feb (2.3.2026 for TY2025). Electronic filing if more than 10 transactions.
  - Foreign tax is claimed per instrument (form point 4).

## Verification

An independent verifier re-downloaded the XSDs, FURS guides and templates, the public call, ZDavP-2P, the SI–US treaty and the ib-edavki sources, and re-ran the key xmllint tests. All 22 critical claims were confirmed.

**Added after verification (2026-10-11):** §5.1, on who the payer is for a dividend a foreign broker passes on (#44), was written later from the primary sources it lists and has not been independently verified. It rests on these texts:

- ZDoh-2 NPB 36, art. 90, and ZDavP-2 NPB 32, arts. 58 and 325, read in PISRS's own files;
- the Doh-Div form instructions, XML guide, CSV guide, legal form and the 2014 UI help;
- the FURS opis, §3.3 and Q&A 6.2 Q7.

Its answer is "not found". The statutory term *plačnik* in art. 90(2) is the company (high confidence), but no FURS text says that the form's *izplačevalec* means it, or whether a broker may be entered. The same day, the §5 payer bullet and the Open questions entry were pointed to §5.1.

**Claims not confirmed:** none.

**Missed items** (facts the verifier found that the report lacked; each is applied inline where noted):

- **`ReliefStatement` is framed as an exemption claim.** The form, UI help and CSV guide all describe it as the treaty article under which a resident claims exemption ("oprostitev plačila dohodnine"), while a resident with US dividends gets a credit (Art. 23(2)). Filling it opens the Attachments section where proof of foreign tax must be submitted, and may be read as a claim. Flag this, and treat what FURS does with the value as an open question. Applied in §6 and §8.
- **The credit has a second cap:** the foreign tax credited may not exceed the Slovenian tax due under ZDoh-2 (FURS brochure *Mednarodna obdavčitev posameznikov*; SI–US Art. 23(2)). Applied in §1 and §6.
- **Attach evidence.** When claiming the credit, evidence of the foreign tax amount, its base, and that it is final and actually paid is an integral part of the return (Art. 137 ZDoh-2, Art. 273 ZDavP-2); without it the credit can be denied. Applied in §6.
- **FURS documents conflict on mandatory fields.** `PayerIdentificationNumber`: XML guide mandatory for foreign payers, CSV guide only for several same-day payments from one payer, form instructions not mandatory. `ForeignTax`: XML guide mandatory for non-SI payers, UI help optional. Always emit the ID for foreign payers. Applied in §3.4.
- **Use a real XML serializer.** The FURS template escapes only `&`, not `<`, `>` or quotes in `PayerName`/`PayerAddress`. Applied in §3.4 and §9.
- **Header element order is significant:** `taxpayer`, `responseTo?`, `Workflow?`, `CustodianInfo?`, `domain?`; inside `taxpayer` the `taxNumber`/`vatNumber` choice comes first. The Doh-Div template emits an empty `<edp:DocumentWorkflowName/>`; the Doh-Obr template has no `edp:Workflow`. Applied in §3.2.
- **Doh-Obr numeric types:** `TaxNumber` is `xs:int`, so it must be numeric, and `Value` is restricted by pattern to non-negative values with at most 2 decimals. Already stated in §10.
- **D-IFI `ISIN`, if present, must be exactly 12 characters.** Omit it for options and futures without an ISIN and use `Code`/`Name`; a ticker in `ISIN` fails validation. Applied in §11.
- **`Date` within `Period` is an eDavki rule.** The XSD does not check it, and the FURS template only requires a date after 1990 (Excel serial 32874). Applied in §9.
- **Return of Capital is unresolved.** In ib-edavki #42, FURS's correction table kept a same-day "Return of Capital" as a separate record with no foreign tax. Whether such a payment is a dividend under Art. 90 ZDoh-2 at all, or reduces acquisition cost, is open. Applied in §5 and Open questions.
- **Never use Doh-Obr interest code 10** in a taxpayer-generated return; the 2026 XML guide's taxpayer table omits it (ex-officio returns only). Applied in §10.
- **Art. 323 changed too.** ZDavP-2P set the self-assessment deadline to "do 15. dne v mesecu za dohodke, dosežene v prejšnjem mesecu". It is not the Doh-Div deadline. Applied in §7.

**Qualifications on confirmed claims** (verifier notes that refine a confirmed claim):

- *Schemas (§1, §2):* `Doh_Div_3` returned HTTP 200 and `Doh_Div_4`, `Doh_Obr_3`, `D_IFI_5` returned 404 on 2026-10-07. The template's `Last-Modified` is Tue, 10 Feb 2026 11:28:30 GMT, and its XML sheet emits the `Doh_Div_3` and `EDP-Common-1` namespaces.
- *Body order (§3.1):* adding `<edp:bodyContent/>` fails with "Expected is Doh_Div"; omitting `edp:Signatures` fails.
- *Doh-Obr (§10):* FURS's Doh-Obr Excel template (`doh_odm_obr_xml.i.xlsx`) emits `<body><edp:bodyContent/><Doh_Obr>…<DocumentWorkflowID>O</DocumentWorkflowID>` and no `edp:Workflow` in the header.
- *Type codes (§4.1):* the 2026 XML guide (PDF created 2026-02-04) and `doh_odm_div20.n.sl.pdf` (2026-03-30) match; the template's Šifranti D5:D11 = 1..7 validates column G.
- *Duplicate IDs (§5):* the CSV guide's wording is about the same foreign payer on the same day; sequential numbers replace the real ID. Applied inline.
- *One record per payment (§5):* the FURS email is quoted in a community issue, so medium confidence stays. Applied inline (Barrick details).
- *Quarterly until 2015 (§7):* the eDavki help page is a primary source ("Obdobje je v letih do vključno leta 2015 trimesečno, za leto 2016 in novejša pa letno …"), so this can be treated as high confidence.
- *ZDavP-2P (§7):* Article 45 adds paragraph (8) to Art. 326; Article 64 sets entry into force on 1 January 2026; published in Ur. l. RS 100/2025 of 4.12.2025.
- *TY2026 deadline (§7):* 1.3.2027 is an inference; FURS has not yet published the 2027 public call, so re-check in January 2027.
- *Dividend rate (§6):* the FURS guide calls it a final tax ("dokončen davek", Art. 132(1) ZDoh-2).
- *Country codes (§4.3):* ISIN prefixes such as XS, EU or KY do not reliably give the source country. Applied inline.
- *D-IFI codes (§11):* the form legend and the copied XSD annotations are both confirmed; which meaning eDavki applies on import remains unverified.
- *12-character limit (§5):* the 2025 statement is in issue #163, and ib-edavki truncates only when the ID is longer than 12. Applied inline.

## Open questions

- Who the payer is for dividends a foreign broker pays out: the company, or the broker, as one eDavki record of Trading 212 dividends shows (§5)? No FURS text found; primary sources searched on 2026-10-11 (§5.1). ZDoh-2 art. 90(2) calls the company the dividend's *plačnik*, but the form's *izplačevalec* is not defined anywhere found. A draft written question to FURS, in Slovenian and English, is in §5.1. Tracked in #44.
- Should `ReliefStatement` contain a treaty reference (`10/01, 2b odstavek 10. člena`), `DA`/`NE` (as FURS's 2026 XML guide and template say), or nothing? And does FURS's credit computation depend on it at all, or only on `ForeignTax` plus attached evidence? (The verifier adds that every FURS description frames it as an exemption claim; §6.)
- What are the exact semantics of the `Doh_Div` elements `SelfReport`, `WfTypeU` and `Locked`, and which `DocumentWorkflowID` values (beyond O and P; older help lists I, B, R) does the eDavki XML import accept?
- Does eDavki still truncate or drop `PayerIdentificationNumber` values longer than 12 characters on submission? It was reported in 2023 and reported fixed in 2025.
- Is the duplicate `(Date, PayerIdentificationNumber)` critical error keyed only on those two fields, or also on `Type` or `Value`? Is substituting sequential numbers for the real ID still FURS's recommended workaround in 2026?
- Does eDavki reject `GR` for Greece, or silently accept it? The FURS template code list only contains `EL`.
- Should IBKR/Trading 212-style broker credit interest go on Doh-Obr as Type 2 (ib-edavki's choice), 3 or 4? And when is it instead deposit interest at an EU bank, which goes on the separate deposit form with the €1,000 threshold? ([04 §8](04-si-tax-rules.md#8-interest), verified: IBKR and eToro interest goes on Doh-Obr with no allowance (FURS Q20, Q24); Trade Republic interest from 6 Dec 2023 is EU-bank deposit interest; Trading 212 cash interest is not addressed by FURS. The `Type` code remains open.)
- Confirm that the TY2026 deadline will be Monday 1 March 2027 (28 Feb 2027 is a Sunday) once FURS publishes its 2027 public call.
- Exact Irish/Vanguard and other fund payer identifiers to ship in a companies database: CRO number vs Irish tax reference vs LEI.

Also raised in the report body and during verification:

- Does eDavki accept `Type=1` for ETF distributions without reclassifying them? There is no tax effect.
- Is a broker "Return of Capital" a dividend under Art. 90 ZDoh-2, or does it reduce the acquisition cost instead?
- May several broker rows that are fragments of one corporate payment (per position or per lot) be merged into one `Dividend`, or must each row stay separate, with sequential IDs to avoid the duplicate-key error? (§5; sources conflict.)

## Sources

- [FURS XSD Doh_Div_3.xsd](https://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd)
- [FURS XSD EDP-Common-1.xsd](https://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd)
- [FURS XSD Doh_Obr_2.xsd](https://edavki.durs.si/Documents/Schemas/Doh_Obr_2.xsd)
- [FURS XSD D_IFI_4.xsd](https://edavki.durs.si/Documents/Schemas/D_IFI_4.xsd)
- [Navodilo za pripravo in uvoz dokumenta (XML) v napoved za odmero dohodnine od dividend (2026)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.n.sl.pdf)
- [FURS Excel template XML-Doh-Div](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_xml.i.xlsx)
- [FURS CSV instructions Doh-Div (docx)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_csv.n.docx)
- [FURS CSV template Doh-Div](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div_csv.i.xlsx)
- [Navodilo za izpolnjevanje obrazca Doh-Div (current)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.n.sl.pdf)
- [Navodilo za izpolnjevanje obrazca Doh-Div (2020, 2021, 2023+; Types 1-7, point 6)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div20.n.sl.pdf)
- [Obrazec DOHKAP št. 3 (Uradni list RS 43/2022)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_div.i.sl.pdf)
- [eDavki - Napoved dohodnine od dividend (landing page)](https://edavki.durs.si/edavkiportal/openportal/CommonPages/Opdynp/PageD.aspx?category=odmera_dohodnine_od_dividend)
- [eDavki help: Doh-Div (periods: quarterly until 2015, annual from 2016)](https://edavki.durs.si/EdavkiPortal/PersonalPortal/%5B360253%5D/Pages/Help/sl/Documents_New_Doh_Div.htm)
- [eDavki: Navodilo za izpolnjevanje napovedi za odmero dohodnine od dividend (UI help, 100-char ReliefStatement)](https://edavki.durs.si/OpenPortal/Doc/Durs/Dohodnina/NavodiloZaNapovedDiv.html)
- [FURS: Obresti, dividende, dobiček iz kapitala in dohodek z INR (guide, 2026)](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Dohodnina/Dohodek_iz_kapitala/Opis/Obresti_dividende_in_dobicek_iz_kapitala.doc)
- [FURS: Izvajanje mednarodnih pogodb o izogibanju dvojnega obdavčevanja](https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Mednarodno_obdavcenje/Opis/Izvajanje_mednarodnih_pogodb_o_izogibanju_dvojnega_obdavcevanja_dohodka_in_premozenja.docx)
- [FURS Javni poziv - rok 2.3.2026 (TY2025)](https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2026/Javni-poziv-rok-je-2.3.2026.pdf)
- [FURS Javni poziv - rok 28.2.2025 (TY2024)](https://www.gov.si/assets/organi-v-sestavi/FURS/Novice-2025/Javni-poziv-rok-je-28.-2.-2025.pdf)
- [GOV.SI news 13.2.2026: napovedi oddajte do 2. marca 2026](https://www.gov.si/novice/2026-02-13-obresti-dobicek-iz-kapitala-dividende-najemnine-ifi-napovedi-oddajte-do-2-marca-2026/)
- [ZDavP-2P, Uradni list RS 100/2025](https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3396)
- [ZDavP-2 Art. 326 (Način in rok vložitve napovedi)](https://zakonodaja.com/zakon/zdavp-2/326-clen-nacin-in-rok-vlozitve-napovedi)
- [PISRS - ZDoh-2 consolidated text file, NPB 36](https://pisrs.si/api/datoteke/integracije/358727637) (art. 90; read for §5.1)
- [PISRS - ZDavP-2 consolidated text file, NPB 32](https://pisrs.si/api/datoteke/integracije/594731150) (arts. 58 and 325; read for §5.1)
- [FURS - Prejel sem dividende (life event, refreshed 14 Apr 2025)](https://www.fu.gov.si/zivljenjski_dogodki_prebivalci/prejel_sem_dividende/) (read for §5.1)
- [e-uprava - Obdavčitev dividend](https://e-uprava.gov.si/si/podrocja/davki/dohodek-iz-kapitala/obdavcitev-dividend.html) (read for §5.1)
- [Monitor - Furs pozna neobanke in spletne borzne posrednike (28 Jan 2025)](https://www.monitor.si/clanek/furs-pozna-neobanke-in-spletne-borzne-posrednike/238067/) (secondary; §5.1)
- [data.si: annual Doh-Div/Doh-Obr since 2016 (ZDavP-2I)](https://data.si/blog/napoved-za-odmero-dohodnine-od-dividend-in-obresti-se-10-dni-casa/)
- [Konvencija SI-ZDA (BUSIDO), Uradni list RS - MP 10/2001](https://www.uradni-list.si/_pdf/2001/Mp/m2001035.pdf)
- [MF: Seznam veljavnih KIDO (maj 2025)](https://www.gov.si/assets/ministrstva/MF/Davcni-direktorat/KIDO-2025/TABELA-veljavneKIDO-internet-maj-2025.pdf)
- [FURS XML instructions Doh-Obr](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_obr_xml.n.sl.pdf)
- [FURS CSV instructions Doh-Obr](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_obr_csv.n.docx)
- [D-IFI form (DOBIFI št. 1)](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_ifi_20.i.sl.pdf)
- [D-IFI instructions](https://edavki.durs.si/OpenPortal/Dokumenti/doh_odm_ifi_20.n.sl.pdf)
- [ib-edavki source (ib_edavki.py)](https://github.com/ib-edavki/ib-edavki/blob/master/ib_edavki.py)
- [ib-edavki relief-statements.xml](https://github.com/ib-edavki/ib-edavki/blob/master/relief-statements.xml)
- [ib-edavki issue #42 (no summing of same-day dividends)](https://github.com/ib-edavki/ib-edavki/issues/42)
- [ib-edavki issue #86 (12-char ID truncation)](https://github.com/ib-edavki/ib-edavki/issues/86)
- [ib-edavki issue #163 (payer identification numbers)](https://github.com/ib-edavki/ib-edavki/issues/163)
- [ib-edavki issue #176 (Doh-Obr element order)](https://github.com/ib-edavki/ib-edavki/issues/176)
- [Banka Slovenije exchange rates XML (dtecbs-l.xml)](https://www.bsi.si/_data/tecajnice/dtecbs-l.xml)
- [ECB data API EXR USD](https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A)

Also cited during verification (no public URL was recorded): FURS brochure *Mednarodna obdavčitev posameznikov*; FURS Doh-Obr Excel template `doh_odm_obr_xml.i.xlsx`.
