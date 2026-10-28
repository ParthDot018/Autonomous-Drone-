from typing import List, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from utils.astar import astar_search

Coordinate = Tuple[int, int]

app = FastAPI(
    title="Drone Route Planning API",
    description="Plans autonomous delivery routes using A* pathfinding.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RoutingRequest(BaseModel):
    start: Coordinate
    goal: Coordinate
    waypoints: List[Coordinate] = Field(default_factory=list)
    obstacles: List[Coordinate] = Field(default_factory=list)
    grid_size: Coordinate = Field(default=(20, 20))


@app.post("/api/plan-route", summary="Plan or reroute a drone flight")
async def plan_route(request: RoutingRequest) -> dict:
    width, height = request.grid_size
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="Grid dimensions must be positive.")

    checkpoints = [request.start, *request.waypoints, request.goal]
    if any(
        not (0 <= x < width and 0 <= y < height)
        for x, y in [*checkpoints, *request.obstacles]
    ):
        raise HTTPException(
            status_code=400,
            detail="All route and obstacle coordinates must be inside the grid.",
        )

    full_route: List[Coordinate] = []
    for segment_start, segment_goal in zip(checkpoints, checkpoints[1:]):
        segment = astar_search(
            grid_size=request.grid_size,
            start=segment_start,
            goal=segment_goal,
            obstacles=request.obstacles,
        )
        if segment is None:
            raise HTTPException(status_code=400, detail="Airspace blocked.")
        full_route.extend(segment if not full_route else segment[1:])

    return {
        "status": "success",
        "route": full_route,
        "distance": len(full_route) - 1,
    }
