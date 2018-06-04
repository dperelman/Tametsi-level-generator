"""
A solver for Tametsi-like puzzles that works by resolving chains of inequalities.

Assumptions/conditions:

* Cells either have or do not have a mine and they are either a tile or revealed/flagged (no mine/mine respectively).
* If a cell is revealed, it has either a non-negative integer denoting the number of neighboring cells with mines, or a ? representing an unknown count.
* Column and color hints also exist that assert a given group of cells have some non-negative integer of mines.

* Inequalities have 1) a set of N cells and 2) 0 <= lower bound <= upper bound <= N for the number of mines in them.
* Inequalities are constructed from column/color hints and revealed cells.
* Additional inequalities may be derived by splitting and combining prior inequalities.
* Important: when combining inequalities, one will always be contained in the other.
* Derived inequalities are never any larger than the "parent" inequalities.

* Inequalities where lower bound == N ("full") or upper bound == 0 ("empty") are trivial.
* Trivial inequalities are eliminated and inequalities that depend on them need to be adjusted and/or re-derived.
* Full inequalities result in all contained tiles being flagged and related inequalities adjusted.
* Empty inequalities result in all contained tiles being revealed, related inequalities adjusted, and potentially new inequalities constructed.

* A solution is found when all cells have been flagged or revealed.
* Revealing a mine means immediate failure.
"""

import sys
import IPython
import pprint
from collections import deque


class CellSetDict(object):
  def __init__(self, cell_sets=None, ineq_map=None, strict=True):
    self.cell_set_map = dict()
    self.strict = strict

    if cell_sets and ineq_map:
      for cell_set in cell_sets:
        self.cell_set_map[cell_set] = ineq_map[cell_set]

    elif ineq_map:
      self.cell_set_map = ineq_map.copy()

    elif cell_sets and ineq_map is None:
      raise ValueError("If 'cell_sets' is provided, then 'ineq_map' must be provided as well.")

  def __bool__(self):
    return bool(self.cell_set_map)

  def __len__(self):
    return len(self.cell_set_map)

  def keys(self):
    return list(self.cell_set_map.keys())

  def values(self):
    return list(self.cell_set_map.values())

  def isdisjoint(self, other):
    return self.cell_set_map.keys().isdisjoint(other.cell_set_map.keys())

  def intersection(self, other):
    return [self.cell_set_map[key] for key in set(self.keys()).intersection(set(other.keys()))]

  def add_ineq(self, ineq):
    if ineq.cells in self.cell_set_map:
      self.cell_set_map[ineq.cells].set_bounds(ineq.bounds)
    else:
      self.cell_set_map[ineq.cells] = ineq

  def get_ineq(self, ineq_cells, strict=None):
    is_strict = strict is True or strict is None and self.strict is True

    if ineq_cells in self.cell_set_map:
      return self.cell_set_map[ineq_cells]
    elif is_strict:
      raise ValueError("No inequality found for cell set {}.".format(ineq_cells))

    return None

  def remove_ineq(self, ineq, strict=None):
    is_strict = strict is True or strict is None and self.strict is True

    if ineq is None:
      if is_strict:
        raise ValueError("Ineq must not be None if strict.")

    elif ineq.cells in self.cell_set_map:
      return self.cell_set_map.pop(ineq.cells)

    elif is_strict:
      import ipdb; ipdb.set_trace()
      raise ValueError("Cell set {} not found.".format(ineq.cells))

    return None

  def has_ineq(self, ineq, exact=True):
    retrieved = self.cell_set_map.get(ineq.cells)

    if retrieved is None:
      return False

    elif exact:
      return retrieved.bounds == ineq.bounds

  def copy(self):
    return self.__class__(ineq_map=self.cell_set_map, strict=self.strict)


