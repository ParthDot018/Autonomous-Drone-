const GRID_SIZE = 20;
let START_NODE = [2, 2];
let GOAL_NODE = [17, 17];
let waypoints = [];
let obstacles = [];
let route = [];
let visitedNodes = new Set();
let clearingPathNodes = new Set();
let currentDronePos = null;
let flightInterval = null;
let isFlying = false;
let hasActiveRoute = false;
let flightRoute = [];
let flightRouteIndex = 0;
let activePointerId = null;
let activeBrush = null;
let activePaintAction = null;
let lastPaintedCoordinate = null;
let requestId = 0;
let pathClearId = 0;
let pathRevealId = 0;
let activeRequestController = null;

const gridContainer = document.getElementById("grid-container");
const gridMessage = document.getElementById("grid-message");
const telemetry = document.getElementById("telemetry");
const routeStatus = document.getElementById("routeStatus");
const flightDistance = document.getElementById("flightDistance");
const executionLogEntries = document.getElementById("executionLogEntries");
const planButton = document.getElementById("planBtn");
const REROUTE_THINKING_DELAY_MS = 1000;
const PATH_CLEAR_STEP_MS = 50;
const PATH_REVEAL_STEP_MS = 140;
const coordinateKey = coordinate => `${coordinate[0]},${coordinate[1]}`;

const droneStyle = document.createElement("style");
droneStyle.textContent = `
    .cell.drone-cell { position: relative; }
    .drone {
        position: absolute;
        inset: 3px;
        z-index: 2;
        border-radius: 50%;
        background-color: #ef4444;
        box-shadow: 0 0 0 2px #fff, 0 0 8px #dc2626;
        pointer-events: none;
    }
`;
document.head.appendChild(droneStyle);

const droneElement = document.createElement("span");
droneElement.className = "drone";
droneElement.setAttribute("role", "img");
droneElement.setAttribute("aria-label", "Drone in flight");

function sameCoordinate(first, second) {
    return first[0] === second[0] && first[1] === second[1];
}

function containsCoordinate(coordinates, target) {
    return coordinates.some(coordinate => sameCoordinate(coordinate, target));
}

function renderGrid() {
    for (const cell of gridContainer.children) {
        const coordinate = [Number(cell.dataset.x), Number(cell.dataset.y)];
        cell.classList.remove("start", "goal", "waypoint", "obstacle", "path", "path-reveal", "visited", "path-clearing", "drone-cell");
        const key = coordinateKey(coordinate);

        if (containsCoordinate(obstacles, coordinate)) {
            cell.classList.add("obstacle");
            cell.setAttribute("aria-label", `No-fly zone at [${coordinate.join(", ")}]`);
        } else if (sameCoordinate(coordinate, START_NODE)) {
            cell.classList.add("start");
            cell.setAttribute("aria-label", `Hub at [${coordinate.join(", ")}]`);
        } else if (sameCoordinate(coordinate, GOAL_NODE)) {
            cell.classList.add("goal");
            cell.setAttribute("aria-label", `Goal at [${coordinate.join(", ")}]`);
        } else if (containsCoordinate(waypoints, coordinate)) {
            cell.classList.add("waypoint");
            cell.setAttribute("aria-label", `Waypoint at [${coordinate.join(", ")}]`);
        } else if (visitedNodes.has(key)) {
            cell.classList.add("visited");
            cell.setAttribute("aria-label", `Visited at [${coordinate.join(", ")}]`);
        } else if (containsCoordinate(route, coordinate)) {
            cell.classList.add("path");
            cell.setAttribute("aria-label", `Flight path at [${coordinate.join(", ")}]`);
        } else {
            cell.setAttribute("aria-label", `Airspace cell [${coordinate.join(", ")}]`);
        }

        if (currentDronePos && sameCoordinate(coordinate, currentDronePos)) {
            cell.classList.add("drone-cell");
            cell.setAttribute("aria-label", `Drone at [${coordinate.join(", ")}]`);
            cell.appendChild(droneElement);
        } else if (droneElement.parentElement === cell) {
            droneElement.remove();
        }
        if (clearingPathNodes.has(key)) {
            cell.classList.add("path-clearing");
        }
    }
}

