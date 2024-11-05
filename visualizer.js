// little bit of setup

$$ = (selector => document.querySelector(selector))

let debug = $$('#debug')
let puzzle_data = $$('#puzzle-data')

let nodes = {}
let nodeIds = []
let hints = {column: [], color: []}

function setRevealed(node, revealed) {
  if (node.revealed == revealed || node.flagged)
    return
  node.revealed = revealed

  if (node.revealed) {
    $$(`#tile${node.id}`).setAttribute('fill', 'rgba(0, 0, 0, 0)')
    generateRegionForNode(node)
    updateRegionsToRemove(node)
  }
  else {
    $$(`#tile${node.id}`).setAttribute('fill', node.color)
    // Redoing regions for unrevealing node is unsupported.
  }
}

function setFlagged(node, flagged) {
  if (node.flagged == flagged || node.revealed)
    return
  node.flagged = flagged

  if (node.flagged) {
    $$(`#tile${node.id}`).setAttribute('fill', 'white')
    updateRegionsToRemove(node)
  }
  else {
    $$(`#tile${node.id}`).setAttribute('fill', node.color)
    // Redoing regions for unflagging node is unsupported.
  }

  node.edges.forEach(neighborId => {
    let neighbor = nodes[neighborId]
    neighbor.flaggedCount += nodes[node.id].flagged ? 1 : -1
    if (!neighbor.has_mine && !neighbor.secret)
      $$(`#text${neighborId}`).innerHTML = neighbor.mineCount - neighbor.flaggedCount
  })

  // update column and color hints
  hints.column.forEach((hint, index) => {
    if (hint.ids.indexOf(node.id) == -1)
      return

    hint.flaggedCount += node.flagged ? 1 : -1
    $$(`#columnhint${index}`).innerHTML = hint.mineCount - hint.flaggedCount
  })
  hints.color.forEach((hint, index) => {
    if (hint.ids.indexOf(node.id) == -1)
      return

    hint.flaggedCount += node.flagged ? 1 : -1
    $$(`#colorhint${index}`).innerHTML = hint.mineCount - hint.flaggedCount
  })
}

