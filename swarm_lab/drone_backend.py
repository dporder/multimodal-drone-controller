"""20 Hz Python drone brain; JavaScript supplies images and integrates physics.

Run: python -m swarm_lab.drone_backend --port 8767
Only localhost is served. No MuJoCo state or positions are advanced here.
"""
import argparse
import json
import math
import threading
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from .controller_navigation import ControllerNavigator
from .controller_geometry import segment_hits
from .trajectory_safety import coordinate_trajectories
from .controller_protocol import validate_observation
from .drone_functions import (NeuralNetwork, camera_master, camera_slave1, camera_slave2,
    environment, goal, intruder, intruder_acts, master_drone, slave1_drone, slave2_drone,
    neuralnetwork_tactics_from_master, neuralnetwork_rotor_master,
    neuralnetwork_rotor_slave1, neuralnetwork_rotor_slave2, evaluate_trajectory, master_reference_frame, rotation, unit, vector)


def along(start, route, meters):
    p = np.array(start[:2], dtype=float)
    for point in route:
        target = np.asarray(point)
        delta = target-p
        length = np.linalg.norm(delta)
        if length >= meters:
            return p+unit(delta)*meters
        p, meters = target, meters-length
    return p


class Controller:
    def __init__(self, packet):
        validate_observation(packet)
        self.lock=threading.Lock();self.cached_key=None;self.cached_response=None;self.trim=np.zeros((3,3))
        self.version = packet["version"]
        self.reference_origin = vector(packet.get("reference_origin",packet["drones"][0]["position"])).copy()
        self.map_source=environment(packet).get("map_source","known")
        if self.map_source not in ("known","observed"):raise ValueError("Unknown planning map mode")
        self.obstacles = environment(packet)["obstacles"] if self.map_source=="known" else []
        self.map_refresh_at=0.;self.map_revision=-1
        self.air = ControllerNavigator(self.obstacles)
        self.walk = ControllerNavigator(self.obstacles, .42, .9, True)
        self.recovery = ControllerNavigator(self.obstacles, .55)
        self.margin = ControllerNavigator(self.obstacles, 1.9)
        self.tactics_net = NeuralNetwork(69, 27, packet.get("seed", 7), 24)
        self.rotor_nets = [NeuralNetwork(8, 4, 470+i, 16) for i in range(3)]
        self.routes, self.exit_route = [[], [], []], []
        self.replan_at, self.offer_at, self.rest_since = 0., 0., None
        self.state, self.events, self.lost, self.reacquired_until = None, [], False, 0.
        self.sequence, self.tick_times = 0, []

    def blocker(self, start, end, margin=0.):
        return next((o for o in self.obstacles if segment_hits(start,end,o,margin)),None)

    def refresh_observed_map(self,packet):
        if self.map_source!="observed":return
        observed=environment(packet).get("observed_map") or {}
        if packet["time"]<self.map_refresh_at or observed.get("revision")==self.map_revision:return
        self.map_revision=observed.get("revision");self.map_refresh_at=packet["time"]+1.
        origin=vector(observed.get("world_origin",self.reference_origin));obstacles=[]
        for o in observed.get("objects",[]):
            lo,hi=vector(o["bounds"]["min"]),vector(o["bounds"]["max"])
            if np.any(hi<lo):raise ValueError("Invalid observed bounds")
            uncertainty=max(.1,min(.4,float(o.get("uncertainty_m",.1))*2))
            size=np.maximum(hi-lo,.12)+2*uncertainty
            semantic=o["semantic"]
            obstacles.append(dict(kind="box",position=((hi+lo)/2+origin).tolist(),size=size.tolist(),semantic=semantic,label=o["label"],
                solid=semantic!="canal",groundOnly=semantic=="canal",walkable=semantic in ("stairs","terrace","bridge"),cover=semantic in ("building","tree","wall","crate")))
        self.obstacles=obstacles;self.air=ControllerNavigator(obstacles);self.walk=ControllerNavigator(obstacles,.42,.9,True)
        self.recovery=ControllerNavigator(obstacles,.55);self.margin=ControllerNavigator(obstacles,1.9);self.replan_at=0

    def decide(self, packet, positions):
        now = packet["time"]
        person, seen = intruder(packet)
        visible = any(packet["perception"]["visible"])
        age = max(0., now-seen["time"]) if seen else 100.
        if visible and self.lost:
            self.reacquired_until = now+2
        lost = not visible and age>.25
        cover = None
        if lost and seen:
            target = np.array(seen["position"])+[0, 0, seen["height"]*.6]
            cover = self.blocker(positions[0], target)
            if cover is None:
                cover = min((o for o in self.obstacles if o.get("cover")),
                            key=lambda o: math.dist(o["position"][:2], target[:2]), default=None)
        top = cover["position"][2]+cover["size"][2 if cover["kind"]=="box" else 1]/2 if cover else 6.
        active = ["observe", "visible"]
        if packet["mode"] != "guidance":
            stage, reason = "operator_override", "Python holds the operator-assigned flight targets."
        elif lost:
            stage = "expand_search" if age>12 else "search_cover"
            reason = "Sight lost. Master raises viewpoint; slaves search separate blind spots."
            active += ["occlusion", "ascend", "split", "search"]
        elif person["status"] == "at destination" and person["intention"] == "leave via destination":
            stage, reason = "bridge_reached", "Bridge reached voluntarily. Maintain separated viewpoints."
            active += ["route", "escort", "bridge", "loiter"]
        elif self.reacquired_until>now:
            stage, reason = "reacquired", "Sensor sighting reacquired; master refreshes all three trajectories."
            active += ["reacquire", "route"]
        elif person["intention"] == "leave via destination":
            stage, reason = "escort", "Master leads to bridge; slaves escort from separate sides."
            active += ["route", "priority", "offer", "choice", "escort"]
        elif person["route_pending"] and person["route_priority"] or person["mode"] == "manual" or person["intention"] == "inspect site":
            stage, reason = "track_route", "Track independent person movement and indicate the bridge."
            active += ["route", "priority", "track"]
        elif person["refused"]:
            stage, reason = "declined", "Person declined. Maintain observation until the next offer window."
            active += ["route", "priority", "offer", "choice", "declined"]
        else:
            stage, reason = "offer", "Maintain sight and offer the bridge route after the person rests."
            active += ["route", "priority", "offer"]
        if stage != self.state:
            self.events.append(dict(time=now, state=stage, reason=reason))
            self.events = self.events[-20:]
            self.replan_at = 0
        self.state, self.lost = stage, lost
        active += ["clearance", "reposition"]
        return dict(state=stage, reason=reason, active=active, lost=lost, leader=0,
                    leader_altitude=min(10.2, max(8.2, top+1.3)) if lost else 6.6,
                    cover=dict(label=cover["label"], kind=cover["semantic"], top=top) if cover else None,
                    belief=dict(position=seen["position"], velocity=seen.get("velocity", [0,0,0]), age=age,
                                uncertainty_radius=min(12., .4+age*max(1., np.linalg.norm(seen.get("velocity", [0,0,0])))),
                                source="simulator ray sensor + RGB cameras") if seen else None,
                    events=self.events.copy())

    def plan(self, packet, cameras):
        self.refresh_observed_map(packet)
        now, drones = packet["time"], packet["drones"]
        positions = np.array([vector(d["position"]) for d in drones])
        person, seen = intruder(packet)
        tactics = self.decide(packet, positions)
        observed_map=packet["environment"].get("observed_map") or {}
        tactics["world_context"] = dict(frame="mission_origin",world_origin=self.reference_origin.tolist(),
            observed_objects=len(observed_map.get("objects",[])),source=observed_map.get("source","no observations yet"),
            navigation_prior="known simulator collision map" if self.map_source=="known" else "observed partial geometry only; unknown space not certified")
        altitudes = [tactics["leader_altitude"], 3.8, 5.2]
        goals = np.array([vector(d["goal"]) for d in drones])
        roles = ["Master · bridge route", "Slave 1 · left wing", "Slave 2 · right wing"]
        if packet["mode"] == "guidance" and seen:
            observed = np.array(seen["position"][:2])
            search = observed.copy()
            if tactics["lost"]:
                velocity = np.array(seen.get("velocity", [0,0,0])[:2])
                travel = min(7., np.linalg.norm(velocity)*min(4., now-seen["time"]))
                for d in np.arange(.25, travel+.001, .25):
                    candidate = observed+unit(velocity)*d
                    if not self.walk.segment_clear(observed, candidate):
                        break
                    search = candidate
                roles = ["Master · elevated scan", "Slave 1 · blind spot", "Slave 2 · blind spot"]
            if now >= self.replan_at:
                self.replan_at = now+1
                self.exit_route = self.walk.path(observed, goal(packet))
                direction = unit(np.asarray(self.exit_route[0] if self.exit_route else goal(packet)[:2])-observed)
                if np.linalg.norm(direction)<.1:
                    direction = np.array([0., 1.])
                lateral, selected = np.array([-direction[1], direction[0]]), []
                for i in range(3):
                    if not self.air.clear(positions[i]):
                        self.routes[i] = self.recovery.path(positions[i], self.margin.nearest(positions[i])); continue
                    side = (0, -1, 1)[i]
                    ideal = (search+lateral*side*4 if tactics["lost"] else
                             along(observed, self.exit_route, 4.5 if i==0 else 1.8)+lateral*side*2.5)
                    if tactics["state"] == "expand_search":
                        angle = math.floor((now-seen["time"]-12)/8)*math.pi/3+side*math.pi*.65
                        ideal = search+5*np.array([math.cos(angle), math.sin(angle)])
                    candidates = [ideal]+[ideal+r*np.array([math.cos(a*math.pi/6), math.sin(a*math.pi/6)]) for r in (2,4,6) for a in range(12)]
                    scored = []
                    for p in candidates:
                        if not self.air.clear(p) or any(np.linalg.norm(p-q)<=2.4 for q in selected):
                            continue
                        sight = not self.blocker(np.r_[p, altitudes[i]], np.r_[search, seen["position"][2]+seen["height"]*.6])
                        wrong = side and (p-search)@lateral*side<-.5
                        score = np.linalg.norm(p-ideal)+(0 if sight else 8)+(5 if wrong else 0)+.08*np.linalg.norm(p-positions[i,:2])
                        scored.append((score, p))
                    self.routes[i] = []
                    for _, p in sorted(scored, key=lambda v:v[0])[:16]:
                        path = self.air.path(positions[i], p)
                        if path:
                            self.routes[i] = path; selected.append(p); break
            for i, route in enumerate(self.routes):
                if len(route)>1 and math.dist(positions[i,:2], route[0])<.6 and self.air.segment_clear(positions[i], route[1]):
                    route.pop(0)
                goals[i] = np.r_[route[0] if route else positions[i,:2], altitudes[i]]
        elif packet["mode"] == "formation":
            goals = np.array([[(i-1)*1.7+1.8*math.sin(.15*now), -3+1.8*math.sin(.1*now), 3.2+.3*math.sin(.2*now)] for i in range(3)])
        contexts, speeds = [], []
        for i, d in enumerate(drones):
            delta = goals[i]-positions[i]
            angle = math.atan2(delta[1], delta[0])
            forward = min(r for j, r in enumerate(d["ranges"]) if math.cos(j*math.pi/6-angle)>.7)
            speed = 3. if np.linalg.norm(delta)>6 and forward>5 else 1.8
            if self.map_source=="observed":speed=min(.8,math.sqrt(2*2.5*max(0,forward-1.2)))
            speeds.append(speed)
            contexts.append(dict(position=positions[i], velocity=vector(d["velocity"]), goal=goals[i], speed=speed,
                                 seen_age=min(10., now-seen["time"]) if seen else 10.))
        # The teacher, learned proposal and final certificate often inspect the
        # same segment. Cache exact endpoints for this plan only; map updates
        # and later ticks always receive a fresh cache.
        clear_cache={}
        def clear(a, b):
            key=(*a,*b)
            if key not in clear_cache:
                nav = self.air if self.air.clear(a) else self.recovery
                # Rotor envelope radius is sqrt(.19²+.19²)+.095 ~= .364 m.
                clear_cache[key]=nav.segment_clear(a, b) and not self.blocker(a, b, .38) and 1.5 <= b[2] <= 10.8
            return clear_cache[key]
        curves = neuralnetwork_tactics_from_master(self.tactics_net, contexts, cameras, clear, packet["relative_coordinates"])
        curves,self.plan_diagnostics=coordinate_trajectories(curves,contexts,clear)
        self.plan_diagnostics["map_source"]=self.map_source
        for curve in curves: curve["generated_at"] = now
        tactics["orders"] = [dict(drone=i, commander=0, role=roles[i], action="Clearance unresolved · braking" if not curves[i]["validated"] else "Ascend and scan" if tactics["lost"] and i==0 else "Fast reposition" if speeds[i]==3 else "Follow local trajectory",
                                  target=curves[i]["target"], altitude=float(goals[i,2]), speed_limit=speeds[i], route_blocked=not curves[i]["validated"],
                                  waypoints=[p["position"] for p in curves[i]["points"]]) for i in range(3)]
        return tactics, goals, curves, speeds

    def tick(self, packet):
        start = time.perf_counter()
        validate_observation(packet,self.reference_origin)
        key=(packet["version"],packet.get("control_revision",0),packet["time"])
        if self.cached_key==key:return dict(self.cached_response,sequence=packet["sequence"])
        if self.cached_key and packet["time"]<self.cached_key[2]-1e-7:raise ValueError("Regressive observation time")
        if len(packet["drones"]) != 3 or len(packet["frames"]) != 3:
            raise ValueError("Exactly three aircraft and cameras required")
        cameras = [f(packet) for f in (camera_master, camera_slave1, camera_slave2)]
        tactics, goals, curves, speeds = master(goal(packet), packet["relative_coordinates"], cameras, self, packet)
        drones = packet["drones"]
        positions = np.array([d["position"] for d in drones])
        acceleration, rotor_outputs, references = [], [], []
        for i, (controller, rotor_net) in enumerate(zip((master_drone, slave1_drone, slave2_drone), (neuralnetwork_rotor_master, neuralnetwork_rotor_slave1, neuralnetwork_rotor_slave2))):
            d = drones[i]
            reference = evaluate_trajectory(curves[i], .25)
            target = np.asarray(reference["position"])
            peers = [(np.linalg.norm(positions[j]-positions[i]), positions[j]-positions[i]) for j in range(3) if j!=i]
            nearest_distance, nearest = min(peers, key=lambda p:p[0])
            R = rotation(d["quaternion"])
            obs = np.r_[target-positions[i], vector(d["velocity"]), R[:,2], vector(d["angular_velocity"]), nearest, nearest_distance, vector(d["ranges"],12), d["battery"], [0,0,0]]
            flight = controller(obs, speeds[i], curves[i])
            error=vector(reference["velocity"])-vector(d["velocity"])
            self.trim[i]=np.clip(self.trim[i]+.35*.05*error,-1.2,1.2)
            acc = flight["acceleration"]+self.trim[i]
            references.append(flight["reference"])
            velocity = vector(d["velocity"])
            for j in range(3):
                if i==j: continue
                delta = positions[i]-positions[j]
                away = np.r_[delta[:2], 0.]
                dist = np.linalg.norm(away)
                if dist<2.4 and abs(delta[2])<1.1:
                    direction = unit(away) if dist>.01 else np.array([-1. if i<j else 1.,0,0])
                    minimum = 2.5*(1.8-dist)+2.4*max(0, -velocity@direction)
                    acc += direction*max(0, minimum-acc@direction)
            for o in self.obstacles:
                if o.get("solid") is False: continue
                p, size = np.array(o["position"]), o["size"]
                h = size[2] if o["kind"]=="box" else size[1]
                if 3.45>p[2]+h/2 or positions[i,2]+.35<p[2]-h/2: continue
                away = np.r_[positions[i,:2]-p[:2], 0.]
                if o["kind"]=="box":
                    away[:2] = positions[i,:2]-np.clip(positions[i,:2], p[:2]-np.array(size[:2])/2, p[:2]+np.array(size[:2])/2)
                    clearance = np.linalg.norm(away)
                else: clearance = np.linalg.norm(away)-size[0]
                if clearance<1.8 and np.linalg.norm(away)>.001:
                    direction = unit(away)
                    acc += direction*max(0, 4*(.9-clearance)-3*velocity@direction-acc@direction)
            acc = np.clip(acc, -4, 4)
            acceleration.append(acc.tolist())
            rotor_outputs.append(rotor_net(self.rotor_nets[i], d, acc))
        person, seen = intruder(packet)
        if person["route_pending"] or person["mode"]=="manual": self.rest_since=None
        elif self.rest_since is None: self.rest_since=packet["time"]
        offer = (packet["mode"]=="guidance" and person["mode"]=="autonomous" and
                 (person["path_assigned"] or person["intention"]=="seek cover") and
                 person["intention"]!="leave via destination" and any(packet["perception"]["visible"]) and
                 self.rest_since is not None and packet["time"]>=max(self.offer_at,self.rest_since+6))
        if offer: self.offer_at=packet["time"]+15
        self.sequence += 1
        self.tick_times = (self.tick_times+[packet["time"]])[-21:]
        modules = dict(sequence=self.sequence, time=packet["time"], period_ms=50, tick_times=self.tick_times,
                       diagnostics=self.plan_diagnostics,
                       master_frame=master_reference_frame(curves,self.reference_origin),
                       observed_map=packet["environment"].get("observed_map"),
                       horizon_seconds=1, master_absolute=drones[0]["position"], slaves_relative=packet["relative_coordinates"],
                       tactics_network=self.tactics_net.metrics(), rotor_networks=rotor_outputs,
                       controller="Python · online imitation + bounded geometric fallback",
                       drones=[dict(id=i,name=("master_drone","slave1_drone","slave2_drone")[i],position=d["position"],velocity=d["velocity"],trajectory=curves[i],tracking_reference=references[i],rotors=d["motors"],command=rotor_outputs[i]["command"]) for i,d in enumerate(drones)])
        response=dict(protocol_version=2,control_revision=packet.get("control_revision",0),valid_until=packet["time"]+.05,
                    inner_loop=dict(kind="onboard_attitude",rate_hz=240,rotor_residuals=[r["residual"] for r in rotor_outputs]),
                    version=packet["version"], sequence=packet["sequence"], time=packet["time"], controller="python",
                    rotor_commands=[r["command"] for r in rotor_outputs], goals=goals.tolist(), trajectories=curves,
                    accelerations=acceleration, tactics=tactics, exit_route=self.exit_route, offer_guidance=bool(offer),
                    modules=modules, camera_times=[c["time"] for c in cameras],
                    processing_ms=(time.perf_counter()-start)*1000)
        self.cached_key=key;self.cached_response=response
        return response


