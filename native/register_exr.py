# SPDX-License-Identifier: GPL-3.0-or-later
"""Register this portable copy as an EXR candidate; Windows keeps the user's default."""
import ctypes
from pathlib import Path
import sys
import winreg


def write_value(key_path, name, value):
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)


def register(executable):
    executable = Path(executable).resolve(strict=True)
    if not executable.is_file() or executable.suffix.lower() != '.exe':
        raise ValueError('Expected the packaged OwlSight executable.')
    command = f'"{executable}" "%1"'
    icon = f'"{executable}",0'
    classes = r'Software\Classes'
    progid = 'OwlSight.EXR'
    capabilities = r'Software\OwlSight\Capabilities'
    write_value(classes + '\\' + progid, '', 'OpenEXR Image')
    write_value(classes + '\\' + progid + r'\DefaultIcon', '', icon)
    write_value(classes + '\\' + progid + r'\shell\open\command', '', command)
    write_value(classes + '\\' + progid + r'\Application', 'ApplicationName', 'OwlSight')
    write_value(classes + '\\' + progid + r'\Application', 'ApplicationIcon', icon)
    write_value(capabilities, 'ApplicationName', 'OwlSight')
    write_value(capabilities, 'ApplicationDescription', 'OwlSight EXR image and sequence viewer')
    write_value(capabilities, 'ApplicationIcon', icon)
    write_value(capabilities + r'\FileAssociations', '.exr', progid)
    # Add our candidate only. Do not replace .exr's default or touch UserChoice.
    write_value(classes + r'\.exr\OpenWithProgids', progid, '')
    write_value(r'Software\RegisteredApplications', 'OwlSight', capabilities)
    notify = ctypes.windll.shell32.SHChangeNotify
    notify.argtypes = [ctypes.c_long, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    notify.restype = None
    notify(0x08000000, 0x1000, None, None)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Expected one executable path.')
    register(sys.argv[1])