function createGrid() {
    const fragment = document.createDocumentFragment();
    for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "cell";
            cell.dataset.x = String(x);
            cell.dataset.y = String(y);
            cell.setAttribute("role", "gridcell");
            cell.setAttribute("aria-label", `Airspace cell [${x}, ${y}]`);
            fragment.appendChild(cell);
        }
    }
    gridContainer.replaceChildren(fragment);
    renderGrid();
}

function setGridMessage(message, isError = false) {
    gridMessage.textContent = message;
    gridMessage.classList.toggle("text-red-600", isError);
    gridMessage.classList.toggle("text-gray-500", !isError);
}

function appendLog(message, level = "info") {
    const emptyState = executionLogEntries.querySelector(".text-gray-400");
    if (emptyState) emptyState.remove();

    const entry = document.createElement("li");
    entry.className = level === "error"
        ? "text-red-700"
        : level === "success" ? "text-green-700" : "text-gray-700";
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    executionLogEntries.appendChild(entry);

    while (executionLogEntries.children.length > 100) {
        executionLogEntries.firstElementChild.remove();
    }
    executionLogEntries.scrollTop = executionLogEntries.scrollHeight;
}

function stopFlight() {
    if (flightInterval !== null) {
        window.clearInterval(flightInterval);
        flightInterval = null;
    }
    isFlying = false;
}

async function clearPathGradually() {
    const clearId = ++pathClearId;
    const pathToClear = route.filter(coordinate =>
        !visitedNodes.has(coordinateKey(coordinate))
    );

    for (const coordinate of pathToClear) {
        if (clearId !== pathClearId) return false;
        const key = coordinateKey(coordinate);
        clearingPathNodes.add(key);
        renderGrid();
        await new Promise(resolve => window.setTimeout(resolve, PATH_CLEAR_STEP_MS));
        if (clearId !== pathClearId) return false;

        route = route.filter(item => !sameCoordinate(item, coordinate));
        clearingPathNodes.delete(key);
        renderGrid();
    }

    return clearId === pathClearId;
}

async function revealPathGradually(path) {
    const revealId = ++pathRevealId;
    route = [];
    renderGrid();

    for (const coordinate of path) {
        if (revealId !== pathRevealId) return false;
        route.push(coordinate);
        renderGrid();
        const cell = gridContainer.querySelector(
            `.cell[data-x="${coordinate[0]}"][data-y="${coordinate[1]}"]`
        );
        if (cell && !cell.classList.contains("visited")) {
            cell.classList.add("path-reveal");
            window.setTimeout(() => cell.classList.remove("path-reveal"), 700);
        }
        await new Promise(resolve => window.setTimeout(resolve, PATH_REVEAL_STEP_MS));
    }

    return revealId === pathRevealId;
}

function cancelPendingRequest() {
    if (activeRequestController) {
        activeRequestController.abort();
        activeRequestController = null;
    }
    requestId += 1;
}

function clearDroneAndRoute(message) {
    pathClearId += 1;
    pathRevealId += 1;
    clearingPathNodes.clear();
    stopFlight();
    cancelPendingRequest();
    hasActiveRoute = false;
    currentDronePos = null;
    route = [];
    visitedNodes.clear();
    flightRoute = [];
    flightRouteIndex = 0;
    renderGrid();
    telemetry.classList.add("hidden");
    if (message) appendLog(message);
}

function getCollection(brush) {
    return brush === "obstacle" ? obstacles : waypoints;
}

