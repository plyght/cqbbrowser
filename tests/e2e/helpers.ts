/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from '@playwright/test';

export async function boot(page: Page, path = '/') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(path);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
  return errors;
}

/** Enter gameplay without pointer lock and advance the sim deterministically. */
export async function play(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__sb;
    g.allowUnlocked = true;
    g.manual = true;
    g.enter();
  });
}

export async function steps(page: Page, n: number, input?: Record<string, unknown>) {
  await page.evaluate(
    ([n, input]) => {
      const g = (window as any).__sb;
      for (let i = 0; i < (n as number); i++) {
        if (input) g.test.next = structuredClone(input);
        g.step(1 / 60);
      }
      g.test.next = {};
    },
    [n, input ?? null] as const,
  );
}
