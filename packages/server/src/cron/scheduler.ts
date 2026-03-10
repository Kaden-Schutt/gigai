import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { nanoid } from "nanoid";
import type { FastifyBaseLogger } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  schedule: string;       // 5-field cron expression
  tool: string;
  args: string[];
  description?: string;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
  oneShot?: boolean;       // if true, disable after first execution
}

export interface CronFile {
  jobs: CronJob[];
}

// ---------------------------------------------------------------------------
// Cron expression parser  (minute hour dom month dow — standard 5-field)
// Supports: numbers, *, ranges (1-5), steps (*/5, 1-30/5), lists (1,3,5)
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): number[] {
  const result = new Set<number>();

  for (const part of field.split(",")) {
    // Handle step: */5  or  1-30/5
    let [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (range === "*") {
      for (let i = min; i <= max; i += step) result.add(i);
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      for (let i = lo; i <= hi; i += step) result.add(i);
    } else {
      result.add(parseInt(range, 10));
    }
  }

  return [...result].sort((a, b) => a - b);
}

export function parseCron(expression: string): {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
} {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6), // 0 = Sunday
  };
}

/** Check whether a Date matches a parsed cron expression. */
function matchesCron(
  date: Date,
  cron: ReturnType<typeof parseCron>,
): boolean {
  return (
    cron.minutes.includes(date.getMinutes()) &&
    cron.hours.includes(date.getHours()) &&
    cron.daysOfMonth.includes(date.getDate()) &&
    cron.months.includes(date.getMonth() + 1) &&
    cron.daysOfWeek.includes(date.getDay())
  );
}

/** Compute the next Date (from `after`) that matches the cron expression. */
export function nextRunDate(expression: string, after: Date = new Date()): Date {
  const cron = parseCron(expression);
  // Start from the next minute boundary
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  // Safety: iterate at most 4 years worth of minutes
  const limit = 4 * 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (matchesCron(d, cron)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }

  throw new Error(`Unable to compute next run for expression: ${expression}`);
}

// ---------------------------------------------------------------------------
// Human-readable --at parser
// ---------------------------------------------------------------------------

/**
 * Parse a human-readable time specification and return a one-shot cron
 * expression that will fire once at the specified time.
 *
 * Supported formats:
 *   "9:00 AM"              – today (or tomorrow if time has passed)
 *   "9:00 AM tomorrow"     – tomorrow
 *   "2024-03-08 14:30"     – absolute datetime
 *   "in 30 minutes"        – relative
 *   "in 2 hours"           – relative
 */
export function parseAtExpression(input: string): string {
  const now = new Date();
  let target: Date | undefined;

  // --- "in N minutes" or "in N hours" ---
  const relMatch = input.match(/^in\s+(\d+)\s+(minute|minutes|hour|hours)$/i);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    target = new Date(now);
    if (unit.startsWith("minute")) {
      target.setMinutes(target.getMinutes() + n);
    } else {
      target.setHours(target.getHours() + n);
    }
  }

  // --- Absolute: "2024-03-08 14:30" ---
  if (!target) {
    const absMatch = input.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/);
    if (absMatch) {
      const [, datePart, h, m] = absMatch;
      target = new Date(`${datePart}T${h.padStart(2, "0")}:${m}:00`);
    }
  }

  // --- "HH:MM AM/PM" with optional "tomorrow" ---
  if (!target) {
    const timeMatch = input.match(
      /^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+(tomorrow))?$/i,
    );
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3].toUpperCase();
      const isTomorrow = !!timeMatch[4];

      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;

      target = new Date(now);
      target.setHours(hours, minutes, 0, 0);

      if (isTomorrow) {
        target.setDate(target.getDate() + 1);
      } else if (target <= now) {
        // Time already passed today — schedule for tomorrow
        target.setDate(target.getDate() + 1);
      }
    }
  }

  if (!target) {
    throw new Error(
      `Cannot parse time expression: "${input}". ` +
      `Supported formats: "9:00 AM", "9:00 AM tomorrow", "2024-03-08 14:30", "in 30 minutes", "in 2 hours"`,
    );
  }

  // Build one-shot cron: minute hour day month *
  const min = target.getMinutes();
  const hour = target.getHours();
  const day = target.getDate();
  const month = target.getMonth() + 1;

  return `${min} ${hour} ${day} ${month} *`;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export type ToolExecutor = (tool: string, args: string[]) => Promise<void>;