class CellInequality(object):
  def __init__(self, cells, bounds, parents=None, children=None):
    self.cells = frozenset(cells)
    self.set_bounds(bounds)
    self.parents = parents or CellSetDict()
    self.children = children or CellSetDict()

  def __repr__(self):
    return '({} with {})'.format(set(self.cells), self.bounds)
  # __repr__ = __str__

  def set_bounds(self, bounds):
    if bounds[0] < 0 or bounds[1] < 0:
      raise ValueError("Cannot have negative bounds (bounds = {}).".format(bounds))
    if bounds[0] > bounds[1]:
      raise ValueError("Cannot have min greater than max (bounds = {}).".format(bounds))

    self.bounds = tuple(bounds)

  @property
  def trivial(self):
    return len(self.cells) == self.bounds[0] or self.bounds[1] == 0

  def cross(self, other):
    if not isinstance(other, CellInequality):
      raise ValueError("Other must be an inequality, not a {} (it is: {} )".format(type(other), other))

    if self.cells == other.cells:
      return set()

    if self.cells.isdisjoint(other.cells):
      return set([self, other])

    shared_cells = self.cells.intersection(other.cells)
    shared_bounds = (
      max(0, self.bounds[0] - len(self.cells) + len(shared_cells), other.bounds[0] - len(other.cells) + len(shared_cells)),
      min(len(shared_cells), self.bounds[1], other.bounds[1]),
    )

    new_ineqs = [CellInequality(shared_cells, shared_bounds)]

    left_cells = self.cells.difference(shared_cells)
    if left_cells:
      left_bounds = (
        max(0, self.bounds[0] - shared_bounds[1]),
        min(len(self.cells) - len(shared_cells), max(0, self.bounds[1] - shared_bounds[0])),
      )
      new_ineqs.append(CellInequality(left_cells, left_bounds))

    right_cells = other.cells.difference(shared_cells)
    if right_cells:
      right_bounds = (
        max(0, other.bounds[0] - shared_bounds[1]),
        min(len(other.cells) - len(shared_cells), max(0, other.bounds[1] - shared_bounds[0])),
      )
      new_ineqs.append(CellInequality(right_cells, right_bounds))

    return new_ineqs

  def add_parent(self, other):
    self.parents.add_ineq(other)

  def remove_parent(self, other, strict=None):
    self.parents.remove_ineq(other, strict=strict)

  def replace_parent(self, old, new, strict=None):
    self.remove_parent(old, strict=strict)
    self.add_parent(new)

  def add_child(self, other):
    self.children.add_ineq(other)

  def remove_child(self, other, strict=None):
    self.children.remove_ineq(other, strict=strict)

  def replace_child(self, old, new, strict=None):
    self.remove_child(old, strict=strict)
    self.add_child(new)