let currentPuzzleData = undefined
function loadPuzzle(puz) {
  if (!puz) return

  currentPuzzleData = puz
  puzzle_data.innerText = currentPuzzleData

  // parse the puzzle

  function extract(src, tag, regex, all) {
    let matcher = new RegExp(`<${tag}>${regex.source}</${tag}>`, regex.flags + 'g')
    let len = tag.length
    let match = src.match(matcher)
    if (match) {
      if (all)
        return match
      else
        return match[0].slice(len + 2, -(len + 3));
    }
    else
      return null;
  }

  function makePos(data) {
    return {x: parseFloat(data[0]), y: parseFloat(data[1])}
  }

  function makePoly(data) {
    let points = []
    for (let i = 0; i < data.length / 2; i += 1) {
      points.push(makePos(data.slice(2 * i, 2 * i + 2)))
    }
    return points
  }

  function realBool(data) {
    return data != null && data.toLowerCase() == 'true'
  }

  $$('#puzzle-id').innerText = extract(currentPuzzleData, 'ID', /\w+/)
  $$('#puzzle-tile-text').innerText = extract(currentPuzzleData, 'TILE_TEXT', /\w+/)
  $$('#puzzle-title').innerText = extract(currentPuzzleData, 'TITLE', /.+/)
  $$('#puzzle-author').innerText = extract(currentPuzzleData, 'AUTHOR', /.+/) || 'Tudwell'
  let score = extract(currentPuzzleData, 'SCORE', /[\d\.]+/)
  if (score)
    $$('#puzzle-score').innerText = ` (score = ${score})`

  nodes = {}
  nodeIds = []
  let nodesSrc = extract(currentPuzzleData, 'NODE', /.+?/s, true)
  nodesSrc.forEach(nodeSrc => {
    let nodeId = extract(nodeSrc, 'ID', /\d+/)
    let node = nodes[nodeId] = {}

    nodeIds.push(nodeId)
    node.id = nodeId
    node.src = nodeSrc
    node.edges = extract(nodeSrc, 'EDGES', /.+/).split(',')
    node.pos = makePos(extract(nodeSrc, 'POS', /.+/).split(','))
    node.poly = makePoly(extract(nodeSrc, 'POINTS', /.+/).split(','))
    node.has_mine = realBool(extract(nodeSrc, 'HAS_MINE', /.+/))
    node.secret = realBool(extract(nodeSrc, 'SECRET', /.+/))  // tiles with '?'
    node.revealed = realBool(extract(nodeSrc, 'REVEALED', /.+/))  // tiles that start cleared
    node.flagged = false
    node.color = 'gray'
    node.regions = []
  })

  hints = {column: [], color: []}
  let columnHints = extract(currentPuzzleData, 'COLUMN_HINT', /.+?/s, true) || []
  let colorHints = extract(currentPuzzleData, 'HINT', /.+?/s, true) || []

  columnHints.forEach(hintSrc => {
    let hint = {type: 'column'}
    hint.ids = extract(hintSrc, 'IDS', /.+/).split(',')
    hint.location = makePos(extract(hintSrc, 'TEXT_LOCATION', /.+/).split(','))
    hint.rotation = parseFloat(extract(hintSrc, 'TEXT_ROTATION', /.+/))
    hint.size = parseFloat(extract(hintSrc, 'TEXT_SIZE_FACTOR', /.+/))
    hints.column.push(hint)
  })

  colorHints.forEach(hintSrc => {
    let hint = {type: 'color'}
    hint.ids = extract(hintSrc, 'IDS', /.+/).match(/\d+/g)
    hint.color = extract(hintSrc, 'COLOR', /.+/)
    hint.is_dark = realBool(extract(hintSrc, 'IS_DARK', /.+/)) ? 'dark' : ''
    hints.color.push(hint)

    hint.ids.forEach(nodeId => nodes[nodeId].color = hint.is_dark + hint.color)
  })

  // gray color hint
  let grayHint = {type: 'color', ids: [], color: 'gray', is_dark: ''}
  nodeIds.forEach(nodeId => {
    if (nodes[nodeId].color == 'gray')
      grayHint.ids.push(nodeId)
  })
  hints.color.unshift(grayHint)

  let cornerFlag = realBool(extract(currentPuzzleData, 'CORNER_FLAG', /.+/))

  // now we start drawing things


  let highlightNeighbors = false
  let hoveredId = ''

  function tileHover(event) {
    if (event.target.tagName != 'polygon' && (event.target.tagName != 'svg' || !hoveredId))
      return

    let nodeId = event.target.tagName == 'polygon' ? event.target.id.slice(4) : hoveredId
    $$(`#overlay${nodeId}`).setAttribute('display', 'visible')
    $$(`#node-id-display`).innerText = nodeId
    nodes[nodeId].edges.forEach(neighborId => $$(`#overlay${neighborId}`).setAttribute('display', highlightNeighbors ? 'visible' : 'none'))
    hoveredId = nodeId
  }

  function tileLeave(event) {
    if (event.target.tagName != 'polygon')
      return

    let nodeId = event.target.id.slice(4)
    $$(`#overlay${nodeId}`).setAttribute('display', 'none')
    $$(`#node-id-display`).innerText = ''
    nodes[nodeId].edges.forEach(neighborId => $$(`#overlay${neighborId}`).setAttribute('display', 'none'))
    hoveredId = ''
  }

  function showNeighbors(event) {
    if (highlightNeighbors)
      return

    if (event.ctrlKey) {
      highlightNeighbors = true
      tileHover(event)
    }
  }

  function hideNeighbors(event) {
    if (!highlightNeighbors)
      return

    highlightNeighbors = false
    tileHover(event)
  }

  let maxX = maxY = 0
  let minX = minY = minDist = Infinity
  let tiles = $$('#svg-tiles')
  tiles.replaceChildren()
  $$('#svg-overlay').replaceChildren()
  nodeIds.forEach(nodeId => {
    let tile = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    let node = nodes[nodeId]

    tile.setAttribute('id', `tile${nodeId}`)
    tile.setAttribute('x', node.pos.x)
    tile.setAttribute('y', node.pos.y)

    let tileMinX = tileMaxX = tileMinY = tileMaxY = 0
    let sumX = sumY = 0
    let pointstr = ''
    node.poly.forEach(point => {
      let px = point.x
      let py = point.y
      pointstr += `${px},${py} `

      tileMinX = Math.min(tileMinX, px)
      tileMaxX = Math.max(tileMaxX, px)
      tileMinY = Math.min(tileMinY, py)
      tileMaxY = Math.max(tileMaxY, py)
      sumX += px
      sumY += py
    })
    tile.setAttribute('points', pointstr)

    let centerX = (tileMinX + tileMaxX) / 2
    let centerY = (tileMinY + tileMaxY) / 2
    let minPointDist = (tileMaxX - tileMinX) + (tileMaxY - tileMinY)

    node.poly.forEach(point => {
      let px = point.x
      let py = point.y
      minPointDist = Math.min(minPointDist, ((px - centerX) ** 2 + (py - centerY) ** 2) ** 0.5)
    })
    minDist = Math.min(minDist, minPointDist)

    node.geometryInfo = {tileMinX, tileMaxX, tileMinY, tileMaxY, minPointDist,
      width: tileMaxX - tileMinX, height: tileMaxY - tileMinY}

    tile.setAttribute('fill', !node.revealed ? node.color : 'rgba(0, 0, 0, 0)')
    tile.setAttribute('stroke', 'lightgray')

    let overlay = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    overlay.setAttribute('id', `overlay${nodeId}`)
    overlay.setAttribute('points', pointstr)
    overlay.setAttribute('stroke', 'rgba(200, 200, 0, 0.75)')
    overlay.setAttribute('fill', 'rgba(200, 200, 100, 0.2)')
    overlay.setAttribute('pointer-events', 'none')
    overlay.setAttribute('display', 'none')

    let text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    let char = ''
    if (node.has_mine)
      char = '*'
    else if (node.secret)
      char = '?'
    else {
      let mineCount = 0
      node.edges.forEach(nodeId => {
        if (nodes[nodeId].has_mine)
          mineCount += 1
      })
      if (mineCount)
        char = mineCount

      node.mineCount = mineCount
      node.flaggedCount = 0
    }
    text.innerHTML = char
    text.setAttribute('id', `text${nodeId}`)
    text.setAttribute('x', (tileMinX + tileMaxX) / 2)
    text.setAttribute('y', (tileMinY + tileMaxY) / 2 + 1)
    text.setAttribute('fill', char == '*' ? 'red' : 'lightgray')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('text-anchor', 'middle')

    let layers = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    layers.append(text)
    layers.append(tile)
    layers.setAttribute('transform', `translate(${node.pos.x},${node.pos.y})`)
    overlay.setAttribute('transform', `translate(${node.pos.x},${node.pos.y})`)
    $$('#svg-overlay').append(overlay)

    minX = Math.min(minX, node.pos.x + tileMinX)
    maxX = Math.max(maxX, node.pos.x + tileMaxX)
    minY = Math.min(minY, node.pos.y + tileMinY)
    maxY = Math.max(maxY, node.pos.y + tileMaxY)

    tile.addEventListener('mouseenter', tileHover)
    tile.addEventListener('mouseleave', tileLeave)
    tile.addEventListener('contextmenu', e => e.preventDefault())

    tiles.append(layers)
  })

  // set font size and stroke width
  nodeIds.forEach(nodeId => {
    $$(`#text${nodeId}`).setAttribute('font-size', `${minDist}px`)
    $$(`#tile${nodeId}`).setAttribute('stroke-width', `${minDist / 20}`)
    $$(`#overlay${nodeId}`).setAttribute('stroke-width', `${minDist / 5}`)
  })

  // column hints
  let columnGroup = $$('#svg-column-hints')
  columnGroup.replaceChildren()
  hints.column.forEach((hint, index) => {
    let text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    let mineCount = 0
    hint.ids.forEach(nodeId => {
      if (nodes[nodeId].has_mine)
        mineCount += 1
    })
    hint.mineCount = mineCount
    hint.flaggedCount = 0

    text.innerHTML = mineCount
    text.setAttribute('id', `columnhint${index}`)
    text.setAttribute('x', hint.location.x)
    text.setAttribute('y', hint.location.y + 1)
    text.setAttribute('rotate', hint.rotation)
    text.setAttribute('fill', 'yellow')
    text.setAttribute('font-size', `${minDist * hint.size}px`)
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('text-anchor', 'middle')

    columnGroup.append(text)
  })

  // color hints
  let colorGroup = $$('#svg-color-hints')
  colorGroup.replaceChildren()
  hints.color.forEach((hint, index) => {
    let text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    let mineCount = 0
    hint.ids.forEach(nodeId => {
      if (nodes[nodeId].has_mine)
        mineCount += 1
    })
    hint.mineCount = mineCount
    hint.flaggedCount = 0

    text.innerHTML = mineCount
    text.setAttribute('id', `colorhint${index}`)
    text.setAttribute('x', minX - 3 * minDist)
    text.setAttribute('y', minY + index * (2 * minDist))
    text.setAttribute('fill', hint.is_dark + hint.color)
    text.setAttribute('font-size', `${minDist}px`)
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('text-anchor', 'middle')

    colorGroup.append(text)
  })

  initializeRegions()

  let height = (maxY - minY) + 5 * minDist
  let width = Math.max((maxX - minX) + 10 * minDist, height * 16 / 9)
  let svg = $$('#svg')
  // svg.setAttribute('viewBox', `${minX - width / 10} ${minY - height / 10} ${width / 2} ${height * 3 / 4}`)
  svg.setAttribute('viewBox', `${minX - 3 * minDist} ${minY - 2 * minDist} ${width} ${height}`)
  svg.addEventListener('focus', event => {})
  svg.addEventListener('keydown', showNeighbors)
  svg.addEventListener('keyup', hideNeighbors)
  svg.focus()
}

