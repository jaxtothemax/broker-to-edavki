/**
 * The results dashboard (#47): where the flow ends once the files and the
 * details are in. A sidebar leads to the overview (the tax to pay, the
 * returns to download) and to a page for each part behind it: the gains,
 * the dividends and the notes. A note that stops a return withholds that
 * return only, and never hides the dashboard (ADR 0018 §6). With the
 * user's own files the engine prepares the returns when the dashboard
 * opens, so until then it says it is working.
 *
 * Which page shows and which securities are open is held by the caller
 * (`DashboardView`), so the guided tour can show a page or a row of its own
 * and leave the user's choice untouched underneath (ADR 0016).
 */
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CoinsIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  SignpostIcon,
  SquaresFourIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { FormOutput } from "../../engine/protocol";
import { formatPercent, formatNumber, plural } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type { Messages } from "../../i18n/messages";
import type { ReturnPreview } from "../../model/preview";
import { TAX_YEAR } from "../../state/wizard";
import { AppShell, SideNav, type NavEntry } from "../../ui/AppShell";
import { Main } from "../../ui/AppChrome";
import { DemoBanner, Eur, TOUR_BUTTON_ID } from "../../ui/bits";
import { MonthBars, StackBar } from "../../ui/charts";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
import { Amount, Button, Chip, Note } from "../../ui/kit";
import { DividendsPanel } from "../review/DividendsPanel";
import { GainsPanel } from "../review/GainsPanel";
import { NotesPanel } from "../review/NotesPanel";
import { OverviewPage } from "./OverviewPage";
import { neededForms, RETURNS_TITLE } from "./ReturnsCard";
import { DASH_PAGES, type DashboardView, type DashPage } from "./view";
import { useReturnsWriting, type ReturnsSource } from "./writing";

/** The note the navigation points at while it has nothing to show. */
const STATUS = "dash-status";

export function EmptyResults({
  onStartDemo,
}: {
  readonly onStartDemo: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card empty-card">
      <span className="icon-tile" aria-hidden>
        <MagnifyingGlassIcon size={22} weight="bold" />
      </span>
      <h2>{t.review.emptyTitle}</h2>
      <p className="muted" id={STATUS}>
        {t.review.emptyBody}
      </p>
      <Button variant="primary" size="lg" onClick={onStartDemo}>
        {t.start.primaryCta}
        <ArrowRightIcon size={18} weight="bold" aria-hidden />
      </Button>
    </div>
  );
}

/**
 * What a blocking note stops. A return the year does not need is not
 * "the other return": with one needed and withheld, there is no other to
 * download (#54 can withhold one return alone).
 */
function blockedText(
  forms: { readonly kdvp: FormOutput; readonly div: FormOutput } | null,
  t: Messages,
): string {
  if (forms === null) return t.review.blocked;
  const withheld = (form: FormOutput) => form.needed && form.xml === null;
  const kdvp = withheld(forms.kdvp);
  const div = withheld(forms.div);
  if (kdvp === div) return t.review.blocked;
  const [stopped, other] = kdvp
    ? [t.download.kdvpTitle, forms.div]
    : [t.download.divTitle, forms.kdvp];
  return other.needed
    ? t.review.blockedOne(stopped)
    : t.review.blockedOnly(stopped);
}

function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lead?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1}>{title}</h1>
        {lead === undefined ? null : <p className="lead">{lead}</p>}
      </div>
      {actions === undefined ? null : (
        <div className="page-head-actions">{actions}</div>
      )}
    </header>
  );
}

