// Grouped (by status) keeps tasks and their subtasks nested in one group.

import { afterEach, expect, mock, test } from "bun:test"
import { cleanup, render } from "@testing-library/react"

import { EpicTree } from "../components/epic-tree"
import { GroupedStatusView } from "../components/grouped-status-view"
import {
  type GroupedSection,
  groupedNavigationOrder,
  groupTreeByStatus,
} from "../lib/grouped-layout"
import type { Bead, Epic } from "../lib/types"

afterEach(cleanup)

function epic(id: string, status: Epic["status"], type: Epic["type"] = "epic"): Epic {
  return {
    id,
    title: `title ${id}`,
    type,
    description: "",
    status,
    priority: "medium",
    assignee: "",
    comments: [],
    children: [],
    childEpics: [],
  }
}

function bead(id: string, status: Bead["status"], children?: Bead[]): Bead {
  return { ...epic(id, status, "task"), childEpics: undefined, children } as Bead
}

// The probe tree (AC8 and the bead's "How to verify"):
//   A (open epic)   -> T1 (open), T2 (in_progress) -> S1 (open subtask)
//   B (closed epic) -> T3 (open)
//   C (open epic)   -> nothing
//   D (open epic)   -> child epic E (open) -> T4 (open)
//   loose           -> L1 (open)
function probe(): Epic[] {
  const a = epic("A", "open")
  a.children = [bead("T1", "open"), bead("T2", "in_progress", [bead("S1", "open")])]
  const b = epic("B", "closed")
  b.children = [bead("T3", "open")]
  const c = epic("C", "open")
  const d = epic("D", "open")
  const e = epic("E", "open")
  e.children = [bead("T4", "open")]
  d.childEpics = [e]
  const standalone = epic("_standalone", "open")
  standalone.children = [bead("L1", "open")]
  return [a, b, c, d, standalone]
}

const BEAD_IDS = ["T1", "T2", "S1", "T3", "T4", "L1"]
// A row and everything it would render beneath itself when expanded.
const withDescendants = (rows: Bead[]): Bead[] =>
  rows.flatMap((r) => [r, ...withDescendants(r.children ?? [])])
const rowsOf = (s: GroupedSection) =>
  withDescendants([...s.cards.flatMap((c) => c.beads), ...s.loose])
const section = (layout: GroupedSection[], status: string) =>
  layout.find((s) => s.status === status)
const cardIds = (s: GroupedSection | undefined) => s?.cards.map((c) => c.epic.id) ?? []
const cardRows = (s: GroupedSection | undefined, epicId: string) =>
  s?.cards.find((c) => c.epic.id === epicId)?.beads.map((b) => b.id) ?? null

test("AC2: every bead appears exactly once across all groups, and no epic is a row", () => {
  const layout = groupTreeByStatus(probe(), [])
  const ids = layout.flatMap(rowsOf).map((b) => b.id)
  for (const id of BEAD_IDS)
    expect({ id, times: ids.filter((x) => x === id).length }).toEqual({ id, times: 1 })
  for (const epicId of ["A", "B", "C", "D", "E"]) expect(ids).not.toContain(epicId)
})

test("grouped: a task stays with its subtasks in one expandable tree", () => {
  const layout = groupTreeByStatus(probe(), [])
  expect(cardRows(section(layout, "open"), "A")).toEqual(["T1"])
  expect(cardRows(section(layout, "in_progress"), "A")).toEqual(["T2"])
  expect(
    section(layout, "in_progress")
      ?.cards.find((c) => c.epic.id === "A")
      ?.beads[0].children?.map((b) => b.id),
  ).toEqual(["S1"])
})

test("grouping follows top-level task status; subtasks retain their real statuses", () => {
  for (const s of groupTreeByStatus(probe(), [])) {
    for (const row of [...s.cards.flatMap((c) => c.beads), ...s.loose]) {
      expect({ group: s.status, id: row.id, status: row.status }).toEqual({
        group: s.status,
        id: row.id,
        status: s.status,
      })
    }
  }
  const child = rowsOf(
    section(groupTreeByStatus(probe(), []), "in_progress") as GroupedSection,
  ).find((r) => r.id === "S1")
  expect(child?.status).toBe("open")
})

