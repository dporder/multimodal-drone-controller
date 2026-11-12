"""Deterministic navigation for a voluntary, non-contact guidance scenario."""
import heapq
import numpy as np
from .knowledge import PERSON_SPEC


class Navigator:
    def __init__(self, obstacles, radius=.42, z=.9):
        self.obstacles, self.radius, self.z = obstacles, radius, z
        self.spacing = .5
        self.low, self.high = -14., 14.
        self.width = 57
        self.occupied = np.zeros((self.width, self.width), dtype=bool)
        for x in range(self.width):
            for y in range(self.width):
                self.occupied[x,y] = not self.clear(self.point((x,y)))

    def clear(self, p):
        if np.any(np.abs(p[:2]) > 14): return False
        for o in self.obstacles:
            center=np.array(o['position']); size=np.array(o['size'])
            if o['kind']=='box':
                if not center[2]-size[2]/2-self.radius <= self.z <= center[2]+size[2]/2+self.radius:
                    continue
                delta=np.maximum(np.abs(np.asarray(p[:2])-center[:2])-size[:2]/2,0)
                if np.linalg.norm(delta) < self.radius:return False
            else:
                if center[2]-size[1]/2-self.radius <= self.z <= center[2]+size[1]/2+self.radius:
                    if np.linalg.norm(np.asarray(p[:2])-center[:2]) < size[0]+self.radius:return False
        return True

    def cell(self,p):
        return tuple(np.clip(np.rint((np.asarray(p[:2])-self.low)/self.spacing),0,self.width-1).astype(int))

    def point(self,c):
        return np.asarray(c,dtype=float)*self.spacing+self.low

    def segment_clear(self,a,b):
        return all(self.clear(a+(b-a)*u) for u in np.linspace(0,1,max(2,int(np.linalg.norm(b-a)/.1)+2)))

    def path(self,start,goal):
        start,goal=np.asarray(start[:2],dtype=float),np.asarray(goal[:2],dtype=float)
        if not self.clear(start) or not self.clear(goal):return []
        if self.segment_clear(start,goal):return [goal.copy()]
        a,b=self.cell(start),self.cell(goal)
        queue=[(0.,a)];came={};cost={a:0.}
        while queue:
            _,cur=heapq.heappop(queue)
            if cur==b:
                cells=[cur]
                while cur in came:cur=came[cur];cells.append(cur)
                points=[start]+[self.point(c) for c in cells[::-1]]+[goal]
                # Visibility smoothing retains obstacle clearance along each segment.
                smooth=[];i=0
                while i<len(points)-1:
                    j=len(points)-1
                    while j>i+1 and not self.segment_clear(points[i],points[j]):j-=1
                    if not self.segment_clear(points[i],points[j]):return []
                    smooth.append(points[j]);i=j
                return smooth
            for dx,dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
                nxt=(cur[0]+dx,cur[1]+dy)
                if not (0<=nxt[0]<self.width and 0<=nxt[1]<self.width):continue
                if self.occupied[nxt] or (dx and dy and (self.occupied[cur[0]+dx,cur[1]] or self.occupied[cur[0],cur[1]+dy])):continue
                g=cost[cur]+np.hypot(dx,dy)
                if g<cost.get(nxt,np.inf):
                    cost[nxt]=g;came[nxt]=cur
                    heapq.heappush(queue,(g+np.hypot(nxt[0]-b[0],nxt[1]-b[1]),nxt))
        return []

    def nearest_clear(self,p):
        if self.clear(p):return np.asarray(p[:2])
        candidates=[self.point((x,y)) for x in range(self.width) for y in range(self.width) if not self.occupied[x,y]]
        return min(candidates,key=lambda q:np.linalg.norm(q-np.asarray(p[:2])))


