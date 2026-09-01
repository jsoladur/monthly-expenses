import postgres from "postgres";

// Two complete years (2024, 2025) plus Jan–Sep 2026 so Overview shows YTD/LFL.
export async function seedTwoCompleteYearsPlusIncomplete(
  dbUrl: string,
  userId: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [food] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, 'Food', 'expense', true)
      RETURNING id
    `;
    const [rent] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, 'Rent', 'expense', true)
      RETURNING id
    `;
    const [salary] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, 'Salary', 'income', true)
      RETURNING id
    `;
    if (!food || !rent || !salary) throw new Error("seedTwoCompleteYears: category insert failed");

    for (const year of [2024, 2025]) {
      for (let month = 1; month <= 12; month++) {
        await insertMonthMoney(sql, userId, year, month, {
          salaryId: salary.id,
          foodId: food.id,
          rentId: rent.id,
          income: year === 2024 ? "3000.00" : "3200.00",
          foodAmt: year === 2024 ? "400.00" : "420.00",
          rentAmt: year === 2024 ? "1200.00" : "1250.00",
        });
      }
    }
    for (let month = 1; month <= 9; month++) {
      await insertMonthMoney(sql, userId, 2026, month, {
        salaryId: salary.id,
        foodId: food.id,
        rentId: rent.id,
        income: "3200.00",
        foodAmt: "430.00",
        rentAmt: "1250.00",
      });
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function insertMonthMoney(
  sql: postgres.Sql,
  userId: string,
  year: number,
  month: number,
  amounts: {
    salaryId: string;
    foodId: string;
    rentId: string;
    income: string;
    foodAmt: string;
    rentAmt: string;
  },
): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO month (user_id, year, month)
    VALUES (${userId}, ${year}, ${month})
    RETURNING id
  `;
  if (!row) throw new Error("insertMonthMoney: month insert failed");
  await sql`
    INSERT INTO month_income (month_id, category_id, name, amount)
    VALUES (${row.id}, ${amounts.salaryId}, 'Pay', ${amounts.income})
  `;
  await sql`
    INSERT INTO month_actual_expense (month_id, category_id, name, amount)
    VALUES
      (${row.id}, ${amounts.foodId}, 'Groceries', ${amounts.foodAmt}),
      (${row.id}, ${amounts.rentId}, 'Rent', ${amounts.rentAmt})
  `;
}
