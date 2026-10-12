/**
 * The app shell the dashboard opens in (#47): a sidebar beside the content,
 * the way Mercury, Linear and Copilot Money lay out an app. One `<nav>` at
 * every width, restyled by CSS: a sidebar on a desktop, an icon rail on a
 * tablet and a bar along the bottom of a phone. Two navigations, one hidden
 * by a media query, would both be live wherever CSS is not applied.
 *
 * The pages are buttons, not links: the app has no addresses, and keeps no
 * history of where the user has been (ADR 0002). The current one carries
 * aria-current="page". The side actions sit outside the navigation; on a
 * phone they move to the end of the overview.
 *
 * A group (the broker accounts) is a second list inside the same `<nav>`,
 * under its own heading. The stylesheet shows it only on a desktop: the
 * rail and the bottom bar have no room for it, and the page it belongs to
 * (holdings) lists the same entries in its content there.
 */
import type { ReactNode } from "react";

import { cx } from "./kit";

export interface NavEntry<Id extends string> {
  readonly id: Id;
  readonly icon: ReactNode;
  readonly label: string;
  /** The count shown beside the label, formatted. */
  readonly count?: string;
  /** What the count means, read after the label ("9 securities sold"). */
  readonly countLabel?: string;
  /** The count asks for attention: a note that warns, or one that stops a return. */
  readonly tone?: "warn" | "danger";
  /** A second line under the label (an account's as-of day). */
  readonly detail?: string;
}

/** A titled list of entries after the pages, in the same navigation. */
export interface NavGroup<Id extends string> {
  readonly id: string;
  readonly title: string;
  readonly items: readonly NavEntry<Id>[];
}

export function SideNav<Id extends string>({
  label,
  items,
  current,
  disabled = false,
  describedBy,
  onSelect,
  actions,
  groups = [],
}: {
  readonly label: string;
  readonly items: readonly NavEntry<Id>[];
  /** Shown on a desktop only, after the pages. */
  readonly groups?: readonly NavGroup<Id>[];
  readonly current: Id;
  /** While there is nothing to show yet: reachable, and saying why not. */
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onSelect: (id: Id) => void;
  /** Back and start over, below the navigation on a desktop. */
  readonly actions: ReactNode;
}) {
  const entry = (item: NavEntry<Id>) => {
    const isCurrent = item.id === current;
    return (
      <li key={item.id}>
        <button
          type="button"
          className={cx(
            "nav-item",
            isCurrent && "is-current",
            item.tone === undefined ? null : `is-${item.tone}`,
          )}
          aria-current={isCurrent ? "page" : undefined}
          {...(disabled
            ? { "aria-disabled": true, "aria-describedby": describedBy }
            : {
                onClick: () => {
                  onSelect(item.id);
                },
              })}
        >
          <span className="nav-icon" aria-hidden>
            {item.icon}
          </span>
          {item.detail === undefined ? (
            <span className="nav-label">{item.label}</span>
          ) : (
            <span className="nav-label nav-label-stack">
              <span>{item.label}</span>
              <span className="nav-detail">{item.detail}</span>
            </span>
          )}
          {item.count === undefined || disabled ? null : (
            <>
              <span className="nav-count num" aria-hidden>
                {item.count}
              </span>
              {item.countLabel === undefined ? null : (
                <span className="visually-hidden">, {item.countLabel}</span>
              )}
            </>
          )}
        </button>
      </li>
    );
  };
  return (
    <div className="side">
      <nav aria-label={label} className="side-nav">
        <ul role="list">{items.map(entry)}</ul>
        {groups.map((group) => (
          <div key={group.id} className="nav-group">
            <h2 id={`nav-group-${group.id}`} className="nav-group-title">
              {group.title}
            </h2>
            <ul role="list" aria-labelledby={`nav-group-${group.id}`}>
              {group.items.map(entry)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="side-actions">{actions}</div>
    </div>
  );
}

/** The sidebar and the content beside it; the content is `<main>`. */
export function AppShell({
  nav,
  children,
}: {
  readonly nav: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="shell">
      {nav}
      {children}
    </div>
  );
}