function editCell(cell, brush, paintAction = null) {
    const coordinate = [Number(cell.dataset.x), Number(cell.dataset.y)];
    if (brush === "start" || brush === "goal") {
        const otherEndpoint = brush === "start" ? GOAL_NODE : START_NODE;
        if (sameCoordinate(coordinate, otherEndpoint)) {
            setGridMessage("The hub and goal must occupy different cells.", true);
            return false;
        }

        if (brush === "start") START_NODE = coordinate;
        else GOAL_NODE = coordinate;
        waypoints = waypoints.filter(item => !sameCoordinate(item, coordinate));
        obstacles = obstacles.filter(item => !sameCoordinate(item, coordinate));
        setGridMessage(`${brush === "start" ? "Hub" : "Goal"} moved to [${coordinate.join(", ")}].`);
        clearDroneAndRoute(`Flight and route cleared after moving the ${brush === "start" ? "hub" : "goal"}.`);
        renderGrid();
        return true;
    }

    if (sameCoordinate(coordinate, START_NODE) || sameCoordinate(coordinate, GOAL_NODE)) {
        setGridMessage("Waypoints and no-fly zones cannot be placed on the hub or goal.", true);
        return false;
    }

    if (
        brush === "obstacle" &&
        currentDronePos &&
        sameCoordinate(coordinate, currentDronePos) &&
        paintAction !== "remove"
    ) {
        setGridMessage("The drone currently occupies this cell; choose another cell for the no-fly zone.", true);
        return false;
    }

    const collection = getCollection(brush);
    const existing = containsCoordinate(collection, coordinate);
    const action = paintAction ?? (existing ? "remove" : "add");
    if (existing === (action === "add")) return false;

    if (action === "add") {
        const otherCollection = brush === "waypoint" ? obstacles : waypoints;
        const overlapIndex = otherCollection.findIndex(item => sameCoordinate(item, coordinate));
        if (overlapIndex !== -1) otherCollection.splice(overlapIndex, 1);
        collection.push(coordinate);
    } else {
        const index = collection.findIndex(item => sameCoordinate(item, coordinate));
        if (index !== -1) collection.splice(index, 1);
    }

    setGridMessage(`${brush === "obstacle" ? "No-fly zone" : "Waypoint"} ${action === "add" ? "added" : "removed"} at [${coordinate.join(", ")}].`);
    renderGrid();
    return true;
}

function cellFromEvent(event) {
    return event.target instanceof Element ? event.target.closest(".cell") : null;
}

function beginCellEdit(cell, brush, paintAction = null) {
    const wasFlying = isFlying;
    const priorDronePosition = currentDronePos ? [...currentDronePos] : null;
    if (brush === "obstacle" && wasFlying) {
        stopFlight();
        appendLog(`Drone paused at [${priorDronePosition.join(", ")}] for obstacle rerouting.`);
    }

    const changed = editCell(cell, brush, paintAction);
    if (!changed) {
        if (wasFlying && priorDronePosition && hasActiveRoute) {
            resumeFlight();
        }
        return;
    }

    if (brush === "obstacle") {
        if (hasActiveRoute) {
            calculateRoute({
                automatic: true,
                flightStart: priorDronePosition ?? currentDronePos
            });
        }
    } else if (brush === "waypoint") {
        clearDroneAndRoute("Flight and route cleared after changing waypoints.");
    }
}

function handlePointerDown(event) {
    if (event.button !== 0) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    event.preventDefault();

    activePointerId = event.pointerId;
    activeBrush = document.querySelector('input[name="brush"]:checked').value;
    activePaintAction = null;
    lastPaintedCoordinate = null;

    if (activeBrush === "obstacle" || activeBrush === "waypoint") {
        const coordinate = [Number(cell.dataset.x), Number(cell.dataset.y)];
        activePaintAction = containsCoordinate(getCollection(activeBrush), coordinate) ? "remove" : "add";
    }

    lastPaintedCoordinate = `${cell.dataset.x},${cell.dataset.y}`;
    beginCellEdit(cell, activeBrush, activePaintAction);
}

function handlePointerOver(event) {
    if (event.pointerId !== activePointerId || !activePaintAction) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    const coordinateKey = `${cell.dataset.x},${cell.dataset.y}`;
    if (coordinateKey === lastPaintedCoordinate) return;
    lastPaintedCoordinate = coordinateKey;
    beginCellEdit(cell, activeBrush, activePaintAction);
}

