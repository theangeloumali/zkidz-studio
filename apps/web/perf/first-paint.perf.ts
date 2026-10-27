// Created by The Angelo Umali.
import { test } from "@playwright/test";
import { expectWithinBudget } from "./budgets.ts";

// Each test gets a fresh browser context, so this is a first visit with an empty cache.
test("the home page paints its first content within 1 s on localhost", async ({ page }) => {
  await page.goto("/");
  const firstPaintMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entry = list.getEntriesByName("first-contentful-paint")[0];
          if (entry !== undefined) resolve(entry.startTime);
        }).observe({ type: "paint", buffered: true });
      }),
  );
  expectWithinBudget("firstContentfulPaint", Math.round(firstPaintMs));
});
