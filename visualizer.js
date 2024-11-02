// little bit of setup

$$ = (selector => document.querySelector(selector))

let debug = $$('#debug')
let puzzle_data = $$('#puzzle-data')
let puzzle_soln = $$('#puzzle-soln')

puzzle_data.innerText = data.puzzle.replace('\\n', '\n')
puzzle_soln.innerText = JSON.stringify(data.solution, '', '  ')

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

$$('#puzzle-id').innerText = extract(data.puzzle, 'ID', /\w+/)
$$('#puzzle-tile-text').innerText = extract(data.puzzle, 'TILE_TEXT', /\w+/)
$$('#puzzle-title').innerText = extract(data.puzzle, 'TITLE', /.+/)
$$('#puzzle-author').innerText = extract(data.puzzle, 'AUTHOR', /.+/) || 'Tudwell'
let score = extract(data.puzzle, 'SCORE', /[\d\.]+/)
if (score)
  $$('#puzzle-score').innerText = ` (score = ${score})`

let nodes = {}
let nodeIds = []
let nodesSrc = extract(data.puzzle, 'NODE', /.+?/s, true)
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

let hints = {column: [], color: []}
let columnHints = extract(data.puzzle, 'COLUMN_HINT', /.+?/s, true) || []
let colorHints = extract(data.puzzle, 'HINT', /.+?/s, true) || []

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

let cornerFlag = realBool(extract(data.puzzle, 'CORNER_FLAG', /.+/))

// now we start drawing things

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

function tileClick(event) {
  if (event.which == 2 || event.which == 3)
    event.preventDefault()

  let nodeId = event.target.id.slice(4)
  let node = nodes[nodeId]
  // console.log(event)
  if (event.which == 1) {
    // left click, reveals a tile
    setRevealed(node, true)
  }
  // Don't allow clearing reveal/flag because it doesn't make sense
  //  with regions and is hard to support.
  /*else if (event.which == 2) {
    // middle click, not used in-game but used here to clear state
    setRevealed(node, false)
    setFlagged(node, false)
  }*/ else if (event.which == 3) {
    // right click, flags a tile
    setFlagged(node, /*!node.flagged*/true)
  }
}

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

  tile.addEventListener('mousedown', tileClick)
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
})

let regionGroup = $$('#svg-regions')