test("AC4: an epic is a card wherever it has beads, and in its own status group even when empty; child epics are their own cards", () => {
  const layout = groupTreeByStatus(probe(), [])
  const open = section(layout, "open")
  expect(cardIds(open)).toEqual(["A", "B", "C", "D", "E"])
  expect(cardRows(open, "B")).toEqual(["T3"])
  expect(cardRows(open, "C")).toEqual([])
  expect(cardRows(open, "D")).toEqual([])
  expect(cardRows(open, "E")).toEqual(["T4"])
  expect(section(layout, "open")?.loose.map((b) => b.id)).toEqual(["L1"])
  expect(cardIds(section(layout, "in_progress"))).toEqual(["A"])
  // B is closed: its own-status card exists, empty.
  expect(cardIds(section(layout, "closed"))).toEqual(["B"])
  expect(cardRows(section(layout, "closed"), "B")).toEqual([])
})

test("AC3: the card header is the Grouped OFF epic (whole-subtree n/m), not the group's rows", () => {
  const tree = probe()
  const offA = { ...tree[0], title: "the Grouped OFF object for A" }
  const layout = groupTreeByStatus(
    tree,
    [],
    () => true,
    (e) => (e.id === "A" ? offA : e),
  )
  const cardsOfA = layout.flatMap((s) => s.cards).filter((c) => c.epic.id === "A")
  expect(cardsOfA).toHaveLength(2) // OPEN and IN PROGRESS
  for (const c of cardsOfA) expect(c.epic).toBe(offA)
})

test("group count: its rows plus the cards of epics whose OWN status is the group; summed, every bead and epic once", () => {
  const layout = groupTreeByStatus(probe(), [])
  // OPEN: top-level T1 T3 T4 L1 (4) + own-status cards A C D E (4) = 8.
  expect(section(layout, "open")?.count).toBe(8)
  // IN PROGRESS: T2 and its open-status child S1 (2); A is a holder here.
  expect(section(layout, "in_progress")?.count).toBe(2)
  // CLOSED: B's own-status card (1).
  expect(section(layout, "closed")?.count).toBe(1)
  // 6 beads + 5 epics, each exactly once.
  expect(layout.reduce((n, s) => n + s.count, 0)).toBe(BEAD_IDS.length + 5)
})

test("AC6: a filter that excludes a status yields no group of it, even for an epic's own-status card", () => {
  const layout = groupTreeByStatus(probe(), [], (b) => b.status !== "closed")
  expect(section(layout, "closed")).toBeUndefined()
  expect(cardIds(section(layout, "open"))).toContain("B") // B still holds T3
})

test("render: nested subtasks appear only under an expanded parent and have chevrons", () => {
  const layout = groupTreeByStatus(probe(), [])
  const { container } = render(
    <GroupedStatusView
      sections={layout}
      onBeadClick={mock(() => {})}
      expandedBeads={new Set(["T2", "A", "B", "C", "D", "E"])}
      expandedEpics={new Set(["A", "B", "C", "D", "E"])}
      onToggleEpic={mock(() => {})}
      onToggleBead={mock(() => {})}
    />,
  )
  for (const id of BEAD_IDS) {
    const rows = container.querySelectorAll(`[data-item-id="${id}"]`)
    expect({ id, rows: rows.length }).toEqual({ id, rows: 1 })
  }
  expect(container.querySelector('[data-item-id="T2"] .bead-row-id button')).not.toBeNull()
  expect(container.querySelector('[data-item-id="S1"] .bead-row-id button')).toBeNull()
  cleanup()
  const collapsed = render(
    <GroupedStatusView
      sections={layout}
      onBeadClick={mock(() => {})}
      expandedBeads={new Set()}
      expandedEpics={new Set(["A", "B", "C", "D", "E"])}
      onToggleEpic={mock(() => {})}
      onToggleBead={mock(() => {})}
    />,
  )
  expect(collapsed.container.querySelector('[data-item-id="T2"]')).not.toBeNull()
  expect(collapsed.container.querySelector('[data-item-id="S1"]')).toBeNull()
})

