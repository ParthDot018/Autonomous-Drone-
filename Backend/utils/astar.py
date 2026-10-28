import heapq
import math
from typing import List, Optional, Tuple


def heuristic(a: Tuple[int, int], b: Tuple[int, int]) -> float:
    """Return Euclidean distance between two grid coordinates."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def astar_search(
    grid_size: Tuple[int, int],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    obstacles: List[Tuple[int, int]],
) -> Optional[List[Tuple[int, int]]]:
    """Find a shortest four-directional path, including both endpoints."""
    width, height = grid_size
    if width <= 0 or height <= 0:
        return None

    def in_bounds(coordinate: Tuple[int, int]) -> bool:
        return 0 <= coordinate[0] < width and 0 <= coordinate[1] < height

    obstacle_set = set(obstacles)
    if (
        not in_bounds(start)
        or not in_bounds(goal)
        or start in obstacle_set
        or goal in obstacle_set
    ):
        return None

    open_set = [(heuristic(start, goal), start)]
    came_from: dict[Tuple[int, int], Tuple[int, int]] = {}
    g_score = {start: 0}
    f_score = {start: heuristic(start, goal)}

    while open_set:
        current_f, current = heapq.heappop(open_set)
        if current_f != f_score.get(current):
            continue

        if current == goal:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            return path[::-1]

        neighbors = (
            (current[0], current[1] - 1),
            (current[0], current[1] + 1),
            (current[0] - 1, current[1]),
            (current[0] + 1, current[1]),
        )
        for neighbor in neighbors:
            if not in_bounds(neighbor) or neighbor in obstacle_set:
                continue

            tentative_g = g_score[current] + 1
            if tentative_g >= g_score.get(neighbor, math.inf):
                continue

            came_from[neighbor] = current
            g_score[neighbor] = tentative_g
            f_score[neighbor] = tentative_g + heuristic(neighbor, goal)
            heapq.heappush(open_set, (f_score[neighbor], neighbor))

    return None