const RegionKinds = Object.freeze({
  WILD: Symbol("?"),
  EXACT: Symbol("=X"),
  AT_MOST: Symbol("X-"),
  AT_LEAST: Symbol("X+"),
  OR_PLUS_2: Symbol("X/X+2"),
  OR_PLUS_3: Symbol("X/X+3"),
  OR_PLUS_2_4: Symbol("X/X+2/X+4"),
  OR_PLUS_2_4_6: Symbol("X/X+2/X+4/X+6"),
  NOT: Symbol("!X"),
  OR_PLUS_2_MULTIPLE: Symbol("X+2*"),
  OR_PLUS_1: Symbol("X/X+1"),
  OR_PLUS_1_2: Symbol("X/X+1/X+2"),

  MARK_CELL: Symbol("MARK_CELL"),
  CHANGE_VISIBILITY: Symbol("CHANGE_VISIBILITY"),
})
const RegionKindsEnum = [
  RegionKinds.WILD,
  RegionKinds.EXACT,
  RegionKinds.AT_MOST,
  RegionKinds.AT_LEAST,
  RegionKinds.OR_PLUS_2,
  RegionKinds.OR_PLUS_3,
  RegionKinds.OR_PLUS_2_4,
  RegionKinds.OR_PLUS_2_4_6,
  RegionKinds.NOT,
  RegionKinds.OR_PLUS_2_MULTIPLE,
  RegionKinds.OR_PLUS_1,
  RegionKinds.OR_PLUS_1_2,
]
RegionKindsEnum[100] = RegionKinds.MARK_CELL
RegionKindsEnum[101] = RegionKinds.CHANGE_VISIBILITY

