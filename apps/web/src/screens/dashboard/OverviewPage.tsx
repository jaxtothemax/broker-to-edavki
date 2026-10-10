/**
 * The dashboard's first page (#47): one headline, the tax to pay for the
 * year as an estimate, with the two returns it comes from beside it; the
 * returns to download; and a card for each page that holds the rows behind
 * them. Every amount comes from the preview; none is computed here.
 */
import { ArrowRightIcon, InfoIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { explain } from "../../explain/anchors";
import { formatNumber, plural } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import { HOLDING_BUCKETS, type ReturnPreview } from "../../model/preview";
import { bucketLabel, Eur } from "../../ui/bits";
import { CompareBars, StackBar } from "../../ui/charts";
import { Amount, Button, Chip } from "../../ui/kit";
import { ReturnsCard } from "./ReturnsCard";
import type { DashPage } from "./view";
import type { Writing } from "./writing";

/** The headline: both estimates together, each part named beside it. */
function TaxCard({
  preview,
  withheld,
}: {
  readonly preview: ReturnPreview;
  readonly withheld: readonly string[];
}) {
  const { locale, t } = useI18n();
  const gains = preview.gainsEstimate;
  const buckets = HOLDING_BUCKETS.filter(
    (b) => gains.allocatedByBucket[b] !== "0.00",
  );
  return (
    <div className="card stat-card tax-card" {...explain("summary.tax")}>
      <div className="stat-head">
        <p className="stat-label">{t.dash.taxToPay(String(preview.taxYear))}</p>
        <Chip explain={explain("summary.estimateChip")}>
          {t.review.estimateChip}
        </Chip>
      </div>
      <Amount value={preview.taxToPayEur} size="xl" />
      {/* An estimate stands without its return, but may change with it. */}
      {withheld.map((form) => (
        <p key={form} className="muted small">
          {t.dash.partWithheld(form)}
        </p>
      ))}
      <dl className="kv">
        <div>
          <dt>{t.dash.onGains}</dt>
          <dd>
            <Eur value={gains.taxEur} strong />
          </dd>
        </div>
        <div>
          <dt>{t.dash.onDividends}</dt>
          <dd>
            <Eur value={preview.dividendsEstimate.taxDueEur} strong />
          </dd>
        </div>
        {gains.lossesEur === "0.00" ? null : (
          <div>
            <dt>{t.review.losses}</dt>
            <dd>
              <Eur value={gains.lossesEur} signed />
            </dd>
          </div>
        )}
        <div {...explain("summary.netBase")}>
          <dt>{t.review.netBase}</dt>
          <dd>
            <Eur value={gains.netBaseEur} />
          </dd>
        </div>
      </dl>
      <div className="stat-chart" {...explain("summary.buckets")}>
        <p className="mini-title">{t.review.bucketsTitle}</p>
        <StackBar
          segments={buckets.map((b) => ({
            key: b,
            label: t.review.allocatedBucket(bucketLabel(b, locale)),
            value: gains.allocatedByBucket[b],
          }))}
        />
      </div>
    </div>
  );
}

function GainLossCard({ preview }: { readonly preview: ReturnPreview }) {
  const { locale, t } = useI18n();
  return (
    <div className="card stat-card">
      <div className="stat-head">
        <p className="stat-label">{t.review.colGain}</p>
      </div>
      <Amount value={preview.gainsTotals.gainEur} size="lg" signed />
      <CompareBars
        rows={[
          {
            key: "proceeds",
            label: t.review.colProceeds,
            value: preview.gainsTotals.proceedsEur,
          },
          {
            key: "cost",
            label: t.review.colCost,
            value: preview.gainsTotals.costEur,
          },
        ]}
      />
      <dl className="kv">
        <div>
          <dt>{t.review.salesLabel}</dt>
          <dd className="num strong">
            {formatNumber(String(preview.securities.length), locale)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** A page's summary that opens the page: the whole card is its button. */
function DrillCard({
  title,
  figure,
  detail,
  action,
  onOpen,
}: {
  readonly title: string;
  readonly figure: ReactNode;
  readonly detail: string;
  readonly action: string;
  readonly onOpen: () => void;
}) {
  return (
    <div className="card drill-card">
      <h3>{title}</h3>
      <div className="drill-figure">{figure}</div>
      <p className="muted small">{detail}</p>
      <Button variant="ghost" size="sm" className="drill-open" onClick={onOpen}>
        {action}
        <ArrowRightIcon size={16} weight="bold" aria-hidden />
      </Button>
    </div>
  );
}

export function OverviewPage({
  preview,
  writing,
  demo,
  withheld,
  onNavigate,
}: {
  readonly preview: ReturnPreview;
  readonly writing: Writing;
  readonly demo: boolean;
  /** The names of the returns a note withholds. */
  readonly withheld: readonly string[];
  readonly onNavigate: (page: DashPage) => void;
}) {
  const { locale, t } = useI18n();
  const notes = preview.findings.length + preview.omittedFindings;
  return (
    <>
      <div className="overview-stats">
        <TaxCard preview={preview} withheld={withheld} />
        <GainLossCard preview={preview} />
      </div>
      <p className="with-icon muted small">
        <InfoIcon size={16} weight="bold" aria-hidden />
        {t.review.estimateNote}
      </p>

      <ReturnsCard
        preview={preview}
        writing={writing}
        demo={demo}
        onShowNotes={() => {
          onNavigate("notes");
        }}
      />

      <section className="drill-section" aria-labelledby="drill-title">
        <h2 id="drill-title" className="section-title">
          {t.dash.drillTitle}
        </h2>
        <div className="drill-grid">
          <DrillCard
            title={t.dash.gains}
            figure={
              <Amount value={preview.gainsTotals.gainEur} size="md" signed />
            }
            detail={plural(
              preview.securities.length,
              locale,
              t.dash.countGains,
            )}
            action={t.dash.viewGains}
            onOpen={() => {
              onNavigate("gains");
            }}
          />
          <DrillCard
            title={t.dash.dividends}
            figure={
              <Amount value={preview.dividendsEstimate.grossEur} size="md" />
            }
            detail={plural(
              preview.dividends.length,
              locale,
              t.dash.countDividends,
            )}
            action={t.dash.viewDividends}
            onOpen={() => {
              onNavigate("dividends");
            }}
          />
          <DrillCard
            title={t.dash.notes}
            figure={
              <span className="drill-count num">
                {formatNumber(String(notes), locale)}
              </span>
            }
            detail={
              notes === 0
                ? t.dash.noNotes
                : plural(notes, locale, t.dash.countNotes)
            }
            action={t.dash.viewNotes}
            onOpen={() => {
              onNavigate("notes");
            }}
          />
        </div>
      </section>
    </>
  );
}
