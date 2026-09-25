"""The dispatch simulator, once, for every scenario that needs one.

Not a pipeline step - it has no number and writes nothing. `pipeline/31` (one fleet over the whole
territory) and `pipeline/32` (a licensed area fleet beside the taxis) both import it, and so will
anything that follows.

Why it exists. Those two started as copies of the same minute-by-minute loop, and the scenarios
still queued up - only at night, licences in and taxi licences out - would each have been another
copy. Four copies of a dispatch loop is four places for a fix to be forgotten.

What a fleet is. Everything the scenarios differ by turns out to be three fields:

    size     how many vehicles
    area     which zones it may PICK UP in (None: anywhere). Where it may drive is not restricted -
             a vehicle stops wherever it set its passenger down, inside the area or not, and then
             waits for work it is allowed to take. That drift is the real regional-licence problem
             and the model must not hide it.
    hours    which hours of the day it may pick up in, as [start, end); wraps past midnight, so
             (22, 6) is an overnight service.

One fleet, no area, all day is pipeline/31. Two fleets, one with an area, is pipeline/32. A night
service is the same with `hours`. Licences in and out is the same with two sizes. No new code.

The loop, every minute:
  1. Vehicles that finish become idle where they set the passenger down.
  2. Requests whose minute has come join the queue; anyone waiting longer than `max_wait_min` gives up.
  3. Each waiting request, longest-waiting first, goes to the nearest idle vehicle among the fleets
     allowed to serve it - nearest by travel time, and never further than `max_pickup_min`.
  4. That vehicle drives empty to the pickup, carries the passenger, and is idle at the destination.

Two clocks. `requests` counts arrivals in that hour; everything else counts what HAPPENED in that
hour. A request arriving at 08:58 and picked up at 09:03 is an arrival in the 8 o'clock row and a
service in the 9 o'clock row, so the rows only balance over the whole day.

Determinism. Fleets are placed in the order given, each with one draw from the same generator, so
the same fleets in the same order always give the same answer.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Fleet:
    """One group of vehicles under one operating rule."""

    name: str
    size: int
    area: np.ndarray | None = None  # zone mask it may pick up in; None means anywhere
    hours: tuple[int, int] = (0, 24)  # [start, end), wrapping past midnight
    # Time off the road. Two different things, because they happen for two different reasons:
    #   break_min   a driver's shift change, meal and rest - so many minutes a day, at a time of that
    #               vehicle's own choosing. Staggered on purpose: the census shows taxi traffic flat
    #               from 07:00 to 22:00 with no dip anywhere, so Hong Kong's handovers do not happen
    #               together, and a model that stops the whole fleet at 17:00 would be inventing one.
    #   range_km    a battery. Usage-driven, not time-driven: a vehicle drives until it has used its
    #               range, then stands still for recharge_min wherever it happens to be.
    # A taxi has the first and not the second; a self-driving car has the second and not the first.
    break_min: float = 0.0
    range_km: float | None = None
    recharge_min: float = 0.0

    def serves_hour(self, hour: int) -> bool:
        start, end = self.hours
        return start <= hour < end if start < end else (hour >= start or hour < end)

    def serves_zone(self, zone: int) -> bool:
        return True if self.area is None else bool(self.area[zone])


@dataclass
class Result:
    """What one run produced."""

    hourly: pd.DataFrame  # 24 rows, the columns below
    by_zone: pd.DataFrame  # one row per origin zone: requests, served, gave_up, wait_sum
    left_waiting: int  # still in the queue when the day ends
    violations: int  # services that broke a fleet's area or hours; must be 0


def _place(rng: np.random.Generator, fleet: Fleet, origins: np.ndarray, minutes_of: np.ndarray,
           zones: int) -> np.ndarray:
    """Start a fleet where the first hour's demand it may serve is - what an operator would do."""
    first = minutes_of < 60
    if fleet.area is not None:
        first = first & fleet.area[origins]
    sample = origins[first]
    if not len(sample) and fleet.area is not None:
        sample = origins[fleet.area[origins]]
    weights = np.bincount(sample, minlength=zones).astype(float)
    if fleet.area is not None:
        weights[~fleet.area] = 0.0
    if weights.sum():
        weights /= weights.sum()
    elif fleet.area is None:
        weights[:] = 1 / zones
    else:
        weights[fleet.area] = 1 / fleet.area.sum()
    return rng.multinomial(fleet.size, weights).astype(np.int64)


