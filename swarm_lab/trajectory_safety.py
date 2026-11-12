"""Checks for physical continuity, derivative limits and shared airspace."""
import numpy as np
from .drone_functions import curve_from_controls, unit
from .controller_geometry import path_separation


def certify(curve, context, clear):
    cp=np.asarray(curve["control_points"])
    velocity_controls=3*np.diff(cp,axis=0)
    accelerations=6*(cp[2:]-2*cp[1:-1]+cp[:-2])
    speed=float(np.max(np.linalg.norm(velocity_controls,axis=1)))
    acceleration=float(np.max(np.linalg.norm(accelerations,axis=1)))
    jerk=float(np.linalg.norm(6*(cp[3]-3*cp[2]+3*cp[1]-cp[0])))
    continuous=bool(np.linalg.norm(velocity_controls[0]-context["velocity"])<1e-6)
    geometry=all(clear(np.array(a["position"]),np.array(b["position"])) for a,b in zip(curve["points"],curve["points"][1:]))
    feasible=continuous and speed<=max(context["speed"],np.linalg.norm(context["velocity"]))+.45 and acceleration<=4.001 and jerk<=12.001
    return dict(geometry_clear=bool(geometry),dynamics_feasible=bool(feasible),continuous_velocity=continuous,
                speed_bound_mps=speed,acceleration_bound_mps2=acceleration,jerk_mps3=jerk)


def braking_curve(context, clear, bias=None):
    p,v=np.asarray(context["position"]),np.asarray(context["velocity"])
    desired=np.zeros(3) if bias is None else np.asarray(bias)
    change=desired-v;end_v=v+unit(change)*min(np.linalg.norm(change),2.5)
    end=p+(v+end_v)/2
    curve=curve_from_controls([p,p+v/3,end-end_v/3,end],clear,fallback=False)
    curve.update(kind="brake" if bias is None else "yield",neural_applied=False)
    return curve


def coordinate_trajectories(curves, contexts, clear, minimum=.95):
    result=[]
    for i,(curve,context) in enumerate(zip(curves,contexts)):
        checks=certify(curve,context,clear)
        if not checks["geometry_clear"] or not checks["dynamics_feasible"]:
            curve=braking_curve(context,clear);checks=certify(curve,context,clear)
        curve.update(drone=i,validation=checks,validated=checks["geometry_clear"] and checks["dynamics_feasible"]);result.append(curve)
    interventions=0
    for i in range(3):
        for j in range(i+1,3):
            if path_separation(result[i],result[j])>=minimum:continue
            # Lower-priority aircraft yields; every alternative is checked in
            # continuous time against all three reservations, not endpoints.
            for bias in (None,[0,0,.8],[0,0,-.8],[.8,0,0],[-.8,0,0],[0,.8,0],[0,-.8,0]):
                candidate=braking_curve(contexts[j],clear,bias);checks=certify(candidate,contexts[j],clear)
                if checks["geometry_clear"] and checks["dynamics_feasible"] and all(path_separation(candidate,result[k])>=minimum for k in range(3) if k!=j):
                    candidate.update(drone=j,validation=checks,validated=True);result[j]=candidate;interventions+=1;break
    gaps=[path_separation(result[i],result[j]) for i in range(3) for j in range(i+1,3)]
    for i,curve in enumerate(result):
        separation=min(path_separation(curve,result[j]) for j in range(3) if j!=i)
        curve["validation"].update(min_predicted_separation_m=separation,separation_clear=separation>=minimum)
        curve["validated"] &= separation>=minimum
    return result,dict(min_predicted_separation_m=min(gaps),reservation_interventions=interventions,unresolved=sum(not c["validated"] for c in result))
