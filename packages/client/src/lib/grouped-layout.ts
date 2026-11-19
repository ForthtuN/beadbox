// Grouped view: place each top-level task in one status group, keeping all of
// its matching descendants nested below it. Group membership follows the
// task's status (or the first matching descendant when the task is filtered).
// Subtasks keep their own status badges without being detached from their task.
import type { Bead, Epic } from "@/lib/types"

/** One epic's card inside one status group. */
export interface GroupedCard {
  /** Unique per card (an epic can have a card in several groups). */
  key: string
  /** The epic as the Grouped OFF tree renders it (header, progress, n/m). */
  epic: Epic
  /** Top-level tasks assigned to this group, retaining nested subtasks. */
  beads: Bead[]
  /** True when this is the epic's own status, so its header counts here. */
  ownStatus: boolean
}

export interface GroupedSection {
  status: string
  label: string
  cards: GroupedCard[]
  /** Beads with no parent epic, shown after the cards. */
  loose: Bead[]
  /**
   * Items nested under tasks assigned to this group, plus the card
   * headers of epics whose own status is this one (not cards that appear here
   * only to hold their children). Summed over the groups, each visible bead
   * and epic counts exactly once.
   */
  count: number
}

const STANDALONE = "_standalone"

export function groupedCardKey(status: string, epicId: string): string {
  return `grouped:${status}:${epicId}`
}

export function groupTreeByStatus(
  roots: Epic[],
  chain: string[],
  matches: (bead: Bead) => boolean = () => true,
  headerFor: (epic: Epic) => Epic = (epic) => epic,
): GroupedSection[] {
  const sections = new Map<string, { cards: GroupedCard[]; loose: Bead[] }>()
  const sectionFor = (status: string) => {
    let s = sections.get(status)
    if (!s) {
      s = { cards: [], loose: [] }
      sections.set(status, s)
    }
    return s
  }

  // Keep ancestors of matching descendants, including when the ancestor's own
  // status or type is filtered out. Every retained child has exactly one parent.
  const matchingTree = (beads: Bead[] | undefined): Bead[] =>
    (beads ?? []).flatMap((bead) => {
      const children = matchingTree(bead.children)
      if (!matches(bead) && children.length === 0) return []
      return [{ ...bead, children: children.length ? children : undefined }]
    })

  const firstMatchingStatus = (bead: Bead): string => {
    if (matches(bead)) return bead.status
    for (const child of bead.children ?? []) {
      const status = firstMatchingStatus(child)
      if (status) return status
    }
    return bead.status
  }

  const byStatus = (rows: Bead[]) => {
    const out = new Map<string, Bead[]>()
    for (const row of rows) {
      const status = firstMatchingStatus(row)
      const list = out.get(status)
      if (list) list.push(row)
      else out.set(status, [row])
    }
    return out
  }

  const walk = (epic: Epic) => {
    if (epic.id === STANDALONE) {
      for (const [status, rows] of byStatus(matchingTree(epic.children)))
        sectionFor(status).loose.push(...rows)
      return
    }
    const rows = byStatus(matchingTree(epic.children))
    const header = headerFor(epic)
    const ownStatus = matches(epic) ? epic.status : null
    const statuses = [...rows.keys()]
    if (ownStatus !== null && !rows.has(ownStatus)) statuses.push(ownStatus)
    for (const status of statuses) {
      sectionFor(status).cards.push({
        key: groupedCardKey(status, epic.id),
        epic: header,
        beads: rows.get(status) ?? [],
        ownStatus: status === ownStatus,
      })
    }
    // Child epics are their own cards, never nested.
    for (const child of epic.childEpics ?? []) walk(child)
  }
  for (const root of roots) walk(root)

  // Workflow order, as groupBeadsByStatus: open, in progress, the workspace's
  // chain, closed, then anything else in the order first seen.
  const order: string[] = []
  for (const s of ["open", "in_progress", ...chain, "closed", ...sections.keys()]) {
    if (!order.includes(s)) order.push(s)
  }
  const labelFor = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  return order
    .filter((status) => sections.has(status))
    .map((status) => {
      const { cards, loose } = sections.get(status) as { cards: GroupedCard[]; loose: Bead[] }
      const countTree = (beads: Bead[]): number =>
        beads.reduce((n, bead) => n + 1 + countTree(bead.children ?? []), 0)
      const rows = cards.reduce((n, c) => n + countTree(c.beads), 0) + countTree(loose)
      return {
        status,
        label: labelFor(status),
        cards,
        loose,
        count: rows + cards.filter((c) => c.ownStatus).length,
      }
    })
}

/** One keyboard stop, in display order (same shape as the tree's). */
export interface GroupedNavItem {
  id: string
  type: "epic" | "bead"
  bead: Bead
}

/**
 * The keyboard order of the Grouped view: per group, each card header (its
 * own stop, keyed by the card, since one epic can have a card in several
 * groups), then the card's rows when the epic is expanded, then the group's
 * loose rows. A collapsed task is a single stop; expanding it adds its
 * visible descendants in exactly the same order as BeadTable renders them.
 */
export function groupedNavigationOrder(
  layout: GroupedSection[],
  expandedEpics: Set<string>,
  expandedBeads: Set<string> = new Set(),
): GroupedNavItem[] {
  const items: GroupedNavItem[] = []
  const addBead = (bead: Bead) => {
    items.push({ id: bead.id, type: "bead", bead })
    if (expandedBeads.has(bead.id)) bead.children?.forEach(addBead)
  }
  for (const section of layout) {
    for (const card of section.cards) {
      items.push({ id: card.key, type: "epic", bead: card.epic })
      if (expandedEpics.has(card.epic.id)) {
        card.beads.forEach(addBead)
      }
    }
    section.loose.forEach(addBead)
  }
  return items
}
