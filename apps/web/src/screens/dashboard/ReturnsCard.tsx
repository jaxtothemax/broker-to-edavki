/**
 * The returns, on the overview: one row per form the year needs, each with
 * its file and its own download. A return a note stops is withheld on its
 * own while the other can still be saved (ADR 0018 §6, ADR 0013 §9): its
 * row says so and leads to the notes. A form the year does not need gets
 * no row, and with none at all there is nothing to file. The files are
 * written by the same engine and writers as the command line's, and saved
 * on the user's device only.
 */
import {
  CalendarBlankIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
} from "@phosphor-icons/react";

import type { BuiltForm } from "../../engine/demoReturns";
import { saveFile } from "../../engine/saveFile";
import { explain } from "../../explain/anchors";
import { formatDate, formatNumber, plural } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import { formFileName, type ReturnPreview } from "../../model/preview";
import { Button, Chip, Note } from "../../ui/kit";
import { filingDeadline, type Writing } from "./writing";

/** The note every disabled download points at while nothing can be saved. */
export const STATUS_NOTE = "download-status";

/** Where the overview's "Download for eDavki" takes the user. */
export const RETURNS_TITLE = "returns-title";

export interface FormRowProps {
  readonly id: "kdvp" | "div";
  readonly form: string;
  readonly body: string;
  readonly fileName: string;
  /** The written return, or null while it is being written or failed. */
  readonly built: BuiltForm | null;
  readonly onShowNotes: () => void;
}

export function FormRow({
  id,
  form,
  body,
  fileName,
  built,
  onShowNotes,
}: FormRowProps) {
  const { locale, t } = useI18n();
  const xml = built?.xml ?? null;
  const reasonId = `${id}-not-written`;
  const chip =
    built === null ? (
      <Chip tone="neutral">{t.download.preparingChip}</Chip>
    ) : xml === null ? (
      <Chip tone="warn">{t.download.notWrittenChip}</Chip>
    ) : (
      <Chip tone="accent">{t.download.readyChip}</Chip>
    );
  const button = (
    <Button
      variant="primary"
      size="sm"
      {...(built === null || xml === null
        ? {
            "aria-disabled": true,
            "aria-describedby": built === null ? STATUS_NOTE : reasonId,
          }
        : {
            onClick: () => {
              saveFile(built.fileName, xml);
            },
          })}
      {...explain("download.button", id)}
    >
      <DownloadSimpleIcon size={16} weight="bold" aria-hidden />
      {t.download.downloadButton(form)}
    </Button>
  );
  return (
    <li className="return-row" {...explain("download.form", id)}>
      <span className="icon-tile icon-tile-sm" aria-hidden>
        <FileCodeIcon size={18} weight="bold" />
      </span>
      <div className="return-main">
        <div className="return-title-row">
          <h3 className="return-title" {...explain("download.title", id)}>
            {form}
          </h3>
          {chip}
        </div>
        <p className="muted small">{body}</p>
        <p>
          <code className="code-badge" {...explain("download.fileName", id)}>
            {built?.fileName ?? fileName}
          </code>
        </p>
        {built !== null && xml === null ? (
          <p className="muted small" id={reasonId}>
            {plural(built.blocking, locale, t.download.notWritten)}
          </p>
        ) : null}
      </div>
      <div className="return-actions">
        {button}
        {built !== null && xml === null ? (
          <Button variant="ghost" size="sm" onClick={onShowNotes}>
            {t.review.showNotes}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** The forms the year needs: listed in the preview, or written as needed. */
export function neededForms(
  preview: ReturnPreview,
  writing: Writing,
): readonly ("kdvp" | "div")[] {
  const returns = writing.status === "ready" ? writing.returns : null;
  return [
    preview.securities.length === 0 && returns?.kdvp.needed !== true
      ? null
      : ("kdvp" as const),
    preview.dividends.length === 0 && returns?.div.needed !== true
      ? null
      : ("div" as const),
  ].filter((form) => form !== null);
}

export function ReturnsCard({
  preview,
  writing,
  demo,
  onShowNotes,
}: {
  readonly preview: ReturnPreview;
  readonly writing: Writing;
  /** Whether these are the demo's files, which must never be imported. */
  readonly demo: boolean;
  readonly onShowNotes: () => void;
}) {
  const { locale, t } = useI18n();
  const returns = writing.status === "ready" ? writing.returns : null;
  const deadline = formatDate(filingDeadline(preview.taxYear), locale);
  const forms = neededForms(preview, writing);
  if (forms.length === 0) {
    // No header download is offered then: nothing points here.
    return <Note tone="neutral">{t.download.nothingToFile}</Note>;
  }
  const lists = preview.securities.length;
  const payments = preview.dividends.length;
  return (
    <div className="returns-grid">
      <section className="card returns-card" aria-labelledby={RETURNS_TITLE}>
        <div className="returns-head">
          <h2 id={RETURNS_TITLE} tabIndex={-1}>
            {t.dash.returnsTitle}
          </h2>
          <Chip tone="accent" size="md">
            <CalendarBlankIcon size={16} weight="bold" aria-hidden />
            {t.download.due(deadline)}
          </Chip>
        </div>
        <p className="muted">{t.download.intro(deadline)}</p>
        <ul className="return-rows" role="list">
          {forms.map((id) =>
            id === "kdvp" ? (
              <FormRow
                key={id}
                id={id}
                form={t.download.kdvpTitle}
                body={
                  lists === 0
                    ? t.download.kdvpNone
                    : plural(lists, locale, t.download.kdvpBody)
                }
                fileName={formFileName("kdvp", preview.taxYear)}
                built={returns?.kdvp ?? null}
                onShowNotes={onShowNotes}
              />
            ) : (
              <FormRow
                key={id}
                id={id}
                form={t.download.divTitle}
                body={
                  payments === 0
                    ? t.download.divNone
                    : plural(payments, locale, t.download.divBody)
                }
                fileName={formFileName("div", preview.taxYear)}
                built={returns?.div ?? null}
                onShowNotes={onShowNotes}
              />
            ),
          )}
        </ul>
        {writing.status === "preparing" ? (
          <Note key="preparing" tone="neutral" role="status" id={STATUS_NOTE}>
            {t.download.preparing}
          </Note>
        ) : writing.status === "failed" ? (
          <Note key="failed" tone="danger" role="alert" id={STATUS_NOTE}>
            {t.download.failed}
          </Note>
        ) : demo ? (
          <Note tone="warn">{t.download.demoFiles}</Note>
        ) : (
          <Note tone="neutral">{t.download.ownFiles}</Note>
        )}
      </section>

      <section className="card import-card">
        <h2>{t.download.importTitle}</h2>
        <ol className="timeline" role="list">
          {t.download.importSteps(deadline, forms.length).map((step, i) => (
            <li key={step}>
              <span className="timeline-dot num" aria-hidden>
                {formatNumber(String(i + 1), locale)}
              </span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