export class CronScheduler {
  private jobs: CronJob[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private filePath: string;
  private executor: ToolExecutor;
  private log: FastifyBaseLogger;

  constructor(
    configDir: string,
    executor: ToolExecutor,
    log: FastifyBaseLogger,
  ) {
    this.filePath = resolve(configDir, "kon.crons.json");
    this.executor = executor;
    this.log = log;
  }

  // --- Persistence ---

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data: CronFile = JSON.parse(raw);
      this.jobs = data.jobs ?? [];
    } catch {
      // File doesn't exist yet — start with empty list
      this.jobs = [];
    }
  }

  private async save(): Promise<void> {
    const data: CronFile = { jobs: this.jobs };
    await writeFile(this.filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  // --- Job CRUD ---

  async addJob(opts: {
    schedule: string;
    tool: string;
    args: string[];
    description?: string;
    oneShot?: boolean;
  }): Promise<CronJob> {
    // Validate cron expression
    parseCron(opts.schedule);

    const job: CronJob = {
      id: nanoid(12),
      schedule: opts.schedule,
      tool: opts.tool,
      args: opts.args,
      description: opts.description,
      createdAt: Date.now(),
      nextRun: nextRunDate(opts.schedule).getTime(),
      enabled: true,
      oneShot: opts.oneShot,
    };

    this.jobs.push(job);
    await this.save();
    return job;
  }

  async removeJob(id: string): Promise<boolean> {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length === before) return false;
    await this.save();
    return true;
  }

  async toggleJob(id: string): Promise<CronJob | undefined> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return undefined;
    job.enabled = !job.enabled;
    if (job.enabled) {
      job.nextRun = nextRunDate(job.schedule).getTime();
    }
    await this.save();
    return job;
  }

  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  // --- Tick / execution ---

  start(): void {
    this.log.info("Cron scheduler started (30s interval)");
    this.timer = setInterval(() => void this.tick(), 30_000);
    // Also run immediately on startup
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.log.info("Cron scheduler stopped");
  }

  private async tick(): Promise<void> {
    const now = new Date();
    let dirty = false;

    for (const job of this.jobs) {
      if (!job.enabled) continue;

      const cron = parseCron(job.schedule);
      if (!matchesCron(now, cron)) continue;

      // Avoid re-running within the same minute
      if (job.lastRun) {
        const lastRunDate = new Date(job.lastRun);
        if (
          lastRunDate.getFullYear() === now.getFullYear() &&
          lastRunDate.getMonth() === now.getMonth() &&
          lastRunDate.getDate() === now.getDate() &&
          lastRunDate.getHours() === now.getHours() &&
          lastRunDate.getMinutes() === now.getMinutes()
        ) {
          continue;
        }
      }

      // Execute
      this.log.info(`Cron executing job ${job.id}: ${job.tool} ${job.args.join(" ")}`);
      try {
        await this.executor(job.tool, job.args);
        this.log.info(`Cron job ${job.id} completed successfully`);
      } catch (e) {
        this.log.error(`Cron job ${job.id} failed: ${(e as Error).message}`);
      }

      job.lastRun = Date.now();

      // One-shot: disable after execution
      if (job.oneShot) {
        job.enabled = false;
        this.log.info(`Cron job ${job.id} (one-shot) disabled after execution`);
      } else {
        job.nextRun = nextRunDate(job.schedule).getTime();
      }

      dirty = true;
    }

    if (dirty) {
      await this.save();
    }
  }
}
