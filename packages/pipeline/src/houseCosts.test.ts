/**
 * House costs: spend that belongs to nobody in particular.
 *
 * Run against a real Postgres (PGlite) rather than a mock, because the whole behaviour lives in how
 * SQL treats NULL — `user_id = $1` is false for NULL, which is what makes per-user queries exclude
 * house spend without having to know it exists. A mock would assert my assumption rather than the
 * database's.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table runs (id int primary key, user_id text, local_date text, kind text, status text);
    create table run_costs (id serial primary key, run_id int, user_id text, stage text,
      cost_usd numeric(12,6), pages int, created_at timestamptz default now());
  `);
  await db.exec(`
    insert into runs values (1,'alice','2026-09-21','nightly','succeeded'),
                            (2,'bob','2026-09-21','nightly','succeeded');
    insert into run_costs (run_id,user_id,stage,cost_usd,pages) values
      (1,'alice','decode','0.400000',9),
      -- Alice's run reached midnight first, so it paid for the shared crossword. Booked to nobody.
      (1,null,'puzzle','0.006500',1),
      (2,'bob','decode','0.300000',6);
  `);
});

const num = (v: unknown) => Number(v);

describe("house costs", () => {
  /** The distortion this exists to prevent: Alice paying for everyone's crossword. */
  it("does not charge the run that paid for the shared puzzle", async () => {
    const alice = await db.query(`select coalesce(sum(cost_usd),0) usd from run_costs where user_id = 'alice'`);
    const bob = await db.query(`select coalesce(sum(cost_usd),0) usd from run_costs where user_id = 'bob'`);
    expect(num((alice.rows[0] as { usd: string }).usd)).toBeCloseTo(0.4, 6);
    expect(num((bob.rows[0] as { usd: string }).usd)).toBeCloseTo(0.3, 6);
  });

  /** The money was still spent, so anything measuring the estate must still see it. */
  it("still counts towards the whole-estate total, burn rate and credit drawdown", async () => {
    const all = await db.query(`select coalesce(sum(cost_usd),0) usd from run_costs`);
    expect(num((all.rows[0] as { usd: string }).usd)).toBeCloseTo(0.7065, 6);
  });

  it("is reportable on its own, so booking it off a customer does not hide it", async () => {
    const house = await db.query(`select stage, sum(cost_usd) usd from run_costs where user_id is null group by stage`);
    expect(house.rows).toHaveLength(1);
    expect((house.rows[0] as { stage: string }).stage).toBe("puzzle");
    expect(num((house.rows[0] as { usd: string }).usd)).toBeCloseTo(0.0065, 6);
  });

  /**
   * The per-day view joins runs to costs, and joining on the RUN's owner alone would drag the house
   * row back in through Alice's run. The join has to name the cost's owner too.
   */
  it("stays out of the per-day view, which joins through the run that paid", async () => {
    const wrong = await db.query(`
      select coalesce(sum(c.cost_usd),0) usd from runs r
      left join run_costs c on c.run_id = r.id
      where r.user_id = 'alice'`);
    const right = await db.query(`
      select coalesce(sum(c.cost_usd),0) usd from runs r
      left join run_costs c on c.run_id = r.id and c.user_id = 'alice'
      where r.user_id = 'alice'`);
    expect(num((wrong.rows[0] as { usd: string }).usd)).toBeCloseTo(0.4065, 6); // the bug
    expect(num((right.rows[0] as { usd: string }).usd)).toBeCloseTo(0.4, 6); // the fix
  });

  it("never becomes a null key in a per-user map", async () => {
    const rows = await db.query(`select user_id, sum(cost_usd) usd from run_costs where user_id is not null group by user_id`);
    expect(rows.rows.map((r) => (r as { user_id: string }).user_id).sort()).toEqual(["alice", "bob"]);
  });
});