class Person:
    def __init__(self,obstacles):
        self.navigator=Navigator(obstacles)
        self.position=np.array([0.,1.,0.])
        self.velocity=np.zeros(3)
        self.heading=0.
        self.mode='autonomous'
        self.movement='walk'
        self.posture='standing'
        self.height=PERSON_SPEC['standing_height']
        self.manual_input=np.zeros(2)
        self.jump_velocity=0.
        self.climb_target=None
        self.crouch_on_arrival=False
        self.support='ground'
        self.memory=[]
        self.intention='inspect site'
        self.status='walking independently'
        self.compliance=.85
        self.guidance=False
        self.decision_at=None
        self.refused=False
        self.destination=np.array([11.,1.,0.])
        self.route=[]
        self.events=[]
        self.inspection_goal=self.navigator.nearest_clear([8.,-2.])
        self.set_goal(self.inspection_goal)

    def set_goal(self,p):
        self.route=self.navigator.path(self.position,np.asarray(p))
        self.goal=np.r_[np.asarray(p[:2]),0.]
        self.status='walking independently' if self.route else 'route unavailable'

    def request_guidance(self,t,probability=None):
        if probability is not None:
            if not np.isfinite(probability) or not 0<=probability<=1:raise ValueError('response probability must be in [0, 1]')
            self.compliance=probability
        self.mode='autonomous'
        self.guidance=True
        self.refused=False
        self.decision_at=t+.5
        self.events.append(dict(time=t,text='Route guidance offered; awaiting independent response.'))

    def command(self,action,value=None):
        if action=='manual':
            self.mode='manual';self.status='operator control';self.guidance=False;self.decision_at=None
            self.intention='operator controlled'
        elif action=='autonomous':
            self.mode='autonomous';self.manual_input[:]=0;self.intention='inspect site';self.set_goal(self.inspection_goal)
        elif action=='input':
            direction=np.asarray(value,dtype=float)
            if direction.shape!=(2,) or not np.all(np.isfinite(direction)):raise ValueError('movement input must be two finite values')
            self.manual_input=direction/max(1.,np.linalg.norm(direction))
        elif action in ('walk','run'):
            self.movement=action
        elif action=='crouch':
            self.posture='standing' if self.posture=='crouching' else 'crouching'
            self.height=PERSON_SPEC['crouch_height' if self.posture=='crouching' else 'standing_height']
        elif action=='jump':
            if abs(self.jump_velocity)<.01 and self.climb_target is None:
                self.jump_velocity=PERSON_SPEC['jump_speed'];self.movement='jump'
        elif action=='climb':
            candidates=[o for o in self.navigator.obstacles if o.get('climbable') and o['position'][2]+o['size'][2]/2<=1.1]
            for o in sorted(candidates,key=lambda o:np.linalg.norm(np.array(o['position'][:2])-self.position[:2])):
                gap=np.maximum(np.abs(self.position[:2]-np.array(o['position'][:2]))-np.array(o['size'][:2])/2,0)
                if np.linalg.norm(gap)<1.:
                    self.climb_target=np.array([*o['position'][:2],o['position'][2]+o['size'][2]/2]);self.support=o.get('label','surface');self.status='climbing low surface';self.mode='manual';return
            raise ValueError('Move within 1 m of a marked low table to climb')
        elif action=='hide':
            choices=[]
            for o in self.navigator.obstacles:
                if not o.get('cover') or o.get('ceiling'):continue
                p=np.array(o['position'][:2]);extent=np.array(o['size'][:2])/2 if o['kind']=='box' else np.array([o['size'][0]]*2)
                for axis in [np.array([1.,0]),np.array([-1.,0]),np.array([0.,1]),np.array([0.,-1.])]:
                    point=p+axis*(extent+.65)
                    if self.navigator.clear(point):choices.append(point)
            for point in sorted(choices,key=lambda p:np.linalg.norm(p-self.position[:2])):
                route=self.navigator.path(self.position,point)
                if route:
                    self.mode='autonomous';self.intention='seek cover';self.guidance=False;self.decision_at=None
                    self.set_goal(point);self.crouch_on_arrival=True;self.status='moving to cover';return
            raise ValueError('No reachable cover point')
        else:raise ValueError('unknown person action')

    def _vertical(self,dt):
        if self.climb_target is not None:
            delta=self.climb_target-self.position
            distance=np.linalg.norm(delta)
            self.velocity=delta/max(distance,1e-8)*.65
            self.position+=delta*min(1.,.65*dt/max(distance,1e-8))
            if distance<.03:
                self.position=self.climb_target.copy();self.climb_target=None;self.velocity[:]=0;self.status='standing on surface'
            return True
        floor=0.
        for o in self.navigator.obstacles:
            if not o.get('climbable'):continue
            top=o['position'][2]+o['size'][2]/2
            if np.all(np.abs(self.position[:2]-np.array(o['position'][:2]))<np.array(o['size'][:2])/2) and self.position[2]>=top-.03:
                floor=max(floor,top)
        if self.jump_velocity>0 or self.position[2]>floor+.001:
            self.jump_velocity-=9.81*dt
            self.position[2]+=self.jump_velocity*dt
            if self.position[2]<=floor:
                self.position[2]=floor;self.jump_velocity=0.;self.movement='walk'
        self.velocity[2]=self.jump_velocity
        self.navigator.z=self.position[2]+self.height/2
        return False

    def step(self,dt,t,rng):
        if self._vertical(dt):return
        if self.decision_at is not None and t>=self.decision_at:
            self.decision_at=None
            if rng.random()<self.compliance:
                self.intention='leave via destination'
                self.set_goal(self.destination)
                self.status='following route voluntarily' if self.route else 'route unavailable'
                self.events.append(dict(time=t,text='Person chooses to follow the indicated route.'))
            else:
                self.refused=True
                self.status='guidance ignored · operator alert'
                self.events.append(dict(time=t,text='Person ignores guidance. Operator attention required; drones hold position.'))
        speed=PERSON_SPEC['max_run_speed' if self.movement=='run' else 'max_walk_speed']
        if self.posture=='crouching':speed*=.45
        if self.mode=='manual':
            desired=self.manual_input*speed
            delta=self.manual_input.copy();distance=np.linalg.norm(delta)
        else:
            if not self.route:
                self.velocity[:2]=0
                return
            delta=self.route[0]-self.position[:2]
            distance=np.linalg.norm(delta)
            desired=delta/max(distance,1e-8)*min(speed,distance/dt)
        dv=desired-self.velocity[:2]
        self.velocity[:2]+=dv*min(1,1.8*dt/max(np.linalg.norm(dv),1e-8))
        candidate=self.position[:2]+self.velocity[:2]*dt
        if self.navigator.segment_clear(self.position[:2],candidate):
            self.position[:2]=candidate
            if np.linalg.norm(self.velocity[:2])>.05:self.heading=float(np.arctan2(self.velocity[1],self.velocity[0]))
        else:
            self.velocity[:]=0
            self.route=self.navigator.path(self.position,self.goal)
        if self.mode!='manual' and self.route and np.linalg.norm(delta)<.08:
            self.route.pop(0)
            if not self.route:
                self.velocity[:]=0
                self.status='at destination' if self.intention=='leave via destination' else 'at cover' if self.intention=='seek cover' else 'inspecting site'
                if self.crouch_on_arrival:
                    self.posture='crouching';self.height=PERSON_SPEC['crouch_height'];self.crouch_on_arrival=False
                self.events.append(dict(time=t,text='Person reached their chosen destination.'))

    def snapshot(self):
        return dict(position=self.position.tolist(),velocity=self.velocity.tolist(),heading=self.heading,
                    intention=self.intention,status=self.status,mode=self.mode,radius=.28,height=self.height,
                    movement=self.movement,posture=self.posture,support=self.support,
                    guidance=self.guidance,refused=self.refused,compliance=self.compliance,
                    goal=self.goal.tolist(),route=[p.tolist() for p in self.route],events=self.events[-8:])