let regionGroup = $$('#svg-regions')

function fixupRegions() {
  // (1) Go through all nodes and position region circles;
  // (2) Go through all regions and position lines between circles.

  for (const node of Object.values(nodes)) {
    const numRegions = node.regions.filter(r => r.pos !== undefined).length
    if (numRegions === 0) continue

    // TODO Better way to fit regions?
    // Select largest rectangle that fits inside tile.
    // ... well, actually just approximate that.
    const w = node.geometryInfo.width * 0.8
    const h = node.geometryInfo.height * 0.8

    const tx = node.pos.x + node.geometryInfo.tileMinX + node.geometryInfo.width*0.1
    const ty = node.pos.y + node.geometryInfo.tileMinY + node.geometryInfo.height*0.1

    // select rows to maximize size (s)
    let numRows = Math.floor(h/w * Math.sqrt(numRegions))
    const numPerRow = Math.floor(numRegions / numRows)
    numRows = Math.ceil(numRegions / numPerRow)
    const size = Math.min(h / numRows, w / numPerRow)

    let rowNum = 0
    let colNum = 0
    node.regions.filter(r => r.pos !== undefined).forEach(r => {
      r.pos.x = tx+colNum*size
      r.pos.y = ty+rowNum*size
      r.pos.size = size
      r.layers.setAttribute('transform', `translate(${r.pos.x},${r.pos.y}) scale(${size})`)

      if (++colNum >= numPerRow) {
        colNum = 0
        ++rowNum
      }
    })
  }

  for (const region of regions) {
    if (!region.display) continue
    for (let i = 1; i < region.display.nodesAndEdges.length; i++) {
      const prevPos = region.display.nodesAndEdges[i-1].pos
      const current = region.display.nodesAndEdges[i]
      const currentPos = current.pos
      const line = current.lineFromPrev

      line.setAttribute('x1', prevPos.x + prevPos.size/2)
      line.setAttribute('y1', prevPos.y + prevPos.size/2)
      line.setAttribute('x2', currentPos.x + currentPos.size/2)
      line.setAttribute('y2', currentPos.y + currentPos.size/2)
    }
  }
}

function setRegionLabel(region) {
  let label;
  const x = region.value
  const exact = x.toString()
  if (region.kind === RegionKinds.EXACT) {
    label = exact
  } else if (region.kind === RegionKinds.OR_PLUS_1) {
    label = `${x}/${x+1}`
  } else if (region.kind === RegionKinds.OR_PLUS_1_2) {
    label = `${x}/${x+1}/${x+2}`
  } else if (region.kind === RegionKinds.OR_PLUS_2) {
    label = `${x}/${x+2}`
  } else if (region.kind === RegionKinds.OR_PLUS_2_4) {
    label = `${x}/${x+2}/${x+4}`
  } else if (region.kind === RegionKinds.OR_PLUS_2_4_6) {
    label = `${x}/${x+2}/${x+4}/${x+6}`
  } else if (region.kind === RegionKinds.OR_PLUS_2_MULTIPLE) {
    label = x === 0 ? "2*" : `${x}+2*`
  } else if (region.kind === RegionKinds.OR_PLUS_3) {
    label = `${x}/${x+3}`
  } else {
    label = region.kind.description.replace('X', exact)
  }

  region.label = label
}

