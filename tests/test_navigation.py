import numpy as np
from swarm_lab.navigation import Navigator, Person
from swarm_lab import Config,SwarmEnv
from swarm_lab.policy import FormationPolicy


def test_route_is_clear_around_obstruction():
    obstacles=[dict(kind='box',position=[0,0,1],size=[2,4,2])]
    nav=Navigator(obstacles)
    route=nav.path([-4,0],[4,0])
    assert route
    start=np.array([-4.,0.])
    for point in route:
        assert nav.segment_clear(start,point)
        start=point
    np.testing.assert_allclose(route[-1],[4,0])


def test_person_can_accept_or_ignore_guidance_without_force():
    for probability in [0.,1.]:
        person=Person([])
        person.request_guidance(0,probability)
        rng=np.random.default_rng(7)
        for step in range(600):person.step(1/30,(step+1)/30,rng)
        if probability:
            assert person.status=='at destination'
            assert np.linalg.norm(person.position-person.destination)<.1
        else:
            assert person.refused
            assert person.intention=='inspect site'
            assert np.linalg.norm(person.position-person.destination)>2


def test_three_drones_guide_without_contact():
    env=SwarmEnv(Config(seconds=18));obs,_=env.reset(seed=7)
    policy=FormationPolicy();closest=100.
    for _ in range(540):
        obs,_,done,_,info=env.step(policy(obs))
        assert not done,info
        closest=min(closest,float(np.linalg.norm(env.q[:,:3]-(env.person+[0,0,env.actor.height/2]),axis=1).min()))
    assert env.actor.status=='at destination'
    assert closest>2.0
    assert env.collisions==0


def test_manual_run_jump_and_crouch_have_distinct_states():
    p=Person([]);p.command('manual');p.command('input',[1,0]);p.command('run')
    rng=np.random.default_rng(1)
    for i in range(60):p.step(1/30,i/30,rng)
    assert p.position[0]>3 and p.movement=='run'
    z=p.position[2];p.command('jump')
    for i in range(5):p.step(1/30,2+i/30,rng)
    assert p.position[2]>z+.2
    for i in range(60):p.step(1/30,3+i/30,rng)
    assert p.position[2]==0
    p.command('crouch');assert p.height==1.1


def test_low_surface_climb_and_cover():
    objects=[dict(kind='box',position=[2,1,.4],size=[1,1,.8],climbable=True,cover=True,label='Table')]
    p=Person(objects);p.position[:2]=[.9,1];p.command('climb')
    rng=np.random.default_rng(1)
    for i in range(100):p.step(1/30,i/30,rng)
    assert np.allclose(p.position,[2,1,.8],atol=.03)
    assert p.support=='Table'
    p=Person(objects);p.command('hide')
    for i in range(300):p.step(1/30,i/30,rng)
    assert p.status=='at cover' and p.posture=='crouching'