function fixupRegions() {
  // (1) Go through all nodes and position region circles;
  // (2) Go through all regions and position lines between circles.

  for (const node of Object.values(nodes)) {
    const numRegions = node.regions.length
    if (numRegions === 0) continue

    // TODO Better way to fit regions?
    // Select largest rectangle that fits inside tile.
    // ... well, actually just approximate that.
    const w = node.geometryInfo.width * 0.8
    const h = node.geometryInfo.height * 0.8

    const tx = node.pos.x + node.geometryInfo.tileMinX + w/8
    const ty = node.pos.y + node.geometryInfo.tileMinY + h/8

    // select rows to maximize size (s)
    const numRows = Math.floor(h/w * numRegions)
    const numPerRow = numRegions / numRows
    const size = h / numRows

    let rowNum = 0
    let colNum = 0
    node.regions.forEach(r => {
      r.pos.x = tx+colNum*size
      r.pos.y = ty+rowNum*size
      r.pos.size = size
      r.layers.setAttribute('transform', `translate(${r.pos.x},${r.pos.y}) scale(${size})`)

      if (++colNum > numPerRow) {
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
  region.label = region.kind === RegionKinds.EXACT
    ? region.value.toString()
    : region.kind.description.replace('X', region.value.toString())
}

function updateRegionsToRemove(node) {
  const valueAdjustment = node.revealed && !node.has_mine ? 0 : -1

  for (const r of node.regions) {
    r.region.nodes.splice(r.region.nodes.indexOf(node), 1)

    // If region is now empty, remove it entirely.
    if (r.region.nodes.length === 0) {
      regions.splice(regions.indexOf(r.region), 1)
      if (r.region.display) {
        r.region.display.g.remove()
      }
      continue;
    }

    r.layers.remove()
    const nes = r.region.display.nodesAndEdges
    let i = nes.findIndex(ne => ne.node === node)
    const line = nes[i].lineFromPrev
    if (line) line.remove()
    nes.splice(i, 1)
    if (nes[0].lineFromPrev) {
      nes[0].lineFromPrev.remove()
      nes[0].lineFromPrev = undefined
    }

    if (valueAdjustment) {
      r.region.value += valueAdjustment
      setRegionLabel(r.region)
    }

    for (const ne of nes) {
      ne.text.innerHTML = r.region.label
    }
  }

  node.regions = []
  fixupRegions()
}

// From https://stackoverflow.com/a/1484514
function getRandomColor() {
  var letters = '0123456789AB';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 12)];
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
  region.display.nodesAndEdges.forEach(ne => g.append(ne.lineFromPrev));
  region.display.nodesAndEdges.forEach(ne => g.append(ne.layers));
}

let regions = [];

function generateRegionForNode(node) {
  if (!node.revealed || node.has_mine || node.secret) return

  const coveredNodes = []
  node.edges.forEach(neighborId => {
    let neighbor = nodes[neighborId]
    if (!neighbor.revealed && !neighbor.flagged) coveredNodes.push(neighbor)
  })

  const region = {
    value: node.mineCount - node.flaggedCount,
    kind: RegionKinds.EXACT,
    nodes: coveredNodes
  }

  regions.push(region)
  displayRegion(region)
}

function generateRegionForHint(hint) {
  const coveredNodes = []
  hint.ids.forEach(nodeId => {
    let node = nodes[nodeId]
    if (!node.revealed && !node.flagged) coveredNodes.push(node)
  })

  const region = {
    value: hint.mineCount - hint.flaggedCount,
    kind: RegionKinds.EXACT,
    nodes: coveredNodes
  }

  regions.push(region)
  // Do not display hint regions.
}

hints.color.forEach(generateRegionForHint)
hints.column.forEach(generateRegionForHint)

for (const node of Object.values(nodes)) {
  if (!node.revealed || node.has_mine || node.secret) continue

  generateRegionForNode(node);
}
fixupRegions()

let height = (maxY - minY) + 5 * minDist
let width = Math.max((maxX - minX) + 10 * minDist, height * 16 / 9)
let svg = $$('#svg')
// svg.setAttribute('viewBox', `${minX - width / 10} ${minY - height / 10} ${width / 2} ${height * 3 / 4}`)
svg.setAttribute('viewBox', `${minX - 3 * minDist} ${minY - 2 * minDist} ${width} ${height}`)
svg.addEventListener('focus', event => {})
svg.addEventListener('keydown', showNeighbors)
svg.addEventListener('keyup', hideNeighbors)
svg.focus()

// now for the solution stuff
let table = $$('#solution-steps')
let actionable = []  // trivial stages
data.solution.summary.push({num_ineqs: 0, done: true})

data.solution.summary.forEach((step, index) => {
  let row = document.createElement('tr')
  let round = document.createElement('td')
  let numIneqs = document.createElement('td')
  let stage = document.createElement('td')
  let revealed = document.createElement('td')
  let flagged = document.createElement('td')

  round.innerText = index
  numIneqs.innerText = step.num_ineqs

  if (step.exact)
    stage.innerText = `exact; ${step.exact.count}`
  else if (step.inexact)
    stage.innerText = `inexact; ${step.inexact.count}`
  else if (step.done) {
    stage.innerText = `(done)`
    actionable.push(index)
  }
  else if (step.trivial) {
    stage.innerText = `trivial`
    actionable.push(index)

    let spans = []
    step.trivial.revealed.forEach(nodeId => {
      let span = document.createElement('span')
      span.innerText = nodeId
      span.setAttribute('id', `span${nodeId}`)
      span.setAttribute('onmouseenter', 'tileHover(event)')
      span.setAttribute('onmouseleave', 'tileLeave(event)')
      spans.push(span.outerHTML)
    })
    revealed.innerHTML = spans.join(', ')
    
    spans = []
    step.trivial.flagged.forEach(nodeId => {
      let span = document.createElement('span')
      span.innerText = nodeId
      span.setAttribute('id', `span${nodeId}`)
      span.setAttribute('onmouseenter', 'tileHover(event)')
      span.setAttribute('onmouseleave', 'tileLeave(event)')
      spans.push(span.outerHTML)
    })
    flagged.innerHTML = spans.join(', ')
  }

  if (step.trivial || step.done)
    row.addEventListener('click', event => {
      let targetId
      if (event.target.tagName == 'TD')
        targetId = event.target.parentNode.id
      else if (event.target.tagName == 'SPAN')
        targetId = event.target.parentNode.parentNode.id
      syncBoard(actionable.indexOf(parseInt(targetId.slice(5))))
    })

  row.setAttribute('id', `round${index}`)
  row.append(round, numIneqs, stage, revealed, flagged)
  table.append(row)
})

// controls
let numRounds = actionable.length
let currentRow = 0

function syncBoard(newRow, force) {
  if (newRow < 0)
    newRow = 0
  if (newRow >= numRounds)
    newRow = numRounds - 1
  if (currentRow == newRow && !force)
    return

  $$(`#round${actionable[currentRow]}`).setAttribute('class', '')
  let index = actionable[currentRow]
  
  if (newRow > currentRow) {
    while (currentRow < newRow) {
      let trivial = data.solution.summary[index].trivial
      index += 1
      if (!trivial)
        continue

      // correct any misclicks
      trivial.revealed.forEach(nodeId => setFlagged(nodes[nodeIds[nodeId]], false))
      trivial.flagged.forEach(nodeId => setRevealed(nodes[nodeIds[nodeId]], false))

      // real state
      trivial.revealed.forEach(nodeId => setRevealed(nodes[nodeIds[nodeId]], true))
      trivial.flagged.forEach(nodeId => setFlagged(nodes[nodeIds[nodeId]], true))
      currentRow += 1
    }
  }
  else if (newRow < currentRow) {
    while (currentRow > newRow) {
      index -= 1
      let trivial = data.solution.summary[index].trivial
      if (!trivial)
        continue

      trivial.revealed.forEach(nodeId => setRevealed(nodes[nodeIds[nodeId]], false))
      trivial.flagged.forEach(nodeId => setFlagged(nodes[nodeIds[nodeId]], false))
      currentRow -= 1
    }
  }

  currentRow = newRow
  $$(`#round${actionable[currentRow]}`).setAttribute('class', 'highlight')
}

function gotoStart() {
  syncBoard(0)
}
$$('#rewind').addEventListener('click', gotoStart)

function goBack() {
  syncBoard(currentRow - 1)
}
$$('#back').addEventListener('click', goBack)

function goForward() {
  syncBoard(currentRow + 1)
}
$$('#forward').addEventListener('click', goForward)

function gotoEnd() {
  syncBoard(numRounds - 1)
}
$$('#fast-forward').addEventListener('click', gotoEnd)

$$('#scroll').addEventListener('wheel', event => {
  event.preventDefault()
  if (event.deltaY < 0)
    goBack()
  else if (event.deltaY > 0)
    goForward()
})

syncBoard(0, true)
