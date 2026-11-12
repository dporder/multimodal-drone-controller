"""Validate sensor/control context before updating any learned model."""
import math
import numpy as np
from .drone_functions import vector


def validate_observation(packet, origin=None):
    def finite_tree(value):
        if isinstance(value,float) and not math.isfinite(value):raise ValueError("Non-finite observation")
        if isinstance(value,dict):
            for v in value.values():finite_tree(v)
        elif isinstance(value,list):
            for v in value:finite_tree(v)
    finite_tree(packet)
    now=float(packet["time"])
    if not math.isfinite(now) or now<0:raise ValueError("Invalid simulation time")
    revision=packet.get("control_revision",0)
    if not isinstance(revision,int) or revision<0:raise ValueError("Invalid control revision")
    if len(packet["drones"])!=3 or len(packet["frames"])!=3:raise ValueError("Exactly three aircraft and cameras required")
    vector(packet["goal"])
    if "reference_origin" in packet:
        given=vector(packet["reference_origin"])
        if origin is not None and not np.allclose(given,origin,atol=1e-9,rtol=0):raise ValueError("Episode origin changed")
    for drone in packet["drones"]:
        if drone.get("angular_velocity_frame","body")!="body":raise ValueError("Expected body angular velocity")
        for field in ("position","velocity","angular_velocity","goal"):vector(drone[field])
        q=vector(drone["quaternion"],4)
        if np.linalg.norm(q)<1e-8:raise ValueError("Zero quaternion")
        ranges=vector(drone["ranges"],12)
        if np.any(ranges<0):raise ValueError("Negative range")
        battery=float(drone["battery"])
        if not math.isfinite(battery) or not 0<=battery<=1:raise ValueError("Invalid battery")
    reports=packet["relative_coordinates"]
    if len(reports)!=2 or [r["drone"] for r in reports]!=[1,2]:raise ValueError("Expected two identified slave reports")
    for report in reports:
        vector(report["position"])
        if not math.isfinite(float(report["age"])) or report["age"]<0:raise ValueError("Invalid report age")
    perception=packet["perception"]
    if len(perception["visible"])!=3:raise ValueError("Invalid visibility observations")
    seen=perception.get("last_seen")
    if seen:
        vector(seen["position"]);vector(seen["velocity"])
        if not math.isfinite(float(seen["time"])) or seen["time"]>now+1e-6:raise ValueError("Future sighting")
    if packet.get("protocol_version")==2:
        for i,frame in enumerate(packet["frames"]):
            pose=frame["pose"]
            for field in ("position","direction","up"):vector(pose[field])
            if np.linalg.norm(np.cross(pose["direction"],pose["up"]))<1e-6:raise ValueError("Degenerate camera axes")
            if not 1<float(pose["fov"])<179:raise ValueError("Invalid camera FOV")
    env=packet["environment"]
    if env.get("map_source","known")=="observed":
        observed=env.get("observed_map") or {}
        if "world_origin" in observed and origin is not None and not np.allclose(vector(observed["world_origin"]),origin,atol=1e-9,rtol=0):raise ValueError("Observed map origin changed")
        for obj in observed.get("objects",[]):
            lo,hi=vector(obj["bounds"]["min"]),vector(obj["bounds"]["max"])
            if np.any(hi<lo) or float(obj.get("uncertainty_m",.1))<0:raise ValueError("Invalid observed bounds or uncertainty")
            if not isinstance(obj.get("semantic"),str) or not isinstance(obj.get("label"),str):raise ValueError("Missing landmark semantics")
