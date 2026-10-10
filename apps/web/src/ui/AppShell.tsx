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
  /** The count asks for attention: a note that warns or stops a return. */
  readonly warn?: boolean;
}

export function SideNav<Id extends string>({
  label,
  items,
  current,
  disabled = false,
  describedBy,
  onSelect,
  actions,
}: {
  readonly label: string;
  readonly items: readonly NavEntry<Id>[];
  readonly current: Id;
  /** While there is nothing to show yet: reachable, and saying why not. */
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onSelect: (id: Id) => void;
  /** Back and start over, below the navigation on a desktop. */
  readonly actions: ReactNode;
}) {
  return (
    <aside className="side">
      <nav aria-label={label} className="side-nav">
        <ul role="list">
          {items.map((item) => {
            const isCurrent = item.id === current;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={cx(
                    "nav-item",
                    isCurrent && "is-current",
                    item.warn === true && "is-warn",
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
                  <span className="nav-label">{item.label}</span>
                  {item.count === undefined || disabled ? null : (
                    <>
                      <span className="nav-count num" aria-hidden>
                        {item.count}
                      </span>
                      {item.countLabel === undefined ? null : (
                        <span className="visually-hidden">
                          , {item.countLabel}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="side-actions">{actions}</div>
    </aside>
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