function updateRegionsToRemove(node) {
  const valueAdjustment = node.revealed && !node.has_mine ? 0 : -1

  for (const r of node.regions) {
    const nidx = r.region.nodes.indexOf(node)
    if (nidx !== -1) r.region.nodes.splice(nidx, 1)
    else throw new Error("Node to remove not found?")

    // If region is now empty, remove it entirely.
    if (r.region.nodes.length === 0) {
      const ridx = regions.indexOf(r.region)
      if (ridx !== -1) regions.splice(ridx, 1)
      else throw new Error("Empty region not in regions?")
      if (r.region.display) {
        r.region.display.g.remove()
      }
      continue;
    }

    if (valueAdjustment) {
      r.region.value += valueAdjustment

      if (r.region.value < 0) {
        // TODO Is this right?
        trash_region(r.region)
        continue
      }

      if (r.region.label) setRegionLabel(r.region)
    }

    if (r.layers) r.layers.remove()
    if (r.region.display) {
      const nes = r.region.display.nodesAndEdges
      let i = nes.findIndex(ne => ne.node === node)
      const line = nes[i].lineFromPrev
      if (line) line.remove()
      nes.splice(i, 1)
      if (nes[0].lineFromPrev) {
        nes[0].lineFromPrev.remove()
        nes[0].lineFromPrev = undefined
      }

      for (const ne of nes) {
        ne.text.innerHTML = r.region.label
      }
    }

    enqueRegion(r.region)
  }

  node.regions = []
  fixupRegions()
}

// From https://stackoverflow.com/a/1484514
function getRandomColor() {
  var letters = '0123456789';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 10)];
  }
  return color;
}

function displayRegion(region) {
  setRegionLabel(region)

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const col = getRandomColor()
  g.setAttribute('fill', col)
  g.setAttribute('stroke', 2)
  regionGroup.append(g)
  region.display = { g, nodesAndEdges: [] }

  let lineFromPrev = undefined
  region.nodes.forEach(node => {
    let layers = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    let circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', 0.5)
    circle.setAttribute('cy', 0.5)
    circle.setAttribute('r', 0.5)
    let text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.innerHTML = region.label
    text.setAttribute('x', 0.5)
    text.setAttribute('y', 0.5)
    text.setAttribute('fill', 'darkgrey')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('font-size', `1px`)
    // TODO Only do this if it's too long?
    text.setAttribute('textLength', `0.8px`)
    text.setAttribute('lengthAdjust', `spacingAndGlyphs`)

    layers.append(circle)
    layers.append(text)

    const pos = {x: undefined, y: undefined, size: undefined}
    node.regions.push({region, layers, pos})

    region.display.nodesAndEdges.push({node, pos, layers, text, lineFromPrev})

    lineFromPrev = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    lineFromPrev.setAttribute('stroke-width', 3)
    lineFromPrev.setAttribute('stroke', col)
  })

  // Add all at end to get lines below labels.
  region.display.nodesAndEdges.forEach(ne => {
    if (ne.lineFromPrev) g.append(ne.lineFromPrev)
  });
  region.display.nodesAndEdges.forEach(ne => g.append(ne.layers));
}

let nextRegionId = 0
function registerRegion(region) {
  // Region was re-queued because it was modified.
  if (region.id !== undefined) return true
  region.id = nextRegionId++

  region.nodes = region.nodes.filter(n => {
    if (n.flagged || n.revealed && n.has_mine) region.value--

    return !(n.flagged || n.revealed)
  })

  if (region.nodes.length === 0) return false

  if (region.value < 0) {
    // TODO Is this right? Probably not.
    region.value = 0

    return false
  }

  if (isExistingRegion(region)) return false

  if (region.visible) {
    displayRegion(region)
  } else {
    // Do not display hint regions, but still have backreferences.
    for (const node of region.nodes) {
      node.regions.push({region, layers: undefined, pos: undefined})
    }
  }

  regions.push(region)
  return true
}

let regionQueue = []
function enqueRegion(region) {
  if (region.priority === undefined) {
    throw new Error("Region has no priority.");
  }

  const subQueue = regionQueue.find(q => q.priority === region.priority)
  if (!subQueue) {
    regionQueue.push({ priority: region.priority, queue: [region] })
    regionQueue.sort((a, b) => b.priority - a.priority)
  } else {
    subQueue.queue.push(region)
  }
}

function dequeRegion() {
  if (regionQueue.length === 0) return undefined
  const subQueue = regionQueue[0]
  if (subQueue.queue.length === 1) regionQueue.shift()
  return subQueue.queue.shift()
}

let regions = [];
let trashed_regions = []

function generateRegionForNode(node) {
  if (!node.revealed || node.has_mine || node.secret) return

  const coveredNodes = []
  node.edges.forEach(neighborId => {
    let neighbor = nodes[neighborId]
    if (!neighbor.revealed && !neighbor.flagged) coveredNodes.push(neighbor)
  })
  if (coveredNodes.length === 0) return

  const region = {
    value: node.mineCount - node.flaggedCount,
    kind: RegionKinds.EXACT,
    nodes: coveredNodes,
    sourceKind: 'node',
    source: node,
    visible: true,
    priority: 3,
  }

  enqueRegion(region)
}

function generateRegionForHint(hint) {
  const coveredNodes = []
  hint.ids.forEach(nodeId => {
    let node = nodes[nodeId]
    if (!node.revealed && !node.flagged) coveredNodes.push(node)
  })
  if (coveredNodes.length === 0) return

  const region = {
    value: hint.mineCount - hint.flaggedCount,
    kind: RegionKinds.EXACT,
    nodes: coveredNodes,
    sourceKind: 'hint',
    source: hint,
    visible: false,
    priority: 3,
  }

  enqueRegion(region)
}

