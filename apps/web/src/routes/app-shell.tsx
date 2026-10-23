// Created by The Angelo Umali.
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { buttonClass } from "../components/button-class.ts";
import { editorPath, renderPath, ROUTE_PATHS } from "../lib/routes.ts";

type Theme = "dark" | "light";
const THEME_KEY = "zks-theme";

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be blocked; the theme still applies for this visit.
  }
}

const NAV_LINK =
  "inline-flex min-h-(--target-min) items-center rounded-control px-3 text-ui text-copy-muted transition-colors duration-(--dur-hover) hover:text-copy aria-[current=page]:text-copy aria-[current=page]:underline aria-[current=page]:decoration-accent aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8";

export function AppShell() {
  const { projectId } = useParams();
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    saveTheme(next);
    setTheme(next);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-10 rounded-control bg-bg-elevated px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-[1] border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-(--header-h) max-w-(--page-max) flex-wrap items-center gap-x-4 gap-y-1 px-(--gutter)">
          <NavLink to={ROUTE_PATHS.home} className="font-display text-ui-lg font-extrabold uppercase font-condensed">
            ZKidz <span className="text-accent">Studio</span>
          </NavLink>
          <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink to={ROUTE_PATHS.home} end className={NAV_LINK}>
              Home
            </NavLink>
            {projectId && (
              <>
                <NavLink to={editorPath(projectId)} end className={NAV_LINK}>
                  Editor
                </NavLink>
                <NavLink to={renderPath(projectId)} className={NAV_LINK}>
                  Render
                </NavLink>
              </>
            )}
            <NavLink to={ROUTE_PATHS.setup} className={NAV_LINK}>
              Setup
            </NavLink>
          </nav>
          <button
            type="button"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className={buttonClass("quiet", "px-3")}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-(--page-max) flex-1 px-(--gutter) py-8 outline-none sm:py-12">
        <Outlet />
      </main>
    </div>
  );
}
