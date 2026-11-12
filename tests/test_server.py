import numpy as np
import pytest
from swarm_lab import Config
from swarm_lab.server import Lab


def test_exact_three_and_interventions():
    with pytest.raises(ValueError): Config(drones=6)
    lab=Lab(Config(seconds=2),seed=7)
    assert len(lab.snapshot()['drones'])==3
    lab.command({'command':'pause'})
    assert not lab.running
    lab.command({'command':'step'})
    assert lab.env.data.time == pytest.approx(1/30)
    lab.command({'command':'person','position':[0,2,0]})
    np.testing.assert_allclose(lab.env.data.mocap_pos[0],[0,2,0])
    assert lab.snapshot()['person']['position']==[0,2,0]
    assert lab.recording[-1]['command']=='person'
    assert lab.recording[-1]['time']==pytest.approx(1/30)
    with pytest.raises(ValueError): lab.command({'command':'person','position':[-1,4,0]})
    with pytest.raises(ValueError): lab.command({'command':'reset','drones':9})
    assert lab.config.drones==3