function endPointerPaint(event) {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    activeBrush = null;
    activePaintAction = null;
    lastPaintedCoordinate = null;
}

function handleKeyboardCellActivation(event) {
    if (event.detail !== 0) return;
    const cell = cellFromEvent(event);
    if (!cell) return;

    const brush = document.querySelector('input[name="brush"]:checked').value;
    const coordinate = [Number(cell.dataset.x), Number(cell.dataset.y)];
    const collection = getCollection(brush);
    const paintAction = brush === "obstacle" || brush === "waypoint"
        ? (containsCoordinate(collection, coordinate) ? "remove" : "add")
        : null;
    beginCellEdit(cell, brush, paintAction);
}

function validateRoute(path) {
    return Array.isArray(path) && path.length > 0 && path.every(node =>
        Array.isArray(node) && node.length === 2 && node.every(Number.isInteger) &&
        node.every(value => value >= 0 && value < GRID_SIZE)
    );
}

function flyDrone(path) {
    stopFlight();
    flightRoute = path.map(coordinate => [...coordinate]);
    flightRouteIndex = 0;
    currentDronePos = [...flightRoute[flightRouteIndex]];
    visitedNodes.add(coordinateKey(currentDronePos));
    renderGrid();
    isFlying = flightRouteIndex < flightRoute.length - 1;

    if (!isFlying) {
        routeStatus.textContent = "At goal";
        appendLog("Drone is at the goal; route is ready.", "success");
        return;
    }

    appendLog(`Drone taking off from [${currentDronePos.join(", ")}].`);
    flightInterval = window.setInterval(() => {
        if (flightRouteIndex >= flightRoute.length - 1) {
            stopFlight();
            routeStatus.textContent = "At goal";
            appendLog("Drone reached the goal.", "success");
            return;
        }

        flightRouteIndex += 1;
        currentDronePos = [...flightRoute[flightRouteIndex]];
        visitedNodes.add(coordinateKey(currentDronePos));
        renderGrid();
        appendLog(`Drone moved to [${currentDronePos.join(", ")}].`);

        if (flightRouteIndex >= flightRoute.length - 1) {
            stopFlight();
            routeStatus.textContent = "At goal";
            appendLog("Drone reached the goal.", "success");
        }
    }, 300);
}

function resumeFlight() {
    if (!hasActiveRoute || !flightRoute.length) return;
    flyDrone(flightRoute, currentDronePos);
}