class InequalityPoset(object):
  def __init__(self):
    self.ineqs = CellSetDict()
    self.roots = CellSetDict()
    self.fresh_ineqs = CellSetDict()
    self.num_added = 0

  def add(self, ineq):
    # print("add enter")
    is_new = not self.ineqs.has_ineq(ineq)

    if not is_new:
      old_ineq = self.ineqs.get_ineq(ineq.cells)
      if old_ineq.bounds == ineq.bounds:
        # print("add return bounds equal")
        return

      self.num_added += 1

      new_bounds = (
        max(old_ineq.bounds[0], ineq.bounds[0]),
        min(old_ineq.bounds[1], ineq.bounds[1]),
      )
      # ineq = CellInequality(cells, new_bounds, parents=self.ineqs[cells].parents.copy(), children=self.ineqs[cells].children.copy())
      ineq.set_bounds(new_bounds)

    self.ineqs.add_ineq(ineq)
    self.fresh_ineqs.add_ineq(ineq)

    # Parent/child relationships are only based on cells, so if we already have the inequality's cells,
    # then we know its parents and children have already been determined and can return early.
    if not is_new:
      # print("add return is_new")
      return

    self.num_added += 1

    # print("Hi?", ineq)
    # if ineq.cells == frozenset([24]):
    #   import ipdb; ipdb.set_trace()

    # determine parents and children, if any
    # A is a child of B if A.cells.issubset(B.cells)
    is_a_root = True
    potential_relatives = deque(self.roots.values())
    covered_relatives = set([ineq.cells])

    while potential_relatives:
      candidate = potential_relatives.popleft()
      # print("candidate", candidate)
      covered_relatives.add(candidate.cells)

      # case -1: candidate IS ineq
      if candidate.cells == ineq.cells:
        pass

      # case 0: candidate is disjoint with ineq
      elif candidate.cells.isdisjoint(ineq.cells):
        pass

      # case 1: candidate is a child of ineq
      elif candidate.cells.issubset(ineq.cells):
        self.roots.remove_ineq(candidate, strict=False)
        candidate.add_parent(ineq)
        ineq.add_child(candidate)

        # remove duplicated parents
        for shared_parent in candidate.parents.intersection(ineq.parents):
          candidate.remove_parent(shared_parent)
          shared_parent.remove_child(candidate)

      # case 2: candidate is a parent or ancestor of ineq
      elif candidate.cells.issuperset(ineq.cells):
        is_a_root = False
        make_child = True

        # loop through children to see if any might be a parent or ancestor
        for child in candidate.children.values():
          if candidate.cells not in child.parents.keys() or child.cells not in candidate.children.keys(): import ipdb; ipdb.set_trace()
          if child.cells == ineq.cells:
            pass

          # put 'ineq' between 'child' and 'parent'
          elif child.cells.issubset(ineq.cells):
            make_child = False
            candidate.replace_child(child, ineq)
            child.replace_parent(candidate, ineq)
            ineq.add_parent(candidate)
            ineq.add_child(child)

          # 'child' is a parent or ancestor
          elif child.cells.issuperset(ineq.cells):
            make_child = False
            if child not in potential_relatives and child.cells not in covered_relatives:
              potential_relatives.append(child)

          # descendents of 'child' may be children of 'ineq'
          elif not child.cells.isdisjoint(ineq.cells):
            if child not in potential_relatives and child.cells not in covered_relatives:
              potential_relatives.append(child)

        if make_child:
          candidate.add_child(ineq)
          ineq.add_parent(candidate)

      # case 3: descendents may be children of ineq
      elif not candidate.cells.isdisjoint(ineq.cells):
        for child in candidate.children.values():
          if child.cells != ineq.cells and child not in potential_relatives and child.cells not in covered_relatives:
            potential_relatives.append(child)

    if is_a_root:
      self.roots.add_ineq(ineq)
    # print("add exit")

  def get(self, cells):
    return self.ineqs.get(cells, None)

  def remove(self, ineq):
    ineq = self.ineqs.remove_ineq(ineq, strict=False)
    if ineq is None:
      return None

    self.fresh_ineqs.remove_ineq(ineq, strict=False)

    for parent in ineq.parents.values():
      parent.remove_child(ineq)

      for child in ineq.children.values():
        child.remove_parent(ineq)

        if parent.children.isdisjoint(child.parents):
          parent.add_child(child)
          child.add_parent(parent)

    if self.roots.has_ineq(ineq, exact=False):
      self.roots.remove_ineq(ineq)
      for child in ineq.children.values():
        if len(child.parents) <= 1:
          self.roots.add_ineq(child)

    return ineq

  def cross_ineqs(self):
    # print("cross_ineqs enter")
    if self.fresh_ineqs:
      ineqs_to_cross = self.fresh_ineqs
    else:
      print("Using 'em all.")
      ineqs_to_cross = CellSetDict(ineq_map=self.ineqs)

    self.num_added = 0

    for ineq in ineqs_to_cross.values():

      for parent in ineq.parents.values():
        # cross with parents
        for new_ineq in ineq.cross(parent):
          self.add(new_ineq)

        # cross with siblings
        for child in parent.children.values():
          for new_ineq in ineq.cross(child):
            self.add(new_ineq)

        for parent2 in ineq.parents.values():
          # cross parents with parents
          for new_ineq in parent.cross(parent2):
            self.add(new_ineq)

      # cross with children
      for child in ineq.children.values():
        for new_ineq in ineq.cross(child):
          self.add(new_ineq)

    self.fresh_ineqs = CellSetDict()
    # print("cross_ineqs exit")

  def find_trivial(self):
    trivial_ineqs = []

    for ineq in sorted(self.ineqs.values(), key=lambda x: len(x.cells), reverse=True):
      if ineq.trivial:
        for trivial in trivial_ineqs:
          if ineq.cells.issubset(trivial.cells):
            break
        else:
          trivial_ineqs.append(ineq)

    return trivial_ineqs

  def reduce(self, trivial_ineqs):
    revealed = set()
    flagged = set()

    for trivial in trivial_ineqs:
      if trivial.bounds[0] == 0:
        revealed = revealed.union(trivial.cells)

      elif trivial.bounds[0] > 0:
        flagged = flagged.union(trivial.cells)

    marked = revealed.union(flagged)

    if not marked: import ipdb; ipdb.set_trace()
    # if 27 in marked: import ipdb; ipdb.set_trace()
    print("marked:", marked)
    print("num before:", len(self.ineqs))

    for ineq in sorted(self.ineqs.values(), key=lambda x: len(x.cells), reverse=True):
      # import ipdb; ipdb.set_trace()
      if ineq.cells.issubset(marked):
        # print("issubset")
        self.remove(ineq)

      elif not marked.isdisjoint(ineq.cells):
        # print("not disjoint", ineq)
        self.remove(ineq)
        num_flagged = len(flagged.intersection(ineq.cells))

        new_cells = ineq.cells.difference(marked)
        new_bounds = (
          min(max(ineq.bounds[0] - num_flagged, 0), len(new_cells)),
          min(ineq.bounds[1] - num_flagged, len(new_cells)),
        )

        self.add(CellInequality(new_cells, new_bounds))

    print("num after:", len(self.ineqs))


