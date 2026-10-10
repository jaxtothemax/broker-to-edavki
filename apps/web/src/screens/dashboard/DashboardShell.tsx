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
import { useReturnsWriting, type ReturnsSource, type Writing } from "./writing";

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
      <p className="muted">{t.review.emptyBody}</p>
      <Button variant="primary" size="lg" onClick={onStartDemo}>
        {t.start.primaryCta}
        <ArrowRightIcon size={18} weight="bold" aria-hidden />
      </Button>
    </div>
  );
}

/** What a blocking note stops: one return while the other can be written. */
function blockedText(
  forms: { readonly kdvp: FormOutput; readonly div: FormOutput } | null,
  t: Messages,
): string {
  if (forms === null) return t.review.blocked;
  const withheld = (form: FormOutput) => form.needed && form.xml === null;
  if (withheld(forms.kdvp) && !withheld(forms.div)) {
    return t.review.blockedOne(t.download.kdvpTitle);
  }
  if (withheld(forms.div) && !withheld(forms.kdvp)) {
    return t.review.blockedOne(t.download.divTitle);
  }
  return t.review.blocked;
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

export function DashboardShell(props: ShellProps) {
  const { preview, status, returns } = props;
  // The writer runs here, above the pages, so a change of page never
  // writes the returns again.
  return preview !== null && status === "ready" && returns !== null ? (
    <ReadyDashboard {...props} preview={preview} returns={returns} />
  ) : (
    <Dashboard {...props} writing={null} />
  );
}

function ReadyDashboard(
  props: ShellProps & {
    readonly preview: ReturnPreview;
    readonly returns: ReturnsSource;
  },
) {
  const writing = useReturnsWriting(props.returns);
  return <Dashboard {...props} writing={writing} />;
}

function Dashboard({
  preview,
  status,
  fileNames,
  forms,
  demo,
  view,
  onViewChange,
  onBack,
  onRestart,
  onTour,
  onStartDemo,
  writing,
}: ShellProps & { readonly writing: Writing | null }) {
  const { locale, t } = useI18n();
  // What the pages need, once there is something to show.
  const live =
    preview !== null && status === "ready" && writing !== null
      ? { preview, writing }
      : null;
  const ready = live !== null;
  const page: DashPage = ready ? view.page : "overview";
  const year = String(preview?.taxYear ?? "");
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
      countLabel: plural(noteCount, locale, t.dash.countNotes),
      warn: needAttention > 0,
    },
  ];

  const tourButton =
    demo && onTour !== undefined ? (
      <Button id={TOUR_BUTTON_ID} variant="ghost" onClick={onTour}>
        <SignpostIcon size={18} weight="bold" aria-hidden />
        {t.tour.action}
      </Button>
    ) : null;
  const canDownload =
    live !== null &&
    page === "overview" &&
    neededForms(live.preview, live.writing).length > 0;
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
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeftIcon size={18} weight="bold" aria-hidden />
        <span className="side-action-label">{t.dash.backToDetails}</span>
      </Button>
      <Button variant="ghost" onClick={onRestart}>
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
              onNavigate={navigate}
            />
            {/* On a phone the sidebar's actions move here, below everything. */}
            <div className="actions-row phone-actions">{side}</div>
          </>
        );
    }
  };

  let body: ReactNode;
  if (status === "preparing") {
    body = (
      <Note tone="neutral" role="status" id={STATUS}>
        {t.review.preparing}
      </Note>
    );
  } else if (status === "failed") {
    body = (
      <Note tone="danger" role="alert" id={STATUS}>
        {t.review.prepareFailed}
      </Note>
    );
  } else if (live === null) {
    body = <EmptyResults onStartDemo={onStartDemo} />;
  } else {
    body = DASH_PAGES.map((shown) => (
      <div key={shown} className="dash-page" hidden={shown !== page}>
        {pageBody(shown, live)}
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
          {/* The only boundary around the dashboard's pages: a page that
              fails to render leaves the navigation, and the user's files,
              in place. */}
          <ErrorBoundary
            resetKey={`dashboard:${page}`}
            fallback={
              <div className="screen">
                <Note tone="danger" role="alert">
                  {t.app.crashed}
                </Note>
              </div>
            }
          >
            <div className="screen">
              {head}
              {attention}
              {body}
            </div>
          </ErrorBoundary>
        </div>
      </Main>
    </AppShell>
  );
}
