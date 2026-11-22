"""Current two-human animation checks against the local development studio.
Retired android/ceramic scripts are historical and are not part of this suite.
Uses isolated browser profiles; no hardware, providers, build or publication.
"""
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
CHECKS=(
    ('node','scripts/verify-avatar-selection.mjs'),
    ('node','scripts/verify-avatar-labels.mjs'),
    ('node','scripts/verify-inspection-framing.mjs'),
    ('node','scripts/verify-avatar-animations.mjs'),
    ('node','scripts/verify-companion-animation.mjs'),
    ('node','scripts/verify-lab-companion.mjs'),
    ('node','scripts/verify-navigation-narration.mjs'),
    (sys.executable,'-X','utf8','scripts/verify-human-animation-controls.py'),
    (sys.executable,'-X','utf8','scripts/verify-avatar-arrival.py'),
)
for command in CHECKS:
    print('CHECK '+command[-1],flush=True)
    subprocess.run(command,cwd=ROOT,check=True,timeout=300)
print('PASS current human animation, anatomy, selection, browser controls and arrival suites',flush=True)
