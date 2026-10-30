#!/usr/bin/env python3
"""Steps of the fork's install.py for the browser build, run by builder.ts from its work copy (the current folder):

    steps.py disc <disc.iso>        check the image: the USA release, unmodified (exit code 2 when it is not)
    steps.py gamedata <disc.iso>    unpack the game's data
    steps.py split                  split out the data tables of the game's two programs

Only those: no native requirements, no x86 build, no self-test (the browser build is port/web/, run by builder.ts).
install.py's own log is install.log in the work copy; on a failure its last lines are printed here too."""
import argparse, pathlib, sys

ROOT = pathlib.Path.cwd()
sys.path.insert(0, str(ROOT))
import install  # noqa: E402  (the fork's, from the work copy)

REFUSED = 2


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("disc", "gamedata", "split"):
        print(__doc__)
        return 64
    step = sys.argv[1]
    iso = sys.argv[2] if len(sys.argv) > 2 else None
    install.MACHINE = True  # one line per event, no terminal animation
    install.TTY = False
    args = argparse.Namespace(iso=iso, force=False, bits32=False, rebuild=False, skip_test=True, check=False, machine=True)
    try:
        if step == "disc":
            # Every time: the image may not be the one checked last.
            args.force = True
            install.step_disc(args)
        elif step == "gamedata":
            install.step_gamedata(args, pathlib.Path(iso) if iso else None)
        else:
            install.step_split(args)
    except install.Failed as e:
        install.say("stopped", str(e))
        if install.LOG.exists():
            print("\n".join(install.LOG.read_text(errors="replace").splitlines()[-20:]))
        return REFUSED if step == "disc" else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
