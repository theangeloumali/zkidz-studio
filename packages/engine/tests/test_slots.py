# Created by The Angelo Umali.
# Machine-wide slots: one holder at a time, a dead holder's lock is reclaimed, and probing a pid never kills it.
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import slots


class SlotTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.saved = slots.LOCKS, slots.POLL_SECONDS
        slots.LOCKS, slots.POLL_SECONDS = Path(self.folder.name), 0.05
        self.lock = slots.LOCKS / "gpu-0.lock"

    def tearDown(self):
        slots.LOCKS, slots.POLL_SECONDS = self.saved
        self.folder.cleanup()

    def sleeper(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(process.kill)
        return process

    def test_a_held_slot_is_released_after_the_block(self):
        with slots.slot("gpu", "test"):
            self.assertEqual(json.loads(self.lock.read_text())["pid"], os.getpid())
        self.assertFalse(self.lock.exists())

    def test_a_dead_holders_lock_is_reclaimed(self):
        finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
        self.lock.write_text(json.dumps({"pid": int(finished.stdout), "label": "crashed render", "since": time.time()}))
        with slots.slot("gpu", "test"):
            self.assertEqual(json.loads(self.lock.read_text())["label"], "test")

    def test_a_live_holder_blocks_until_it_lets_go(self):
        holder = self.sleeper()
        self.lock.write_text(json.dumps({"pid": holder.pid, "label": "other session", "since": time.time()}))
        entered = threading.Event()
        waiter = threading.Thread(target=lambda: slots.slot("gpu", "test").__enter__() or entered.set(), daemon=True)
        waiter.start()
        self.assertFalse(entered.wait(0.5), "took a slot another live process holds")
        holder.kill()
        holder.wait()
        self.assertTrue(entered.wait(5), "never took the slot after its holder died")

    def test_a_waiter_is_told_once_that_it_is_waiting(self):
        holder = self.sleeper()
        self.lock.write_text(json.dumps({"pid": holder.pid, "label": "other session", "since": time.time()}))
        calls = []
        threading.Timer(0.3, holder.kill).start()
        with slots.slot("gpu", "test", on_wait=lambda: calls.append(1)):
            pass
        self.assertEqual(calls, [1])

    def test_probing_a_pid_never_terminates_it(self):
        process = self.sleeper()
        self.assertTrue(slots.alive(process.pid))
        self.assertIsNone(process.poll(), "alive() killed the process it probed")
        process.kill()
        process.wait()
        self.assertFalse(slots.alive(process.pid))

    def test_an_unreaped_holder_is_dead(self):
        process = self.sleeper()
        process.kill()
        time.sleep(0.2)  # killed but not waited on: a zombie on POSIX, which still answers signal 0
        self.assertFalse(slots.alive(process.pid))


if __name__ == "__main__":
    unittest.main()