/** The two dividend figures, above the payments on their page. */
function DividendStats({ preview }: { readonly preview: ReturnPreview }) {
  const { locale, t } = useI18n();
  const dividends = preview.dividendsEstimate;
  return (
    <div className="bento">
      <div className="card stat-card span-7">
        <div className="stat-head">
          <p className="stat-label">{t.review.dividendsLabel}</p>
        </div>
        <Amount value={dividends.grossEur} size="lg" />
        <div className="stat-chart">
          <p className="mini-title">{t.review.byMonthTitle}</p>
          <MonthBars months={preview.dividendsByMonth} />
        </div>
      </div>
      <div className="card stat-card span-5">
        <div className="stat-head">
          <p className="stat-label">{t.review.dividendsTaxLabel}</p>
          <Chip>{t.review.estimateChip}</Chip>
        </div>
        <Amount value={dividends.taxDueEur} size="lg" />
        {/* Per payment, the tax due is 25% of the gross minus the
            credited foreign tax, so the two shares make up the 25%. */}
        <div className="stat-chart">
          <p className="mini-title">
            {t.review.dividendSplitTitle(
              formatPercent(dividends.taxRate, locale),
            )}
          </p>
          <StackBar
            segments={[
              {
                key: "credit",
                label: t.review.creditLabel,
                value: dividends.creditEur,
              },
              {
                key: "due",
                label: t.review.stillDue,
                value: dividends.taxDueEur,
              },
            ]}
          />
        </div>
        <dl className="kv">
          <div>
            <dt>{t.review.colForeignTax}</dt>
            <dd>
              <Eur value={dividends.foreignTaxEur} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

interface ShellProps {
  readonly preview: ReturnPreview | null;
  /** Where the engine stands with the user's own files. */
  readonly status: "ready" | "preparing" | "failed";
  /** The names of the files read, by their position in the request. */
  readonly fileNames: readonly string[];
  /** Each return as written, for the user's own files; null in the demo. */
  readonly forms: {
    readonly kdvp: FormOutput;
    readonly div: FormOutput;
  } | null;
  /**
   * The returns to download: written already (the user's own, with the
   * preview), a writer to await (the demo's), or null until prepared.
   */
  readonly returns: ReturnsSource | null;
  /** Whether these are the demo's files, which must never be imported. */
  readonly demo: boolean;
  readonly view: DashboardView;
  readonly onViewChange: (view: DashboardView) => void;
  readonly onBack: () => void;
  readonly onRestart: () => void;
  /** Replays the guided tour; the demo only. */
  readonly onTour?: () => void;
  readonly onStartDemo: () => void;
}

export function DashboardShell({
  preview,
  status,
  fileNames,
  forms,
  returns,
  demo,
  view,
  onViewChange,
  onBack,
  onRestart,
  onTour,
  onStartDemo,
}: ShellProps) {
  // The writer runs here, above the pages, so a change of page never
  // writes the returns again; and the dashboard stays one component while
  // own files are prepared, so nothing it shows is mounted twice.
  const written = useReturnsWriting(
    preview !== null && status === "ready" ? returns : null,
  );
  const writing =
    preview !== null && status === "ready" && returns !== null ? written : null;
  const { locale, t } = useI18n();
  // What the pages need, once there is something to show.
  const live =
    preview !== null && status === "ready" && writing !== null
      ? { preview, writing }
      : null;
  const ready = live !== null;
  // The returns a note withholds, named under the headline it is part of.
  const withheldForms =
    forms === null
      ? []
      : [
          ...(forms.kdvp.needed && forms.kdvp.xml === null
            ? [t.download.kdvpTitle]
            : []),
          ...(forms.div.needed && forms.div.xml === null
            ? [t.download.divTitle]
            : []),
        ];
  const page: DashPage = ready ? view.page : "overview";
  const year = String(preview?.taxYear ?? TAX_YEAR);
  const navigate = (next: DashPage) => {
    onViewChange({ ...view, page: next });
  };
  const setOpen = (isin: string, open: boolean) => {
    if (view.sold.has(isin) === open) return;
    const next = new Set(view.sold);
    if (open) next.add(isin);
    else next.delete(isin);
    onViewChange({ ...view, sold: next });
  };

  const notes = preview?.findings ?? [];
  const noteCount = notes.length + (preview?.omittedFindings ?? 0);
  const blocking = notes.filter((d) => d.severity === "blocking").length;
  const needAttention = notes.filter((d) => d.severity !== "info").length;
  const count = (n: number) => formatNumber(String(n), locale);
  const items: NavEntry<DashPage>[] = [
    {
      id: "overview",
      icon: <SquaresFourIcon size={20} weight="bold" />,
      label: t.dash.overview,
    },
    {
      id: "gains",
      icon: <TrendUpIcon size={20} weight="bold" />,
      label: t.dash.gains,
      count: count(preview?.securities.length ?? 0),
      countLabel: plural(
        preview?.securities.length ?? 0,
        locale,
        t.dash.countGains,
      ),
    },
    {
      id: "dividends",
      icon: <CoinsIcon size={20} weight="bold" />,
      label: t.dash.dividends,
      count: count(preview?.dividends.length ?? 0),
      countLabel: plural(
        preview?.dividends.length ?? 0,
        locale,
        t.dash.countDividends,
      ),
    },
    {
      id: "notes",
      icon: <NotePencilIcon size={20} weight="bold" />,
      label: t.dash.notes,
      count: count(noteCount),
      // The mark on the rail says it in color; the name says it in words.
      countLabel:
        needAttention === 0
          ? plural(noteCount, locale, t.dash.countNotes)
          : `${plural(noteCount, locale, t.dash.countNotes)}, ${plural(needAttention, locale, t.dash.countAttention)}`,
      ...(needAttention === 0
        ? {}
        : { tone: blocking > 0 ? ("danger" as const) : ("warn" as const) }),
    },
  ];

  const tourButton =
    demo && onTour !== undefined ? (
      <Button id={TOUR_BUTTON_ID} variant="ghost" onClick={onTour}>
        <SignpostIcon size={18} weight="bold" aria-hidden />
        {t.tour.action}
      </Button>
    ) : null;
  // Offered while a return is being written or can be saved: not when
  // there is nothing to file, nor when every return the year needs is
  // withheld, as the button would lead to nothing to download.
  const needed = live === null ? [] : neededForms(live.preview, live.writing);
  const canDownload =
    live !== null &&
    page === "overview" &&
    needed.length > 0 &&
    (live.writing.status !== "ready" ||
      needed.some(
        (form) =>
          live.writing.status === "ready" &&
          live.writing.returns[form].xml !== null,
      ));
  const actions =
    tourButton === null && !canDownload ? undefined : (
      <>
        {tourButton}
        {canDownload ? (
          <Button
            variant="primary"
            onClick={() => {
              const target = document.getElementById(RETURNS_TITLE);
              target?.scrollIntoView({ block: "start" });
              target?.focus({ preventScroll: true });
            }}
          >
            <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
            {t.dash.downloadAll}
          </Button>
        ) : null}
      </>
    );

  const attention =
    !ready || needAttention === 0 || page === "notes" ? null : (
      <Note
        tone={blocking > 0 ? "danger" : "warn"}
        id="dash-attention"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigate("notes");
            }}
          >
            {t.review.showNotes}
          </Button>
        }
      >
        {plural(needAttention, locale, t.review.attention)}
        {blocking > 0 ? ` ${blockedText(forms, t)}` : ""}
      </Note>
    );

  const side = (
    <>
      <Button variant="ghost" onClick={onBack} title={t.dash.backToDetails}>
        <ArrowLeftIcon size={18} weight="bold" aria-hidden />
        <span className="side-action-label">{t.dash.backToDetails}</span>
      </Button>
      <Button variant="ghost" onClick={onRestart} title={t.download.startOver}>
        <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
        <span className="side-action-label">{t.download.startOver}</span>
      </Button>
    </>
  );

  const head = (
    <PageHeader
      eyebrow={
        page === "overview"
          ? t.dash.eyebrowEstimate(year)
          : t.dash.eyebrowYear(year)
      }
      title={t.dash[page]}
      {...(page === "gains"
        ? { lead: t.dash.gainsLead }
        : page === "dividends"
          ? { lead: t.dash.dividendsLead }
          : page === "notes"
            ? { lead: t.dash.notesLead }
            : {})}
      actions={actions}
    />
  );

  // Every page stays rendered, the others hidden, as tabs keep their
  // panels: moving between pages, or through the tour, keeps each page's
  // tables scrolled where the user left them.
  const pageBody = (shown: DashPage, at: NonNullable<typeof live>) => {
    switch (shown) {
      case "gains":
        return (
          <GainsPanel
            securities={at.preview.securities}
            estimate={at.preview.gainsEstimate}
            open={view.sold}
            onToggle={setOpen}
          />
        );
      case "dividends":
        return (
          <>
            <DividendStats preview={at.preview} />
            <DividendsPanel
              dividends={at.preview.dividends}
              totals={at.preview.dividendsEstimate}
            />
          </>
        );
      case "notes":
        return (
          <NotesPanel
            findings={at.preview.findings}
            omitted={at.preview.omittedFindings}
            symbols={at.preview.symbols}
            fileNames={fileNames}
          />
        );
      case "overview":
        return (
          <>
            <OverviewPage
              preview={at.preview}
              writing={at.writing}
              demo={demo}
              withheld={withheldForms}
              onNavigate={navigate}
            />
          </>
        );
    }
  };

  const crashed = (
    <Note tone="danger" role="alert">
      {t.app.crashed}
    </Note>
  );

  // Keyed by state, so a failure mounts a new alert rather than turning
  // the status into one.
  let body: ReactNode;
  if (status === "preparing") {
    body = (
      <Note key="preparing" tone="neutral" role="status" id={STATUS}>
        {t.review.preparing}
      </Note>
    );
  } else if (status === "failed") {
    body = (
      <Note key="failed" tone="danger" role="alert" id={STATUS}>
        {t.review.prepareFailed}
      </Note>
    );
  } else if (live === null) {
    body = <EmptyResults onStartDemo={onStartDemo} />;
  } else {
    body = DASH_PAGES.map((shown) => (
      <div key={shown} className="dash-page" hidden={shown !== page}>
        {/* One boundary a page: a page that fails to render, shown or
            hidden, leaves the others, the downloads and the user's files
            in place. */}
        <ErrorBoundary resetKey={`dashboard-page:${shown}`} fallback={crashed}>
          {pageBody(shown, live)}
        </ErrorBoundary>
      </div>
    ));
  }

  return (
    <AppShell
      nav={
        <SideNav
          label={t.dash.navLabel}
          items={items}
          current={page}
          disabled={!ready}
          {...(ready ? {} : { describedBy: STATUS })}
          onSelect={navigate}
          actions={side}
        />
      }
    >
      <Main>
        <div className="shell-page">
          {demo ? <DemoBanner /> : null}
          {/* Said once the user's own results are ready; in the demo they
              are ready from the start, so nothing changes to be said. */}
          <p role="status" className="visually-hidden">
            {ready && !demo ? t.dash.resultsReady : ""}
          </p>
          <ErrorBoundary
            resetKey={`dashboard:${page}`}
            fallback={
              <div className="screen">
                {crashed}
                <div className="actions-row phone-actions">{side}</div>
              </div>
            }
          >
            <div className="screen">
              {head}
              {attention}
              {body}
              {/* On a phone the sidebar's actions move here, below
                  everything, in every state: a failure says to go back. */}
              <div className="actions-row phone-actions">{side}</div>
            </div>
          </ErrorBoundary>
        </div>
      </Main>
    </AppShell>
  );
}