def simulate(requests: pd.DataFrame, minutes: np.ndarray, kilometres: np.ndarray,
             factor: np.ndarray, fleets: list[Fleet], *, seed: int, zones: int,
             max_wait_min: float = 15.0, max_pickup_min: float = 20.0,
             boarding_min: float = 1.0, watch: np.ndarray | None = None) -> Result:
    """Run one day. `requests` needs the columns o, d and minute, sorted by minute.

    `watch` is a zone mask to report separately - requests arriving there, services starting there,
    and their waiting time - whatever fleet served them. It is deliberately not tied to a fleet's
    licensed area: a scenario has to be able to measure one district while running no fleet in it,
    which is what makes the "no deployment" baseline an independent path rather than the same run
    with a zero passed in.
    """
    origins = requests["o"].to_numpy(dtype=np.int32, copy=False)
    destinations = requests["d"].to_numpy(dtype=np.int32, copy=False)
    arrival = requests["minute"].to_numpy(dtype=np.int32, copy=False)
    starts = np.searchsorted(arrival, np.arange(1441), side="left")

    rng = np.random.default_rng(seed)
    # Vehicles are individuals now, because a battery belongs to one of them: `zone_of` is where each
    # sits, `run_km` how far it has driven since it last charged. A zone's idle vehicles are a set, so
    # taking one out costs nothing whether it is being dispatched or going off for its break.
    idle, zone_of, run_km, idle_at = [], [], [], []
    for fleet in fleets:
        counts = _place(rng, fleet, origins, arrival, zones)
        where = np.repeat(np.arange(zones), counts).astype(np.int32)
        idle.append(counts)
        zone_of.append(where)
        run_km.append(np.zeros(fleet.size, dtype=np.float64))
        at_zone: list[set] = [set() for _ in range(zones)]
        for v, z in enumerate(where):
            at_zone[z].add(v)
        idle_at.append(at_zone)
    # minute -> (vehicle, zone it becomes idle in)
    releases: list[list[list[tuple[int, int]]]] = [[[] for _ in range(1440)] for _ in fleets]
    # A vehicle on a break or on charge is neither carrying anyone nor available. Counting it as busy
    # would make an idle fleet look hard-worked, so it is tracked apart, as a running count kept by
    # +1 when it goes off and -1 when it comes back.
    off_delta = [np.zeros(1441, dtype=np.int64) for _ in fleets]
    off_now = [0 for _ in fleets]

    # Each vehicle takes its break once, starting at its own minute. Drawn only for fleets that have
    # one, so a fleet without breaks leaves the random sequence exactly as it was.
    for n, fleet in enumerate(fleets):
        if fleet.break_min <= 0 or not fleet.size:
            continue
        starts_at = rng.integers(0, 1440, size=fleet.size)
        for v, start in enumerate(starts_at):
            releases[n][int(start)].append((-v - 1, -1))  # negative marks "go on break", not "come back"

    queue_zone = np.empty(0, dtype=np.int32)
    queue_dest = np.empty(0, dtype=np.int32)
    queue_since = np.empty(0, dtype=np.int32)

    columns = ["requests", "gave_up", "served_total", "wait_sum", "max_wait",
               "requests_watched", "served_watched", "wait_sum_watched"]
    for f in fleets:
        columns += [f"served_{f.name}", f"empty_km_{f.name}", f"paid_km_{f.name}",
                    f"busy_min_{f.name}", f"outside_{f.name}", f"charges_{f.name}",
                    f"off_road_{f.name}"]
    at = {name: k for k, name in enumerate(columns)}
    log = np.zeros((24, len(columns)))
    zone_log = np.zeros((zones, 4))  # requests, served, gave up, wait sum
    violations = 0

    for minute in range(1440):
        hour = minute // 60
        for n in range(len(fleets)):
            off_now[n] += int(off_delta[n][minute])
        for n, fleet in enumerate(fleets):
            for vehicle, zone in releases[n][minute]:
                if vehicle < 0:  # its break has come round
                    v = -vehicle - 1
                    z = int(zone_of[n][v])
                    if v in idle_at[n][z]:
                        idle_at[n][z].discard(v)
                        idle[n][z] -= 1
                        back = min(minute + int(round(fleet.break_min)), 1439)
                        releases[n][back].append((v, z))
                        # This minute's deltas were consumed at the top of the loop, so a change that
                        # starts NOW has to move the count itself; only the return can be scheduled.
                        off_now[n] += 1
                        off_delta[n][back] -= 1
                    else:
                        # Busy right now; take the break as soon as it is free, by asking again later.
                        releases[n][min(minute + 1, 1439)].append((vehicle, -1))
                    continue
                zone_of[n][vehicle] = zone
                idle_at[n][zone].add(vehicle)
                idle[n][zone] += 1

        start, stop = starts[minute], starts[minute + 1]
        if stop > start:
            arriving = origins[start:stop]
            queue_zone = np.concatenate((queue_zone, arriving))
            queue_dest = np.concatenate((queue_dest, destinations[start:stop]))
            queue_since = np.concatenate((queue_since, np.full(stop - start, minute, dtype=np.int32)))
            log[hour, at["requests"]] += stop - start
            np.add.at(zone_log[:, 0], arriving, 1)
            if watch is not None:
                log[hour, at["requests_watched"]] += int(watch[arriving].sum())

        if len(queue_zone):
            gave_up = minute - queue_since > max_wait_min
            if gave_up.any():
                log[hour, at["gave_up"]] += int(gave_up.sum())
                np.add.at(zone_log[:, 2], queue_zone[gave_up], 1)
                queue_zone, queue_dest, queue_since = (
                    v[~gave_up] for v in (queue_zone, queue_dest, queue_since))

        # queue_since is non-decreasing - arrivals are appended and filtering is stable - so walking
        # it in order IS longest-waiting-first.
        taken = np.zeros(len(queue_zone), dtype=bool)
        open_now = [n for n, f in enumerate(fleets) if f.serves_hour(hour)]
        for k in range(len(queue_zone)):
            here = int(queue_zone[k])
            best_fleet, best_source, best_pickup = -1, -1, np.inf
            for n in open_now:
                fleet = fleets[n]
                if not fleet.size or not fleet.serves_zone(here):
                    continue
                sources = np.flatnonzero(idle[n])
                if not len(sources):
                    continue
                times = minutes[sources, here] * factor[hour]
                choice = int(np.argmin(times))
                if times[choice] < best_pickup:
                    best_fleet, best_source, best_pickup = n, int(sources[choice]), float(times[choice])
            if best_fleet < 0 or best_pickup > max_pickup_min:
                continue

            fleet = fleets[best_fleet]
            if not (fleet.serves_zone(here) and fleet.serves_hour(hour)):
                violations += 1  # cannot happen; kept so a future change cannot break the rule quietly
            vehicle = idle_at[best_fleet][best_source].pop()
            idle[best_fleet][best_source] -= 1
            taken[k] = True
            there = int(queue_dest[k])
            ride = minutes[here, there] * factor[hour]
            done = min(minute + int(round(best_pickup + ride + 2 * boarding_min)), 1439)
            # The battery. It charges where the passenger got out, which is the pessimistic reading -
            # no detour to a charger is modelled, and no queue for one either.
            driven = kilometres[best_source, here] + kilometres[here, there]
            run_km[best_fleet][vehicle] += driven
            if fleet.range_km and run_km[best_fleet][vehicle] >= fleet.range_km:
                run_km[best_fleet][vehicle] = 0.0
                plugged_in = done
                done = min(done + int(round(fleet.recharge_min)), 1439)
                log[hour, at[f"charges_{fleet.name}"]] += 1
                if plugged_in > minute:
                    off_delta[best_fleet][plugged_in] += 1
                else:
                    off_now[best_fleet] += 1  # same reason as the break above
                off_delta[best_fleet][done] -= 1
            releases[best_fleet][done].append((vehicle, there))

            waited = minute - int(queue_since[k]) + best_pickup
            log[hour, at["served_total"]] += 1
            log[hour, at["wait_sum"]] += waited
            log[hour, at["max_wait"]] = max(log[hour, at["max_wait"]], waited)
            log[hour, at[f"served_{fleet.name}"]] += 1
            log[hour, at[f"empty_km_{fleet.name}"]] += kilometres[best_source, here]
            log[hour, at[f"paid_km_{fleet.name}"]] += kilometres[here, there]
            if watch is not None and watch[here]:
                log[hour, at["served_watched"]] += 1
                log[hour, at["wait_sum_watched"]] += waited
            zone_log[here, 1] += 1
            zone_log[here, 3] += waited

        queue_zone, queue_dest, queue_since = (v[~taken] for v in (queue_zone, queue_dest, queue_since))
        for n, fleet in enumerate(fleets):
            # "Busy" is now vehicles that are working. Vehicles on a break or on charge are neither
            # busy nor available, and counting them as busy would make an idle fleet look hard-worked.
            idle_now = int(idle[n].sum())
            log[hour, at[f"busy_min_{fleet.name}"]] += fleet.size - idle_now - off_now[n]
            log[hour, at[f"off_road_{fleet.name}"]] += off_now[n]
            # Sampled at the hour's last minute rather than averaged: "how many are sitting outside
            # right now" is the question, and an average over a minute-by-minute count answers a
            # different one.
            if fleet.area is not None and minute % 60 == 59:
                log[hour, at[f"outside_{fleet.name}"]] = float(idle[n][~fleet.area].sum())

    hourly = pd.DataFrame(log, columns=columns)
    hourly.insert(0, "hour", range(24))
    by_zone = pd.DataFrame(zone_log, columns=["requests", "served", "gave_up", "wait_sum"])
    return Result(hourly=hourly, by_zone=by_zone, left_waiting=len(queue_zone), violations=violations)