async function calculateRoute({ automatic = false, flightStart = null } = {}) {
    pathRevealId += 1;
    if (activeRequestController) activeRequestController.abort();
    const controller = new AbortController();
    activeRequestController = controller;
    const currentRequest = ++requestId;
    const requestStart = flightStart ? [...flightStart] : [...START_NODE];
    if (!automatic) {
        stopFlight();
        currentDronePos = null;
        visitedNodes.clear();
        route = [];
        pathClearId += 1;
        clearingPathNodes.clear();
        renderGrid();
    }

    telemetry.classList.remove("hidden");
    routeStatus.textContent = automatic ? "Rerouting…" : "Planning…";
    routeStatus.className = "text-right font-semibold text-blue-700";
    flightDistance.textContent = "—";
    setGridMessage(automatic ? "Obstacle detected. Calculating a new route…" : "Calculating route…");
    appendLog(automatic
        ? `Drone paused at [${requestStart.join(", ")}]. Clearing the old path and recalculating…`
        : "Route planning requested.");

    try {
        if (automatic) {
            const cleared = await clearPathGradually();
            if (!cleared || currentRequest !== requestId) return;
            await new Promise(resolve => window.setTimeout(resolve, REROUTE_THINKING_DELAY_MS));
            if (currentRequest !== requestId) return;
        }

        const remainingWaypoints = waypoints.filter(waypoint =>
            !visitedNodes.has(coordinateKey(waypoint)) ||
            sameCoordinate(waypoint, requestStart)
        );
        const visitedObstacles = [...visitedNodes]
            .map(key => key.split(",").map(Number))
            .filter(coordinate =>
                !sameCoordinate(coordinate, requestStart) &&
                !sameCoordinate(coordinate, GOAL_NODE) &&
                !containsCoordinate(remainingWaypoints, coordinate)
            );
        const requestObstacles = [...obstacles];
        for (const coordinate of visitedObstacles) {
            if (!containsCoordinate(requestObstacles, coordinate)) {
                requestObstacles.push(coordinate);
            }
        }

        const response = await fetch("http://localhost:8000/api/plan-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                start: requestStart,
                goal: GOAL_NODE,
                waypoints: remainingWaypoints,
                obstacles: requestObstacles,
                grid_size: [GRID_SIZE, GRID_SIZE]
            })
        });
        const data = await response.json();
        if (currentRequest !== requestId) return;
        if (!response.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : "Route request failed.");
        }
        if (!validateRoute(data.route)) {
            throw new Error("The backend returned an invalid route.");
        }

        const newRoute = data.route.map(coordinate => [...coordinate]);
        if (!sameCoordinate(newRoute[0], requestStart)) {
            throw new Error("The returned route does not start at the drone's current position.");
        }

        for (const coordinate of newRoute.slice(1)) {
            if (visitedNodes.has(coordinateKey(coordinate))) {
                throw new Error("The returned route would revisit a cell already visited by the drone.");
            }
        }
        hasActiveRoute = true;
        routeStatus.textContent = "In flight";
        routeStatus.className = "text-right font-semibold text-green-700";
        flightDistance.textContent = `${data.distance} units`;
        setGridMessage(automatic ? "Drone rerouted from its current position." : "Route planned. The drone is now flying.");
        appendLog(`Route received: ${data.distance} units across ${data.route.length} cells.`, "success");
        const revealed = await revealPathGradually(newRoute);
        if (!revealed || currentRequest !== requestId) return;
        flyDrone(route);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (currentRequest !== requestId) return;

        hasActiveRoute = false;
        pathClearId += 1;
        pathRevealId += 1;
        clearingPathNodes.clear();
        stopFlight();
        currentDronePos = null;
        route = [];
        renderGrid();
        const message = error instanceof Error ? error.message : "Unexpected route planning error.";
        routeStatus.textContent = message;
        routeStatus.className = "text-right font-semibold text-red-700";
        flightDistance.textContent = "—";
        setGridMessage(message, true);
        appendLog(`Route planning failed: ${message}`, "error");
    } finally {
        if (currentRequest === requestId) activeRequestController = null;
    }
}

document.querySelectorAll('input[name="brush"]').forEach(input => {
    input.addEventListener("change", () => {
        const labels = {
            obstacle: "Add a no-fly zone to the active path to trigger an immediate reroute.",
            waypoint: "Click or drag to add/remove waypoints.",
            start: "Click a cell to move the hub.",
            goal: "Click a cell to move the goal."
        };
        setGridMessage(labels[input.value]);
        if (input.value === "start" || input.value === "goal") {
            clearDroneAndRoute(`Flight stopped after selecting the ${input.value === "start" ? "hub" : "goal"} brush.`);
        }
    });
});

gridContainer.addEventListener("pointerdown", handlePointerDown);
gridContainer.addEventListener("pointerover", handlePointerOver);
gridContainer.addEventListener("click", handleKeyboardCellActivation);
document.addEventListener("pointerup", endPointerPaint);
document.addEventListener("pointercancel", endPointerPaint);
planButton.addEventListener("click", () => calculateRoute());
document.getElementById("clearLogBtn").addEventListener("click", () => {
    executionLogEntries.replaceChildren();
    appendLog("Execution log cleared.");
});
document.getElementById("clearBtn").addEventListener("click", () => {
    START_NODE = [2, 2];
    GOAL_NODE = [17, 17];
    waypoints = [];
    obstacles = [];
    visitedNodes.clear();
    clearingPathNodes.clear();
    clearDroneAndRoute("Airspace cleared; drone removed and route reset.");
    telemetry.classList.add("hidden");
    setGridMessage("Airspace cleared. Hub and goal returned to their default positions.");
});

createGrid();
