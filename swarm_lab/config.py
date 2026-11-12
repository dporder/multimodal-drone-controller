from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Config:
    drones: int = 3
    scene: str = "yard"
    physics_hz: int = 240
    control_hz: int = 30
    seconds: float = 30.0
    wind: float = 2.0
    randomize: bool = True
    sensor_noise: float = 0.015
    radio_loss: float = 0.05
    radio_delay: int = 2  # control frames
    mass: float = 1.2
    motor_tau: float = 0.035
    drag: float = 0.12
    downwash: bool = True

    def __post_init__(self):
        if self.drones != 3:
            raise ValueError("this environment uses exactly three drones")
        if self.scene not in ("yard", "warehouse", "forest", "office"):
            raise ValueError("scene must be yard, warehouse, forest, or office")
        if self.physics_hz < 120 or self.control_hz <= 0 or self.physics_hz % self.control_hz:
            raise ValueError("physics_hz must be >=120 and a multiple of control_hz")
        if not math.isfinite(self.seconds) or not 0 < self.seconds <= 3600:
            raise ValueError("seconds must be in (0, 3600]")
        if not math.isfinite(self.wind) or not 0 <= self.wind <= 12:
            raise ValueError("wind must be in [0, 12] m/s")
        if not 0 <= self.radio_loss <= 1 or not 0 <= self.radio_delay <= 30:
            raise ValueError("invalid radio loss or delay")
        if not 0 <= self.sensor_noise <= 1 or self.mass <= 0 or self.motor_tau <= 0 or self.drag < 0:
            raise ValueError("invalid physical parameters")
