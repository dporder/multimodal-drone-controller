"""Cached map navigation for the Python controller (no physics integration)."""
import heapq
import math


class ControllerNavigator:
    def __init__(self, obstacles, radius=1.4, z=3.8, grounded=False):
        self.obstacles, self.radius, self.z, self.grounded = obstacles, radius, z, grounded
        self.grid = [(x*.5-14, y*.5-14) for y in range(57) for x in range(57)]
        self.free = [self.clear(p) for p in self.grid]

    def surface(self, p):
        return max([0.]+[o["position"][2]+o["size"][2]/2 for o in self.obstacles
                          if o.get("walkable") and o["kind"] == "box" and
                          all(abs(p[i]-o["position"][i]) <= o["size"][i]/2+.001 for i in (0, 1))])

    def clear(self, p):
        if any(not math.isfinite(x) or abs(x)>14 for x in p[:2]):
            return False
        half = .9 if self.grounded else .35
        z_here = self.surface(p)+half if self.grounded else self.z
        for o in self.obstacles:
            if o.get("groundOnly") and not self.grounded or self.grounded and o.get("walkable"):
                continue
            x, y, z = o["position"]
            size = o["size"]
            height = size[2] if o["kind"] == "box" else size[1]
            if not o.get("groundOnly") and (z_here+half <= z-height/2+.015 or z_here-half >= z+height/2-.015):
                continue
            gap = (math.hypot(max(0, abs(p[0]-x)-size[0]/2), max(0, abs(p[1]-y)-size[1]/2))
                   if o["kind"] == "box" else math.hypot(p[0]-x, p[1]-y)-size[0])
            if gap < self.radius:
                return False
        return True

    def segment_clear(self, a, b):
        n = max(2, math.ceil(math.dist(a[:2], b[:2])/.12))
        prior = self.surface(a) if self.grounded else 0
        for i in range(n+1):
            p = (a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n)
            if not self.clear(p):
                return False
            if self.grounded:
                h = self.surface(p)
                if abs(h-prior)>.26:
                    return False
                prior = h
        return True

    def nearest(self, p):
        return tuple(p[:2]) if self.clear(p) else min((q for i, q in enumerate(self.grid) if self.free[i]), key=lambda q: math.dist(q, p[:2]))

    def path(self, start, goal):
        start, goal = tuple(start[:2]), tuple(goal[:2])
        if not self.clear(start) or not self.clear(goal):
            return []
        if self.segment_clear(start, goal):
            return [goal]
        def cell(p):
            x, y = (min(56, max(0, round((v+14)*2))) for v in p)
            candidates = [(x+dx)+(y+dy)*57 for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                          if 0 <= x+dx < 57 and 0 <= y+dy < 57]
            valid = [i for i in candidates if self.free[i] and self.segment_clear(p, self.grid[i])]
            return min(valid, key=lambda i: math.dist(p, self.grid[i])) if valid else None
        first, last = cell(start), cell(goal)
        if first is None or last is None:
            return []
        queue, came, cost, closed = [(0, first)], {}, {first: 0}, set()
        while queue:
            _, cur = heapq.heappop(queue)
            if cur in closed:
                continue
            closed.add(cur)
            if cur == last:
                points = [goal, self.grid[cur]]
                while cur in came:
                    cur = came[cur]
                    points.append(self.grid[cur])
                points.append(start)
                points.reverse()
                smooth, i = [], 0
                while i < len(points)-1:
                    j = len(points)-1
                    while j > i+1 and not self.segment_clear(points[i], points[j]):
                        j -= 1
                    if not self.segment_clear(points[i], points[j]):
                        return []
                    smooth.append(points[j]); i = j
                return smooth
            x, y = cur % 57, cur // 57
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                if not 0 <= x+dx < 57 or not 0 <= y+dy < 57:
                    continue
                nxt = cur+dx+dy*57
                if nxt in closed or not self.free[nxt] or dx and dy and (not self.free[cur+dx] or not self.free[cur+dy*57]):
                    continue
                if self.grounded and not self.segment_clear(self.grid[cur], self.grid[nxt]):
                    continue
                g = cost[cur]+math.hypot(dx, dy)
                if g < cost.get(nxt, math.inf):
                    came[nxt], cost[nxt] = cur, g
                    heapq.heappush(queue, (g+math.dist(self.grid[nxt], self.grid[last])*2, nxt))
        return []
