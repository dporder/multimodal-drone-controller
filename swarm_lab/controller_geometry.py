"""Conservative swept-body checks, including vertical cylinder end caps."""
import numpy as np


def segment_hits(start, end, obstacle, margin=0.):
    a,b,c=np.asarray(start,float),np.asarray(end,float),np.asarray(obstacle["position"],float)
    d=b-a;s=obstacle["size"]
    if obstacle.get("solid") is False:return False
    if obstacle["kind"]=="box":
        half=np.asarray(s)/2+margin;lo,hi=c-half,c+half;near,far=0.,1.
        for k in range(3):
            if abs(d[k])<1e-12:
                if not lo[k]<=a[k]<=hi[k]:return False
            else:
                u,v=sorted(((lo[k]-a[k])/d[k],(hi[k]-a[k])/d[k]));near=max(near,u);far=min(far,v)
        return near<=far
    radius,half=s[0]+margin,s[1]/2+margin;q=a-c
    near,far=0.,1.
    if abs(d[2])<1e-12:
        if abs(q[2])>half:return False
    else:
        u,v=sorted(((-half-q[2])/d[2],(half-q[2])/d[2]));near=max(near,u);far=min(far,v)
    aa=float(d[:2]@d[:2]);bb=2*float(q[:2]@d[:2]);cc=float(q[:2]@q[:2])-radius*radius
    if aa<1e-12:return cc<=0 and near<=far
    disc=bb*bb-4*aa*cc
    if disc<0:return False
    u,v=sorted(((-bb-np.sqrt(disc))/(2*aa),(-bb+np.sqrt(disc))/(2*aa)))
    return max(near,u)<=min(far,v)


def path_separation(first, second):
    """Conservative synchronous separation across sample intervals.

    Linear-segment minima are reduced by each cubic's interpolation error
    bound (max acceleration * dt² / 8), so a between-sample bend is covered.
    """
    a=np.asarray([p["position"] for p in first["points"]]);b=np.asarray([p["position"] for p in second["points"]]);r=a-b
    delta=r[1:]-r[:-1];den=np.sum(delta*delta,axis=1)
    t=np.clip(-np.sum(r[:-1]*delta,axis=1)/np.maximum(den,1e-12),0,1)
    distance=float(np.min(np.linalg.norm(r[:-1]+t[:,None]*delta,axis=1)))
    def error(curve):
        if "control_points" not in curve:return 0.
        cp=np.asarray(curve["control_points"]);h=curve.get("horizon_seconds",1.)
        acceleration=6*(cp[2:]-2*cp[1:-1]+cp[:-2])/h**2
        dt=max(b["t"]-a["t"] for a,b in zip(curve["points"],curve["points"][1:]))
        return float(np.max(np.linalg.norm(acceleration,axis=1)))*dt**2/8
    return max(0.,distance-error(first)-error(second))