def master(goal_position, relative_coordinates, cameras, controller, packet):
    """Master consumes the goal, two slave reports and three current RGB frames."""
    vector(goal_position)
    if len(relative_coordinates) != 2:
        raise ValueError("Master requires two slave-relative reports")
    for report in relative_coordinates:
        vector(report["position"])
    return controller.plan(packet, cameras)


SESSIONS = {}
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        super().setup()

    def log_message(self, *args):
        pass

    def send(self, data, status=200):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:8766")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send({})

    def do_GET(self):
        self.send(dict(service="swarm-drone-controller", physics="browser", period_ms=50))

    def do_POST(self):
        if self.path != "/control":
            self.send(dict(error="Not found"), 404); return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0<length<2_000_000:
                raise ValueError("Invalid control packet size")
            packet = json.loads(self.rfile.read(length))
            key = str(packet["session"])
            with LOCK:
                entry = SESSIONS.get(key)
                if entry is None or entry.version != packet["version"]:
                    if len(SESSIONS)>=16: SESSIONS.pop(next(iter(SESSIONS)))
                    entry = SESSIONS[key] = Controller(packet)
            with entry.lock:
                response = entry.tick(packet)
            self.send(response)
        except (ValueError, KeyError, TypeError, IndexError) as exc:
            self.send(dict(error=str(exc)), 400)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8767)
    parser.add_argument("--stdio",action="store_true",help="JSON-lines transport for deterministic integration tests")
    args=parser.parse_args()
    if args.stdio:
        controller=None
        for line in sys.stdin:
            packet=json.loads(line)
            if controller is None or controller.version!=packet["version"]:
                controller=Controller(packet)
            print(json.dumps(controller.tick(packet),allow_nan=False),flush=True)
        return
    server=ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    print(f"Python drone controller: http://127.0.0.1:{args.port} · 3 cameras / 3 paths / 12 rotors",flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