test("AC1/AC3: the grouped card is the tree's card: same whole-subtree n/m in every group, archive button, child table", () => {
  const tree = probe()
  const a = tree[0]
  const treeView = render(
    <EpicTree
      epics={[a]}
      expandedEpics={new Set(["A"])}
      onToggleEpic={mock(() => {})}
      onBeadClick={mock(() => {})}
    />,
  )
  // The n/m element itself: its whole text is "x/y (z%)".
  const nmOf = (root: Element | null | undefined) =>
    [...(root?.querySelectorAll("*") ?? [])]
      .map((e) => e.textContent?.trim() ?? "")
      .find((t) => /^\d+\/\d+ \(\d+%\)$/.test(t))
      ?.split(" ")[0]
  const treeNm = nmOf(treeView.container.querySelector('[data-item-id="A"]'))
  expect(treeNm).toBe("0/3") // T1, T2 and its subtask S1
  cleanup()

  const { container } = render(
    <GroupedStatusView
      sections={groupTreeByStatus(tree, [])}
      onBeadClick={mock(() => {})}
      onArchiveEpic={mock(() => {})}
      expandedEpics={new Set(["A"])}
      onToggleEpic={mock(() => {})}
    />,
  )
  for (const key of ["grouped:open:A", "grouped:in_progress:A"]) {
    const card = container.querySelector(`[data-item-id="${key}"]`)
    expect({ key, found: card != null }).toEqual({ key, found: true })
    // The header's n/m is the epic's, not the group's row count.
    expect({ key, nm: nmOf(card) }).toEqual({ key, nm: treeNm })
    expect({
      key,
      archive: card?.querySelector('[aria-label="Archive epic: title A"]') != null,
    }).toEqual({ key, archive: true })
  }
  // A's OPEN card only contains T1; S1 is nested under T2 in IN PROGRESS.
  const open = container.querySelector('[data-item-id="grouped:open:A"]')
  expect(
    [...(open?.querySelectorAll("[data-item-id]") ?? [])].map((e) =>
      e.getAttribute("data-item-id"),
    ),
  ).toEqual(["T1"])
})

test("AC4: an empty card says so instead of showing nothing", () => {
  const { container } = render(
    <GroupedStatusView
      sections={groupTreeByStatus(probe(), [])}
      onBeadClick={mock(() => {})}
      expandedEpics={new Set(["C"])}
      onToggleEpic={mock(() => {})}
    />,
  )
  expect(container.querySelector('[data-item-id="grouped:open:C"]')?.textContent).toContain(
    "No beads with this status",
  )
})

test("keyboard order follows the visible hierarchy and expanded task state", () => {
  const layout = groupTreeByStatus(probe(), [])
  const all = groupedNavigationOrder(
    layout,
    new Set(["A", "B", "C", "D", "E"]),
    new Set(["T2"]),
  ).map((i) => i.id)
  expect(all).toEqual([
    "grouped:open:A",
    "T1",
    "grouped:open:B",
    "T3",
    "grouped:open:C",
    "grouped:open:D",
    "grouped:open:E",
    "T4",
    "L1",
    "grouped:in_progress:A",
    "T2",
    "S1",
    "grouped:closed:B",
  ])
  expect(new Set(all).size).toBe(all.length)
  const closedTask = groupedNavigationOrder(
    layout,
    new Set(["A", "B", "C", "D", "E"]),
    new Set(),
  ).map((i) => i.id)
  expect(closedTask).toContain("T2")
  expect(closedTask).not.toContain("S1")
  // A collapsed card is one stop; its rows are not.
  const collapsed = groupedNavigationOrder(layout, new Set(), new Set(["T2"])).map((i) => i.id)
  expect(collapsed).not.toContain("T1")
  expect(collapsed).not.toContain("S1")
  expect(collapsed).toContain("L1")
})

test("filtered parent stays as context when only a deeply nested subtask matches", () => {
  const a = epic("A", "open")
  a.children = [bead("T", "in_progress", [bead("S", "closed", [bead("SS", "open")])])]
  const layout = groupTreeByStatus([a], [], (b) => b.id === "SS")
  const open = section(layout, "open")
  expect(cardRows(open, "A")).toEqual(["T"])
  const t = open?.cards[0].beads[0]
  expect(t?.children?.[0].id).toBe("S")
  expect(t?.children?.[0].children?.[0].id).toBe("SS")
  expect(open?.count).toBe(3)
  expect(
    groupedNavigationOrder(layout, new Set(["A"]), new Set(["T", "S"])).map((item) => item.id),
  ).toEqual(["grouped:open:A", "T", "S", "SS"])
})

test("loose tasks with nested children remain beneath their parent, not as unassigned rows", () => {
  const root = epic("_standalone", "open")
  root.children = [bead("P", "in_progress", [bead("C", "open")])]
  const layout = groupTreeByStatus([root], [])
  expect(section(layout, "in_progress")?.loose.map((b) => b.id)).toEqual(["P"])
  expect(section(layout, "in_progress")?.loose[0].children?.map((b) => b.id)).toEqual(["C"])
  expect(layout.flatMap(rowsOf).map((b) => b.id)).toEqual(["P", "C"])
})