function initializeRegions() {
  regionQueue = []
  regions = []
  trashed_regions = []
  regionGroup.replaceChildren()

  hints.color.forEach(generateRegionForHint)
  hints.column.forEach(generateRegionForHint)

  for (const node of Object.values(nodes)) {
    if (!node.revealed || node.has_mine || node.secret) continue

    generateRegionForNode(node);
  }
  fixupRegions()
  displayRegionDebugInfo()
}

function loadRules() {
  const varBitmasks = []
  for (let mask = 0; mask < (1 << 6); mask++) {
    const arr = []
    for (let i = 0; i < 6; i++) {
      if (mask & (1 << i)) arr.push(i)
    }
    varBitmasks[mask] = arr
  }
  function interpret_bombe_region(num) {
    const value = num & 0xff
    num >>= 8
    const kind = RegionKindsEnum[num & 0xff]
    num >>= 8
    const varBitmask = num & 0xff
    return { value, kind, vars: varBitmasks[varBitmask] }
  }

  return rules_from_bombe.rules.map(b => {
    const square_counts = b.square_counts.map(interpret_bombe_region)
    const region_type = b.region_type.map(interpret_bombe_region)
    const apply_region_type = interpret_bombe_region(b.apply_region_type)
    return {
      bombe_rule: b,
      apply_region_type,
      region_type,
      square_counts,
      square_counts_vars: square_counts.map(s => new Set(s.vars)).reduce((a, b) => a.union(b)),
      priority: apply_region_type.kind === RegionKinds.MARK_CELL || apply_region_type.kind === RegionKinds.CHANGE_VISIBILITY ? 3 : b.priority
    }
  }).filter(r => !r.bombe_rule.paused)
}
const rules = loadRules()
const actionRules = rules.filter(r => r.priority === 3)
const regionRules = rules.filter(r => r.priority !== 3)


function hide_region(region) {
  if (!regions.includes(region) || !region.display) return false
  for (const node of region.nodes) {
    const info = node.regions.find(r => r.region === region)
    info.pos = undefined
    info.layers = undefined
  }
  region.display.g.remove()
  region.display = undefined
  region.visible = false
  return true
}

function trash_region(region) {
  if (region.display) region.display.g.remove()
  for (const node of region.nodes) {
    const idx = node.regions.findIndex(r => r.region === region)
    if (idx !== -1) node.regions.splice(idx, 1)
    // TODO This should never happen.
    //else throw new Error("Region not in display?")
  }
  const ridx = regions.indexOf(region)
  if (ridx !== -1) regions.splice(ridx, 1)
  //else throw new Error("Trashed region not found")
  trashed_regions.push(region)
}

function isExistingRegion(newRegion) {
  const nodesSet = new Set(newRegion.nodes)

  function inRegionList(list) {
    return list.findIndex(r => r.value === newRegion.value && r.kind === newRegion.kind && r.nodes.length === newRegion.nodes.length && nodesSet.isSubsetOf(new Set(r.nodes))) !== -1
  }

  return inRegionList(regions) || inRegionList(trashed_regions)
}

// Brute force enumerate all valid variable assignments
function enumerableVariableAssignments(args) {
  // argument as object to not get confused over argument order
  const varsSumTo = args.matchedValue - args.pattern.value
  const existingVars = args.existingVars ?? [{}]
  const newVars = existingVars.flatMap(vars => {
    let remainingVarsSumTo = varsSumTo
    let remainingVars = []
    for (const neededVar of args.pattern.vars) {
      const existing = vars[neededVar]
      if (existing === undefined) {
        remainingVars.push(neededVar)
      } else {
        remainingVarsSumTo -= existing
      }
    }

    function withAllSumsTo(vars, remainingVars, remainingVarsSumTo) {
      if (remainingVars.length === 0 && remainingVarsSumTo === 0) return [vars]
      else if (remainingVarsSumTo < 0) return []
      else if (remainingVars.length === 0) return []

      const newRemainingVars = remainingVars.slice(1)
      const res = []
      for (let i = 0; i <= remainingVarsSumTo; i++) {
        const newVars = {...vars}
        newVars[remainingVars[0]] = i
        res.push(...withAllSumsTo(newVars, newRemainingVars, remainingVarsSumTo - i))
      }
      return res
    }

    return withAllSumsTo(vars, remainingVars, remainingVarsSumTo)
  })

  return newVars
}

function displayRegionDebugInfo() {
  document.getElementById("regionDebugInfo").textContent = JSON.stringify({
    numRegions: regions.length,
    numVisibleRegions: regions.filter(r => r.visible).length,
    numHiddenRegions: regions.filter(r => !r.visible).length,
    numTrashedRegions: trashed_regions.length,
    queueSizes: regionQueue.map(q => ({priority: q.priority, length: q.queue.length})),
  }, undefined, 2)
}

