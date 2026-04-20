#!/usr/bin/env python3
import runpy
from pathlib import Path
base = Path.home() / '.codex' / 'skills' / 'autoworker' / 'scripts' / 'autoworker.py'
runpy.run_path(str(base), run_name='__main__')