class Puzzle(object):
  def __init__(self, board, revealed, constraints):
    self.board = board
    self.revealed = revealed
    self.ineq_poset = InequalityPoset()
    self.constraints = self.convert_constraints(constraints)
    self.flagged = []
    self.changed = []

  def convert_constraints(self, constraints):
    for constraint in constraints:
      cells = []
      count = constraint[0]

      for c in constraint[1]:
        if c not in self.revealed:
          cells.append(c)

      if cells:
        self.ineq_poset.add(CellInequality(cells, (count, count)))

  def make_new_inequalities(self):
    for c in self.changed:
      if self.board[c][1] == '.':
        cells = []
        count = 0

        for i in self.board[c][2]:
          if i not in self.flagged + self.revealed:
            cells.append(i)

            if self.board[i][1] == '*':
              count += 1

        if cells:
          self.ineq_poset.add(CellInequality(cells, (count, count)))

    self.changed = []

  def extend_unique(self, list1, list2):
    for x in list2:
      if x not in list1:
        list1.append(x)

  def solve_puzzle(self):
    self.changed = self.revealed[:]

    while self.ineq_poset.ineqs:

      self.make_new_inequalities()
      # print("\n make_new_inequalities")
      # pprint.pprint([[ineq, ineq.parents.cell_set_map, ineq.children.cell_set_map] for ineq in self.ineq_poset.ineqs.values()], width=160)
      # import ipdb; ipdb.set_trace()
      # IPython.embed()
      self.ineq_poset.cross_ineqs()
      # print("\n cross_ineqs")
      # pprint.pprint([[ineq, ineq.parents.cell_set_map, ineq.children.cell_set_map] for ineq in self.ineq_poset.ineqs.values()], width=160)
      # import ipdb; ipdb.set_trace()
      # IPython.embed()

      # if self.ineq_poset.num_added == 0:
      #   print("Failed to produce new inequalities by crossing parents and children, so crossing all pairs.")
      #   self.ineq_poset.cross_all_pairs()

      trivial_ineqs = self.ineq_poset.find_trivial()

      for trivial in trivial_ineqs:
        if trivial.bounds[0] == 0:
          # all cells revealed
          revealed_cells = sorted(list(trivial.cells))
          self.extend_unique(self.revealed, revealed_cells)
          self.extend_unique(self.changed, revealed_cells)

        elif trivial.bounds[0] > 0:
          # all cells flagged
          flagged_cells = sorted(list(trivial.cells))
          self.extend_unique(self.flagged, flagged_cells)

      print("\n trivial")
      print(trivial_ineqs)

      self.ineq_poset.reduce(trivial_ineqs)
      # print("\n reduce")
      # pprint.pprint([[ineq, ineq.parents.cell_set_map, ineq.children.cell_set_map] for ineq in self.ineq_poset.ineqs.values()], width=160)

      print()
      print("Revealed:", self.revealed)
      print("Flagged:", self.flagged)
      print("Changed:", self.changed)
      print()

      # import ipdb; ipdb.set_trace()

    return (self.revealed, self.flagged, self.ineq_poset.ineqs)

  def print_progress(self):
    pass


def output_debug_graph(ineq_map):
  file = open('Tametsi_posetDebugGraph.gvz', 'w')
  file.write('digraph G {\n')

  def sort(L):
    return sorted(L, key=lambda x: len(x.cells), reverse=True)

  for ineq in sort(ineq_map.values()):
    for child in sort(ineq.children.values()):
      file.write('"{}" -> "{}";\n'.format(ineq.cells, child.cells))

  file.write('}\n')
  file.close()


def demo1():
  # . * . *
  # ? . . ?
  board = [
    (0, '.', (1, 4, 5)),
    (1, '*', (0, 2, 4, 5, 6)),
    (2, '.', (1, 3, 5, 6, 7)),
    (3, '*', (2, 6, 7)),
    (4, '?', (0, 1, 5)),
    (5, '.', (0, 1, 2, 4, 6)),
    (6, '.', (1, 2, 3, 5, 7)),
    (7, '?', (2, 3, 6)),
  ]
  revealed = [0, 5, 7]
  constraints = [
    (2, [0, 1, 2, 3, 4, 5, 6, 7]),
  ]

  print('board:', board)
  print('constraints:', constraints)

  print(Puzzle(board, revealed, constraints).solve_puzzle())