function _oneRegionStep() {
  let nextRegion;
  while (nextRegion = dequeRegion()) {
    if (nextRegion.priority === 4) {
      // Not really an region, but an action.
      if (nextRegion.kind === RegionKinds.CHANGE_VISIBILITY) {
        if (nextRegion.visiblityChangeKind === 'hide') {
          if (!nextRegion.visiblityChangeRegions.map(hide_region).some(b => b)) {
            // Didn't actually hide anything, so don't consider this as
            // having done something.
            continue
          }
        } else if (nextRegion.visiblityChangeKind === 'trash') {
          nextRegion.visiblityChangeRegions.forEach(trash_region)
        } else {
          throw new Error("Unexpected visiblityChangeKind: " + nextRegion.visiblityChangeKind)
        }
      } else if (nextRegion.kind === RegionKinds.MARK_CELL) {
        if (nextRegion.markKind === 'reveal') {
          for (const node of nextRegion.nodes) {
            if (node.has_mine) {
              throw new Error("Regions revealed a mine!")
            }
            setRevealed(node, true)
          }
        } else if (nextRegion.markKind === 'flag') {
          for (const node of nextRegion.nodes) {
            if (!node.has_mine) {
              throw new Error("Regions flagged a non-mine!")
            }
            setFlagged(node, true)
          }
        } else {
          throw new Error("Unexpected markKind: " + nextRegion.markKind)
        }
      }

      // Only do one action per step.
      return
    }

    if (registerRegion(nextRegion)) break
  }
  if (!nextRegion) return

  applyRegionRules(nextRegion)
}

function oneRegionStep() {
  _oneRegionStep()
  fixupRegions()
  displayRegionDebugInfo()
}

let stepsPerIteration = 1;
function regionStep() {
  for (let i = 0; i < stepsPerIteration; i++) {
    _oneRegionStep()
  }

  fixupRegions()
  displayRegionDebugInfo()
}

let intervalID = undefined;
let stepDelay = 100;
function startRegionStepping() {
  intervalID = setInterval(regionStep, stepDelay)
}
function stopRegionStepping() {
  clearInterval(intervalID)
  intervalID = undefined;
}
function startOrPauseRegions() {
  if (intervalID) stopRegionStepping()
  else startRegionStepping()
}
function setStepDelay(newDelay) {
  stepDelay = newDelay
  stopRegionStepping()
  startRegionStepping()
}
function setSpeed(speed) {
  setStepDelay(1000/speed.valueAsNumber)
}

