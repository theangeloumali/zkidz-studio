# Created by The Angelo Umali.
# Windows toasts for render milestones: PowerShell's WinRT toast API with no window, never waited on. The text travels in
# the environment, so a title or a path can never become PowerShell code.
import os
import subprocess
import sys

APP_ID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"  # PowerShell's own toast identity
SCRIPT = (
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
    "$text = $xml.GetElementsByTagName('text');"
    "$text.Item(0).AppendChild($xml.CreateTextNode($env:ZKS_TOAST_TITLE)) > $null;"
    "$text.Item(1).AppendChild($xml.CreateTextNode($env:ZKS_TOAST_BODY)) > $null;"
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + APP_ID + "')"
    ".Show([Windows.UI.Notifications.ToastNotification]::new($xml))"
)
CREATE_NO_WINDOW = 0x08000000


def toast_command(title, body):
    """(args, env, creationflags) for one toast."""
    args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SCRIPT]
    env = {**os.environ, "ZKS_TOAST_TITLE": title, "ZKS_TOAST_BODY": body}
    return args, env, CREATE_NO_WINDOW if sys.platform == "win32" else 0


def toast(title, body):
    """Shows a notification and returns at once; off Windows it prints instead; ZKS_TOASTS=0 silences it. A missing
    PowerShell never fails a render."""
    if os.environ.get("ZKS_TOASTS") == "0":
        return
    if sys.platform != "win32":
        print(f"{title}: {body}", flush=True)
        return
    args, env, flags = toast_command(title, body)
    try:
        subprocess.Popen(args, env=env, creationflags=flags, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
