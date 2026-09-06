import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const dbPath = process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");
const db = new DatabaseSync(dbPath);

db.exec("BEGIN IMMEDIATE");
try {
  db.exec(`
    UPDATE "FamilySchedule"
    SET "lunchNotAtHome" = CASE WHEN "eatsAtCompany" = 1 OR "isAway" = 1 THEN 1 ELSE "lunchNotAtHome" END,
        "dinnerNotAtHome" = CASE WHEN "isAway" = 1 THEN 1 ELSE "dinnerNotAtHome" END;
    UPDATE "FamilySchedule" SET "isWorking" = 0, "eatsAtCompany" = 0, "isAway" = 0;
  `);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(`Legacy schedules migrated to meal attendance: ${dbPath}`);
