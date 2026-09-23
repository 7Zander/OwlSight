# SPDX-License-Identifier: GPL-3.0-or-later
"""Low frequency self samples; no extra packages or polling process."""
import os
import time
import ctypes
_last = None
_last_wall = time.perf_counter()
_last_cpu = time.process_time()
if os.name == 'nt':
    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in
            ('peakWorkingSet', 'workingSet', 'peakPaged', 'paged', 'peakNonPaged', 'nonPaged', 'pagefile', 'peakPagefile', 'private')]
    _kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    _kernel.GetCurrentProcess.restype = ctypes.c_void_p
    _psapi = ctypes.WinDLL('psapi', use_last_error=True)
    _psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
def process_sample():
    global _last, _last_wall, _last_cpu
    now = time.perf_counter()
    if _last is not None and now - _last_wall < 1:
        return _last
    cpu = time.process_time()
    sample = dict(pid=os.getpid(), collectedAtUnixMs=round(time.time()*1000),
                  cpuCorePercent=100*(cpu-_last_cpu)/max(.001, now-_last_wall), intervalMs=(now-_last_wall)*1000)
    if os.name == 'nt':
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if _psapi.GetProcessMemoryInfo(_kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            sample.update(workingSetMiB=counters.workingSet/1048576, privateMiB=counters.private/1048576)
    _last, _last_wall, _last_cpu = sample, now, cpu
    return sample