function applyRegionRules(nextRegion) {
  for (const rule of rules) {
    let proposedRegions = [{regions: []}]
    for (const region_type of rule.region_type) {
      const nextProposedRegions = []
      for (const prefix of proposedRegions) {
        for (const region of regions) {
          //if (region.nodes.length > 30) continue
          // Can't use a region multiple times.
          if (prefix.regions.includes(region)) continue
          // Must use the new region.
          if (prefix.regions.length === rule.region_type.length - 1 &&
            !(region === nextRegion || prefix.regions.includes(nextRegion))) {
            continue
          }

          // Does region match region_type and can it be added to prefix?
          if (region_type.kind === RegionKinds.WILD) {
            nextProposedRegions.push({...prefix, regions: [...prefix.regions, region]})
          }
          if (region.kind !== region_type.kind) continue
          if (region_type.vars.length > 0) {
            const newVars = enumerableVariableAssignments({
              matchedValue: region.value,
              pattern: region_type,
              existingVars: prefix.possibleVars,
            })

            if (newVars.length > 0) {
              nextProposedRegions.push({...prefix,
                possibleVars: newVars,
                regions: [...prefix.regions, region]})
            }
          } else if (region_type.value === region.value) {
            nextProposedRegions.push({...prefix, regions: [...prefix.regions, region]})
          }
        }
      }
      proposedRegions = nextProposedRegions
    }

    function selectNodes(proposed) {
      const nodesByMask = []
      for (let mask = 0; mask < rule.square_counts.length; mask++) {
        nodesByMask[mask] = []
      }

      const nodesByRegion = proposed.regions.map(r => new Set(r.nodes))
      const allNodes = nodesByRegion.reduce((a, b) => a.union(b))
      for (const node of allNodes) {
        let mask = 0
        for (let i = 0; i < nodesByRegion.length; i++) {
          mask |= nodesByRegion[i].has(node) ? (1 << i) : 0
        }
        nodesByMask[mask].push(node)
      }
      return nodesByMask
    }

    // Check square counts
    proposedRegions = proposedRegions.filter(proposed => {
      proposed.nodes = selectNodes(proposed)

      if (rule.square_counts_vars.size > 0 && !proposed.possibleVars) {
        proposed.possibleVars = [{}]
      }

      if (proposed.possibleVars) {
        if (proposed.possibleVars.length === 0) {
          // Shouldn't get here... but definitely invalid if we do.
          return false
        } else if (proposed.possibleVars.length > 1 || rule.square_counts_vars.isSubsetOf(new Set(Object.keys(proposed.possibleVars[0])))) {
          // Should be able to fix all var values using exact regions.
          for (let i = 0; i < rule.square_counts.length; i++) {
            const square_count = rule.square_counts[i]
            const numNodes = proposed.nodes[i].length

            if (square_count.vars.length === 0) continue
            if (square_count.kind !== RegionKinds.EXACT) continue

            const newVars = enumerableVariableAssignments({
              matchedValue: numNodes,
              pattern: square_count,
              existingVars: proposed.possibleVars,
            })

            if (newVars.length === 0) return false
            proposed.possibleVars = newVars
          }
        }

        //if (proposed.possibleVars.length > 1) {
          //throw new Error("Unbounded variables?")
        //} else {
          proposed.vars = proposed.possibleVars[0]
        //}
      }

      for (let i = 0; i < rule.square_counts.length; i++) {
        const square_count = rule.square_counts[i]
        const numNodes = proposed.nodes[i].length
        const square_value = square_count.value + square_count.vars.map(v => proposed.vars[v]).reduce((a,b) => a+b, 0)

        if (square_count.kind === RegionKinds.WILD) {
          // Anything is okay.
        } else if (square_count.kind === RegionKinds.EXACT) {
          if (numNodes !== square_value) return false
        } else if (square_count.kind === RegionKinds.NOT) {
          if (numNodes === square_value) return false
        } else if (square_count.kind === RegionKinds.AT_MOST) {
          if (numNodes > square_value) return false
        } else if (square_count.kind === RegionKinds.AT_LEAST) {
          if (numNodes < square_value) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_1) {
          if (numNodes != square_value && numNodes != square_value + 1) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_1_2) {
          if (numNodes != square_value && numNodes != square_value + 1 && numNodes != square_value + 2) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_2_4) {
          if (numNodes != square_value && numNodes != square_value + 2 && numNodes != square_value + 4) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_2_4_6) {
          if (numNodes != square_value && numNodes != square_value + 2 && numNodes != square_value + 4 && numNodes != square_value + 6) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_2_MULTIPLE) {
          if (numNodes < square_value || ((numNodes - square_value) % 2) !== 0) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_2) {
          if (numNodes != square_value && numNodes != square_value + 2) return false
        } else if (square_count.kind === RegionKinds.OR_PLUS_3) {
          if (numNodes != square_value && numNodes != square_value + 3) return false
        } else {
          // Should be unreachable.
          throw new Error("Unsupported region kind: " + square_count.kind)
        }
      }

      return true
    })

    // If there's any remaining regions, apply rule to the first set.
    for (const proposed of proposedRegions) {
      let newRegion = undefined

      if (rule.apply_region_type.kind === RegionKinds.CHANGE_VISIBILITY) {
        const changedRegions = []
        for (let i = 0; i < proposed.regions.length; i++) {
          if (rule.bombe_rule.apply_region_bitmap & (1 << i)) {
            changedRegions.push (proposed.regions[i])
          }
        }

        enqueRegion({
          kind: RegionKinds.CHANGE_VISIBILITY,
          visiblityChangeKind: rule.apply_region_type.value === 1 ? 'hide' : 'trash',
          visiblityChangeRegions: changedRegions,
          priority: 4,
        })
      } else {
        const nodesToApply = []
        for (let i = 0; i < rule.square_counts.length; i++) {
          if (rule.bombe_rule.apply_region_bitmap & (1 << i)) {
            nodesToApply.push(...proposed.nodes[i])
          }
        }
        if (nodesToApply.length === 0) continue

        if (rule.apply_region_type.kind === RegionKinds.MARK_CELL) {
          const markKind = rule.apply_region_type.value === 0 ? 'reveal' : 'flag'
          enqueRegion({
            kind: RegionKinds.MARK_CELL,
            markKind,
            nodes: nodesToApply,
            priority: 4,
          })
          if (markKind === 'reveal' && nodesToApply.find(n => n.has_mine)) {
            throw new Error("Reveal request for node with mine.")
          } else if (markKind === 'flag' && nodesToApply.find(n => !n.has_mine)) {
            throw new Error("Flag request for node without mine.")
          }
        } else {
          const newRegionValue = rule.apply_region_type.value + rule.apply_region_type.vars.map(i => proposed.vars[i]).reduce((a, b) => a+b, 0)
          newRegion = {
            value: newRegionValue,
            kind: rule.apply_region_type.kind,
            nodes: nodesToApply,
            sourceKind: 'rule',
            source: {rule, predecessors: proposed},
            visible: true,
            priority: rule.priority, // TODO Use region priorities?
          }

          if (!isExistingRegion(newRegion)) enqueRegion(newRegion)
        }
      }
    }
  }
}

// TODO Load puzzle from file/localStorage
loadPuzzle(data.puzzle.replace('\\n', '\n'))

$$('#reload-puzzle').addEventListener('click', () => loadPuzzle(currentPuzzleData))