def demo2():
  # Combination Lock levels

  # Combination Lock I
  # . * . ? . .
  # . * . ? . .
  # * . * * * ?
  # * * . ? . .
  # * ? * . * .
  # . . . * . ?
  compressed = '.*.?...*.?..*.***?**.?..*?*.*....*.?'
  w, h = 6, 6

  # # Combination Lock II
  # # . * * * . *
  # # . . * * * *
  # # * . * . . *
  # # . ? . . . .
  # # . * . . * ?
  # # . * . * * *
  # compressed = '.***.*..*****.*..*.?.....*..*?.*.***'
  # w, h = 6, 6

  # # Combination Lock VI
  # # * * ? . . . . * * .
  # # * . . . * . * . . .
  # # . . . * . . . . . .
  # # * . * . ? * * . * .
  # # * * ? . * ? ? . . .
  # # . * * . ? * . ? ? .
  # # . . . . * . * * * .
  # # . . . . . . . . . .
  # # * ? * * . * . . . *
  # # * . * ? . . * * ? .
  # compressed = '**?....**.*...*.*......*......*.*.?**.*.**?.*??....**.?*.??.....*.***...........*?**.*...**.*?..**?.'
  # w, h = 10, 10

  board = []

  for i in range(w * h):
    neighbors = []
    board.append((i, compressed[i], neighbors))

    for dx in [-1, 0, 1]:
      if i % w + dx < 0 or i % w + dx >= w:
        continue

      for dy in [-1, 0, 1]:
        if i // w + dy < 0 or i // w + dy >= h:
          continue

        if [dx, dy] == [0, 0]:
          continue

        neighbors.append(i + dx + w * dy)

  constraints = [(compressed.count('*'), list(range(w * h)))]

  # vertical column hints
  for j in range(w):
    constraints.append((
      compressed[j::w].count('*'),
      [j + k * w for k in range(h)],
    ))

  # horizontal column hints
  for j in range(h):
    constraints.append((
      compressed[j * w:j * w + w].count('*'),
      list(range(j * w, j * w + w)),
    ))

  revealed = []

  print('board:', board)
  print('constraints:')
  pprint.pprint(constraints, width=160)

  print(Puzzle(board, revealed, constraints).solve_puzzle())


def demo3():
  # 53: Squared Square
  board = [
    (0, '?', (1, 3, 5, 6)),
    (1, '?', (0, 2, 3, 4)),
    (2, '?', (1, 4, 7, 8)),
    (3, '*', (0, 1, 2, 4, 6, 7, 9, 10)),
    (4, '.', (1, 2, 3, 7)),
    (5, '.', (0, 6, 9, 13)),
    (6, '?', (0, 3, 5, 9)),
    (7, '.', (2, 3, 4, 8, 10, 11, 12)),
    (8, '.', (2, 7, 12, 15)),
    (9, '.', (3, 5, 6, 10, 11, 13, 14)),
    (10, '?', (3, 7, 9, 11)),
    (11, '.', (7, 9, 10, 12, 14, 15, 16)),
    (12, '*', (7, 8, 11, 15)),
    (13, '*', (5, 9, 14, 16)),
    (14, '?', (9, 11, 13, 16)),
    (15, '?', (8, 11, 12, 16)),
    (16, '.', (11, 13, 14, 15)),
  ]
  revealed = [10, 11, 16]
  constraints = [
    (1, [0, 2, 13, 15]),  # pink
    (0, [1, 5, 8, 16]),  # red
    (1, [3, 7, 9, 11]),  # orange
    (1, [4, 6, 10, 12, 14]),  # yellow
    (3, list(range(17))),  # total
  ]

  print('board:', board)
  print('constraints:', constraints)

  print(Puzzle(board, revealed, constraints).solve_puzzle())


if __name__ == "__main__":
  repl = 'repl' in sys.argv

  demos = {
    '1': demo1,
    '2': demo2,
    '3': demo3,
  }

  try:
    if len(sys.argv) > 1:
      n = sys.argv[1]
      if n in demos:
        demos[n]()

    if repl:
      IPython.embed()
  except Exception:
    if repl:
      IPython.embed()
    else:
      raise
